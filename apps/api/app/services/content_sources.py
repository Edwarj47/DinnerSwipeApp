"""Bounded, read-only official recipe provider. No AI, database, or asset writes.

``recipe_sources`` is a deterministic URL queue; the worker owns consumed URLs.
``load_recipe`` returns a complete pending-approval candidate or ``SourceBlocked``.
``parse_recipe_html`` is a content-only inspection helper, NOT a staging candidate.
Rights must be reviewed for the exact photo; a government hostname is not a license.
"""

from __future__ import annotations

import asyncio
import hashlib
import inspect
import json
import re
import unicodedata
from collections.abc import Collection
from dataclasses import dataclass
from datetime import UTC, datetime
from fractions import Fraction
from pathlib import Path
from typing import Any
from urllib.parse import urlsplit

import httpx
from bs4 import BeautifulSoup, Tag
from fastapi import HTTPException

from app.ingestion.url_fetcher import fetch_public_html
from app.services.content_media import PERMITTED_LICENSES

REGISTRY_PATH = Path(__file__).resolve().parents[1] / "data" / "content_sources.json"
RECIPE_PREFIX = (
    "https://www.nhlbi.nih.gov/health/heart-healthy-living/healthy-foods/healthy-eating-recipes/"
)
SOURCE_NAME = "National Heart, Lung, and Blood Institute"
HTML_HOSTS = frozenset({"www.nhlbi.nih.gov", "nhlbi.nih.gov"})
PHOTO_HOSTS = HTML_HOSTS | {"upload.wikimedia.org", "thumb.wikimedia.org", "commons.wikimedia.org"}
MAX_HTML_BYTES = 1_000_000
MAX_SOURCES = 54
FETCH_TIMEOUT_SECONDS = 20
NUTRIENTS = {
    "calories": ("calories", 20_000),
    "protein": ("protein_g", 1000),
    "carbohydrates": ("carbs_g", 2000),
    "total fat": ("fat_g", 1000),
    "total fiber": ("fiber_g", 500),
}
_FRACTIONS = (
    "\u00bc\u00bd\u00be\u2150\u2151\u2152\u2153\u2154\u2155\u2156"
    "\u2157\u2158\u2159\u215a\u215b\u215c\u215d\u215e"
)
_QUANTITY = re.compile(
    rf"^(\d+\s+\d+/\d+|\d+/\d+|\d+\s*[{_FRACTIONS}]|[{_FRACTIONS}]|\d+(?:\.\d+)?)"
    r"(?=\s|$)"
)
_UNITS = {
    "c": "cup",
    "cup": "cup",
    "cups": "cup",
    "tsp": "tsp",
    "teaspoon": "tsp",
    "teaspoons": "tsp",
    "tbsp": "tbsp",
    "tablespoon": "tbsp",
    "tablespoons": "tbsp",
    "oz": "oz",
    "ounce": "oz",
    "ounces": "oz",
    "lb": "lb",
    "pound": "lb",
    "pounds": "lb",
    "g": "g",
    "kg": "kg",
    "ml": "ml",
    "l": "l",
    "can": "can",
    "cans": "can",
    "bag": "bag",
    "bags": "bag",
    "jar": "jar",
    "jars": "jar",
    "pkg": "package",
    "pt": "pint",
    "qt": "quart",
}


@dataclass
class SourceCandidate:
    kind: str
    payload: dict[str, Any]
    source_url: str
    source_name: str
    photo_url: str
    provenance: dict[str, Any]
    warnings: list[str]


class SourceBlocked(ValueError):
    """Expected quality/licensing skip; safe for a worker to record by source URL."""

    def __init__(self, code: str, source_url: str, reason: str) -> None:
        self.code = code
        self.source_url = source_url
        self.reason = reason
        super().__init__(f"{code}: {reason}")


def _registry() -> dict[str, Any]:
    data: dict[str, Any] = json.loads(REGISTRY_PATH.read_text(encoding="utf-8"))
    recipes = data["recipes"]
    if data["version"] != 1 or not isinstance(recipes, dict) or len(recipes) > MAX_SOURCES:
        raise ValueError("Invalid or oversized content source registry")
    return data


def recipe_sources(*, exclude_urls: Collection[str] = (), limit: int = MAX_SOURCES) -> list[str]:
    """No crawling; reviewed complete records precede known-blocked records.

    The worker has a bounded daily attempt budget, so unavailable records must
    never starve usable recipes later in the registry. Runtime checks still apply.
    """
    if not 0 <= limit <= MAX_SOURCES:
        raise ValueError(f"limit must be between 0 and {MAX_SOURCES}")
    excluded = set(exclude_urls)
    records = _registry()["recipes"]
    urls = sorted(
        records,
        key=lambda url: (
            not bool(records[url].get("nutrition_evidence") and records[url].get("image"))
        ),
    )
    return [url for url in urls if url not in excluded][:limit]


def _https_url(url: str, hosts: Collection[str]) -> bool:
    try:
        parsed = urlsplit(url)
        return (
            parsed.scheme == "https"
            and parsed.hostname in hosts
            and parsed.username is None
            and parsed.password is None
            and parsed.port is None
            and not parsed.fragment
            and not any(char.isspace() or ord(char) < 32 for char in url)
            and "\\" not in url
        )
    except ValueError:
        return False


def _record(url: str) -> dict[str, Any]:
    recipes = _registry()["recipes"]
    if not _https_url(url, HTML_HOSTS) or not url.startswith(RECIPE_PREFIX) or url not in recipes:
        raise SourceBlocked(
            "source_not_allowlisted", url, "URL is not in the fixed recipe registry"
        )
    record: dict[str, Any] = recipes[url]
    return record


def parse_ingredient(text: str, *, sort_order: int = 0) -> dict[str, Any]:
    """Parse a leading exact quantity, preserving the original line and unknown ranges.

    Never use the shared parser's integer-first expression here. Invalid rational
    numbers are errors, not an absent quantity or a guessed integer.
    """
    text = " ".join(text.split())
    quantity: float | None = None
    rest = text
    match = _QUANTITY.match(text)
    if match:
        raw = match[1]
        if raw[-1] in _FRACTIONS:
            whole = raw[:-1].strip()
            rational = unicodedata.normalize("NFKC", raw[-1]).replace("\u2044", "/")
            value = Fraction(whole or "0") + Fraction(rational)
        else:
            try:
                value = sum((Fraction(part) for part in raw.split()), Fraction())
            except (ZeroDivisionError, ValueError) as exc:
                raise ValueError("Invalid ingredient fraction") from exc
        remainder = text[match.end() :].strip()
        # A range such as '1 to 2' must not become a quantity of 1.
        if not re.match(r"^(?:to\b|[-\u2013\u2014])", remainder, re.IGNORECASE):
            quantity = float(value)
            rest = remainder
    else:
        # Detect malformed fractions even when they do not satisfy a token boundary.
        if re.match(r"^\d+(?:\s+\d+)?/0(?:\D|$)", text):
            raise ValueError("Invalid ingredient fraction")
    unit: str | None = None
    if quantity is not None and rest:
        first, _, tail = rest.partition(" ")
        unit = _UNITS.get(first.rstrip(".").lower())
        if unit:
            rest = tail
    return {
        "original_text": text,
        "normalized_name": rest or text,
        "quantity": quantity,
        "unit": unit,
        "sort_order": sort_order,
        "is_optional": bool(re.search(r"\boptional\b", text, re.IGNORECASE)),
    }


def _table(article: Tag, selector: str, url: str) -> dict[str, str]:
    tables = article.select(selector)
    if len(tables) != 1:
        raise SourceBlocked("recipe_layout_changed", url, f"Expected one {selector} table")
    rows: dict[str, str] = {}
    for tr in tables[0].select("tr"):
        label, value = tr.find("th"), tr.find("td")
        if label is None or value is None:
            continue
        key = label.get_text(" ", strip=True).lower().rstrip(":")
        if key in rows:
            raise SourceBlocked("ambiguous_recipe_field", url, f"Duplicate table label: {key}")
        rows[key] = " ".join(value.get_text(" ", strip=True).split())
    return rows


def _section(body: Tag, name: str, url: str) -> list[Tag]:
    headings = [h for h in body.find_all("h2") if h.get_text(" ", strip=True).lower() == name]
    if len(headings) != 1:
        raise SourceBlocked("recipe_layout_changed", url, f"Expected one {name} section")
    nodes: list[Tag] = []
    for sibling in headings[0].next_siblings:
        if isinstance(sibling, Tag):
            if sibling.name in {"h1", "h2"}:
                break
            nodes.append(sibling)
    return nodes


def _minutes(value: str, url: str) -> int:
    match = re.fullmatch(
        r"(?:(\d+) hours?(?: (\d+) minutes?)?|(\d+) minutes?)", value, re.IGNORECASE
    )
    if not match:
        raise SourceBlocked("timing_unverified", url, f"Unsupported or missing timing: {value}")
    minutes = int(match[1] or 0) * 60 + int(match[2] or match[3] or 0)
    if minutes > 1440:
        raise SourceBlocked("timing_unverified", url, f"Timing exceeds one day: {value}")
    return minutes


def parse_recipe_html(html: str, source_url: str) -> dict[str, Any]:
    """Inspect complete recipe content. Does not certify a photo or yield a candidate."""
    record = _record(source_url)
    if len(html.encode("utf-8")) > MAX_HTML_BYTES:
        raise SourceBlocked("source_too_large", source_url, "HTML exceeds provider size bound")
    soup = BeautifulSoup(html, "html.parser")
    articles = soup.select("article.node--type-recipe")
    if len(articles) != 1:
        raise SourceBlocked(
            "recipe_layout_changed", source_url, "Expected one NHLBI recipe article"
        )
    article = articles[0]
    title = article.select_one("h1")
    body = article.select_one(".field--name-body")
    if title is None or body is None or title.get_text(" ", strip=True) != record["name"]:
        raise SourceBlocked(
            "recipe_identity_changed", source_url, "Missing or changed recipe identity"
        )
    facts = _table(article, "table.cooking-facts", source_url)
    raw_nutrition = _table(article, "table.health-facts", source_url)
    yield_match = re.fullmatch(r"(\d+) servings?", facts.get("yields", ""), re.IGNORECASE)
    if not yield_match or not 1 <= int(yield_match[1]) <= 30:
        raise SourceBlocked("yield_unverified", source_url, "Explicit serving yield is required")
    servings = int(yield_match[1])
    serving_size = facts.get("serving size", "")
    if not serving_size:
        raise SourceBlocked("nutrition_basis_unverified", source_url, "Serving size is absent")
    nutrition: dict[str, float] = {}
    for label, (field, maximum) in NUTRIENTS.items():
        value = raw_nutrition.get(label, "")
        pattern = r"(\d+(?:\.\d+)?)\s*(?:kcal)?" if field == "calories" else r"(\d+(?:\.\d+)?)\s*g"
        match = re.fullmatch(pattern, value, re.IGNORECASE)
        if not match or not 0 <= float(match[1]) <= maximum:
            raise SourceBlocked(
                "nutrition_unverified", source_url, f"Missing/non-exact {label}: {value}"
            )
        nutrition[field] = float(match[1])
    # The website says 'Nutritional Facts', not 'per serving'. Require independently
    # reviewed, recipe-specific cookbook evidence, matched to live denominator/data.
    evidence = record.get("nutrition_evidence")
    if not evidence or evidence.get("basis") != "serving":
        raise SourceBlocked(
            "nutrition_basis_unverified", source_url, "No reviewed per-serving evidence"
        )
    if (
        evidence.get("servings") != servings
        or evidence.get("serving_size") != serving_size
        or evidence.get("values") != nutrition
    ):
        raise SourceBlocked(
            "nutrition_evidence_changed",
            source_url,
            "Live nutrition/yield differs from reviewed evidence",
        )
    ingredients: list[dict[str, Any]] = []
    section: str | None = None
    for node in _section(body, "ingredients", source_url):
        for li in node.find_all("li"):
            nested = li.find(["ul", "ol"])
            if nested:
                section = (
                    " ".join(str(t).strip() for t in li.contents if not isinstance(t, Tag))
                    .strip()
                    .rstrip(":")
                )
                continue
            text = li.get_text(" ", strip=True)
            if not text or len(text) > 3000:
                raise SourceBlocked("recipe_incomplete", source_url, "Invalid ingredient line")
            if text.endswith(":"):
                section = text.rstrip(":")
                continue
            try:
                ingredient = parse_ingredient(text, sort_order=len(ingredients))
            except ValueError as exc:
                raise SourceBlocked("ingredient_quantity_invalid", source_url, str(exc)) from exc
            ingredients.append(ingredient | {"section": section})
    instructions: list[dict[str, Any]] = [
        {"step_number": number, "text": li.get_text(" ", strip=True)}
        for number, li in enumerate(
            (
                li
                for node in _section(body, "directions", source_url)
                for li in node.select("ol > li")
            ),
            1,
        )
    ]
    if not 1 <= len(ingredients) <= 100 or not 1 <= len(instructions) <= 100:
        raise SourceBlocked(
            "recipe_incomplete", source_url, "Empty/oversized ingredients or directions"
        )
    if any(not step["text"] or len(step["text"]) > 10_000 for step in instructions):
        raise SourceBlocked("recipe_incomplete", source_url, "Empty instruction")
    prep = _minutes(facts.get("prep time", ""), source_url)
    cook = _minutes(facts.get("cook time", ""), source_url)
    if prep + cook > 1440:
        raise SourceBlocked("timing_unverified", source_url, "Total exceeds one day")
    description = body.find("p")
    return {
        "name": record["name"],
        "description": description.get_text(" ", strip=True) if description else None,
        "servings": servings,
        "prep_minutes": prep,
        "cook_minutes": cook,
        "total_minutes": prep + cook,
        "ingredients": ingredients,
        "instructions": instructions,
        "nutrition": nutrition,
        "difficulty": "requires_review",
        "meal_type": record.get("meal_type", "requires_review"),
        "source_type": "official_source",
        "source_url": source_url,
        "source_title": record["name"],
        "accept_placeholder_photo": False,
    }


def _image(record: dict[str, Any], source_url: str) -> dict[str, Any]:
    image = record.get("image")
    required = {
        "source_url",
        "photo_url",
        "license",
        "license_url",
        "creator",
        "credit",
        "evidence",
        "reviewed_on",
    }
    if (
        not isinstance(image, dict)
        or not required <= image.keys()
        or image.get("permission_verified") is not True
        or any(not isinstance(image[key], str) or not image[key].strip() for key in required)
    ):
        raise SourceBlocked(
            "photo_rights_unverified",
            source_url,
            "No exact-asset permission evidence; domain/policy alone is insufficient",
        )
    license_name = "Public domain" if image["license"] == "public-domain" else image["license"]
    if license_name not in PERMITTED_LICENSES:
        raise SourceBlocked(
            "photo_license_not_enabled",
            source_url,
            "Only verified public-domain, CC0, CC BY 4.0 and CC BY-SA 4.0 photos are enabled",
        )
    if license_name.startswith("CC BY"):
        license_slug = "by-sa" if license_name == "CC BY-SA 4.0" else "by"
        if (
            image["license_url"] != f"https://creativecommons.org/licenses/{license_slug}/4.0/"
            or any(
                not isinstance(image.get(key), str) or not image[key].strip()
                for key in ("title", "modifications")
            )
        ):
            raise SourceBlocked(
                "photo_evidence_invalid", source_url,
                "Attribution licenses require the exact license URL, title and modifications",
            )
    if (
        not _https_url(image["photo_url"], PHOTO_HOSTS)
        or not _https_url(image["source_url"], HTML_HOSTS | {"commons.wikimedia.org"})
        or not _https_url(image["license_url"], PHOTO_HOSTS | {"creativecommons.org"})
        or image.get("asset_url") != image["photo_url"]
    ):
        raise SourceBlocked(
            "photo_evidence_invalid",
            source_url,
            "Permission record must identify the exact allowlisted HTTPS asset",
        )
    return dict(image) | {"license": license_name}


async def _resolve_image(record: dict[str, Any], source_url: str) -> dict[str, Any]:
    image = record.get("image")
    page = image.get("photo_page_url") if isinstance(image, dict) else None
    if not page:
        return _image(record, source_url)
    if not isinstance(page, str) or not _https_url(page, {"commons.wikimedia.org"}):
        raise SourceBlocked("photo_evidence_invalid", source_url, "Invalid Commons evidence URL")
    assert isinstance(image, dict)
    # Main owns the file-page license parser and image downloader/storage. This
    # module resolves rights, never uploads or downloads image bytes.
    from app.services.content_media import ContentPhotoError, commons_photo

    try:
        async with asyncio.timeout(FETCH_TIMEOUT_SECONDS):
            photo = await commons_photo(page)
    except (ContentPhotoError, HTTPException, httpx.HTTPError, OSError, TimeoutError) as exc:
        raise SourceBlocked("photo_rights_unverified", source_url, type(exc).__name__) from exc
    if photo.evidence.get("source_url") != page or any(
        image.get(key) is not None and image[key] != photo.evidence.get(key)
        for key in ("license", "creator")
    ):
        raise SourceBlocked(
            "photo_evidence_changed", source_url,
            "Resolved file page, license or creator differs from the reviewed photo",
        )
    metadata = {
        **photo.evidence,
        "photo_page_url": page,
        "photo_url": photo.url,
        "asset_url": photo.url,
        "evidence": photo.evidence.get("verification", "Individual Commons file-page license"),
        "reviewed_on": datetime.now(UTC).date().isoformat(),
        "representative": True,
        "depicts": image.get("depicts", record["name"]),
        "relationship": "Independent representative photo; not a photograph of this NHLBI recipe",
        "relevance_review": image.get("relevance_review", ""),
        "additional_credit": image.get("additional_credit", ""),
    }
    return _image({"image": metadata}, source_url)


async def load_recipe(url: str) -> SourceCandidate:
    """One recipe fetch, optionally one Commons evidence fetch. No image/DB writes.

    The shared fetcher must enforce allowed_hosts and https_only at every redirect.
    Older fetchers fail closed rather than following an unallowlisted redirect.
    """
    record = _record(url)
    parameters = inspect.signature(fetch_public_html).parameters
    if not {"allowed_hosts", "https_only"} <= parameters.keys():
        raise SourceBlocked(
            "fetch_policy_unavailable",
            url,
            "Shared HTML fetcher needs per-hop allowed_hosts/https_only guards",
        )
    try:
        async with asyncio.timeout(FETCH_TIMEOUT_SECONDS):
            html, final_url = await fetch_public_html(
                url,
                allowed_hosts=HTML_HOSTS,
                https_only=True,
            )
    except (TimeoutError, OSError, httpx.HTTPError, HTTPException) as exc:
        raise SourceBlocked("source_fetch_failed", url, type(exc).__name__) from exc
    # Permit only the bare-host alias, never a different recipe or an index/login page.
    canonical_final = final_url.replace("https://nhlbi.nih.gov/", "https://www.nhlbi.nih.gov/", 1)
    if not _https_url(final_url, HTML_HOSTS) or canonical_final != url:
        raise SourceBlocked(
            "source_redirect_not_allowed", url, "Fetch did not end at the registered recipe"
        )
    payload = parse_recipe_html(html, url)
    image = await _resolve_image(record, url)
    payload["photo_url"] = image.pop("photo_url")
    attribution = (
        "Source: National Heart, Lung, and Blood Institute; National Institutes of Health; "
        "U.S. Department of Health and Human Services."
    )
    caption = (
        f"Representative photo of {image['depicts']}; not a photograph of this NHLBI recipe. "
        if image.get("representative")
        else ""
    )
    payload["description"] = "\n\n".join(
        text
        for text in [
            payload.get("description"),
            attribution,
            caption + image["credit"] + " " + image["license_url"],
            image.get("additional_credit"),
        ]
        if text
    )
    provenance = {
        "approval_status": "pending_approval",
        "parser": "nhlbi-html-v1",
        "source_url": url,
        "final_url": final_url,
        "retrieved_at": datetime.now(UTC).isoformat(),
        "html_sha256": hashlib.sha256(html.encode("utf-8")).hexdigest(),
        "nutrition_basis": "per_serving",
        "nutrition_basis_verified": True,
        "nutrition": {
            "source_url": url,
            "basis": "serving",
            "verified": True,
            "serving_size": record["nutrition_evidence"]["serving_size"],
            "evidence": record["nutrition_evidence"],
        },
        "image": image,
    }
    warnings = list(record.get("warnings", [])) + (
        [caption.strip(), image["relevance_review"]] if image.get("representative") else []
    )
    return SourceCandidate(
        "recipe",
        payload,
        url,
        SOURCE_NAME,
        payload["photo_url"],
        provenance,
        [warning for warning in warnings if warning],
    )
