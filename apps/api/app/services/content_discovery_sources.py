"""Bounded catalog link discovery, not permission to copy or publish source content."""

from __future__ import annotations

import asyncio
import hashlib
import re
from dataclasses import dataclass
from urllib.parse import urldefrag, urljoin, urlsplit
from urllib.robotparser import RobotFileParser

from bs4 import BeautifulSoup

from app.ingestion.url_fetcher import fetch_public_bytes

MEDLINE = "https://medlineplus.gov"
NHS = "https://www.nhs.uk"
HOSTS = frozenset({"medlineplus.gov", "www.nhs.uk"})
USER_AGENT = "DinnerSwipeRecipeIngestion"
RECIPE_CATEGORIES = (
    "dinner",
    "breakfast",
    "lunch",
    "soups",
    "salads",
    "side-dishes",
    "snacks",
    "vegetarian",
    "breads",
    "drinks",
    "dips-salsas-and-sauces",
)
WORKOUT_CATEGORIES = ("", "strength-and-resistance/", "aerobic-exercises/", "pilates-and-yoga/")
EXERCISE_ROOT = "/live-well/exercise/"
MAX_HTML_BYTES = 1_000_000


@dataclass(frozen=True)
class Catalog:
    url: str
    kind: str
    source_name: str


def catalogs(day_index: int) -> list[Catalog]:
    # Rotate two recipe categories and two exercise indexes, never recurse into links.
    categories = [RECIPE_CATEGORIES[(day_index * 2 + n) % len(RECIPE_CATEGORIES)] for n in range(2)]
    return [
        *[
            Catalog(
                f"{MEDLINE}/recipes/{category}/",
                "recipe",
                "MedlinePlus recipe catalog",
            )
            for category in categories
        ],
        Catalog(f"{NHS}{EXERCISE_ROOT}", "workout", "NHS exercise catalog"),
        Catalog(
            f"{NHS}{EXERCISE_ROOT}{WORKOUT_CATEGORIES[1 + day_index % 3]}",
            "workout",
            "NHS exercise catalog",
        ),
    ]


def allowed_source(url: str, kind: str) -> bool:
    try:
        parts = urlsplit(url)
        if (
            parts.scheme != "https"
            or parts.query
            or parts.fragment
            or parts.username
            or parts.password
            or parts.port is not None
        ):
            return False
        if kind == "recipe":
            return (
                parts.netloc == "medlineplus.gov"
                and bool(re.fullmatch(r"/recipes/[a-z0-9]+(?:-[a-z0-9]+)*/", parts.path))
                and parts.path.split("/")[-2] not in RECIPE_CATEGORIES
            )
        return (
            kind == "workout"
            and parts.netloc == "www.nhs.uk"
            and bool(re.fullmatch(r"/live-well/exercise/[a-z0-9/-]+/", parts.path))
            and not any(
                term in parts.path
                for term in (
                    "sciatica",
                    "pain",
                    "injur",
                    "children",
                    "under-five",
                    "wheelchair",
                    "physical-activity-guidelines",
                    "benefits",
                    "why-sitting",
                    "about-our-videos",
                )
            )
            and parts.path not in {EXERCISE_ROOT + value for value in WORKOUT_CATEGORIES}
        )
    except ValueError:
        return False


def source_id(kind: str, url: str) -> str:
    return hashlib.sha256(f"{kind}:{urldefrag(url)[0]}".encode()).hexdigest()


def parse_catalog(html: str, catalog: Catalog) -> list[dict[str, str]]:
    soup = BeautifulSoup(html, "html.parser")
    # Recipe-card and main-content selectors exclude header/footer navigation.
    selector = (
        ".recipe-card-block-with-height p a[href]" if catalog.kind == "recipe" else "main a[href]"
    )
    found: dict[str, dict[str, str]] = {}
    for anchor in soup.select(selector)[:500]:
        if catalog.kind == "recipe":
            card = anchor.find_parent(class_="recipe-card-block-with-height")
            provider = card.select_one(".recipe-nhlbi") if card else None
            if provider and "nhlbi" in provider.get_text().casefold():
                continue
        url = urljoin(catalog.url, str(anchor.get("href", "")))
        title = " ".join(anchor.get_text(" ", strip=True).split())
        if not allowed_source(url, catalog.kind) or not 3 <= len(title) <= 240:
            continue
        if any(ord(char) < 32 for char in title):
            continue
        identifier = source_id(catalog.kind, url)
        found[identifier] = {
            "id": identifier,
            "kind": catalog.kind,
            "title": title,
            "source_url": url,
            "source_name": catalog.source_name,
            "status": "pending",
        }
    return list(found.values())


async def fetch(url: str, *, robots: bool = False) -> tuple[str, str]:
    data, final_url, encoding = await asyncio.wait_for(
        fetch_public_bytes(
            url,
            maximum=64_000 if robots else MAX_HTML_BYTES,
            kind="robots" if robots else "html",
            allowed_hosts=HOSTS,
            https_only=True,
            follow_redirects=False,
        ),
        timeout=12,
    )
    return data.decode(encoding or "utf-8", errors="replace"), final_url


async def discover(
    day_index: int,
    seen: set[str],
    *,
    collected: list[dict[str, str]] | None = None,
) -> tuple[list[dict[str, str]], list[str]]:
    # The worker owns this accumulator so a later timeout cannot erase successful earlier finds.
    result: list[dict[str, str]] = collected if collected is not None else []
    reasons: list[str] = []
    robots: dict[str, RobotFileParser | None] = {}
    for catalog in catalogs(day_index):
        if sum(item["kind"] == catalog.kind for item in result) >= 5:
            continue
        host = urlsplit(catalog.url).netloc
        try:
            if host not in robots:
                robots[host] = None
                text, final = await fetch(f"https://{host}/robots.txt", robots=True)
                if final != f"https://{host}/robots.txt":
                    raise ValueError("Unexpected robots redirect")
                parsed_policy = RobotFileParser()
                parsed_policy.parse(text.splitlines())
                robots[host] = parsed_policy
            policy = robots[host]
            if policy is None or not policy.can_fetch(USER_AGENT, catalog.url):
                raise ValueError("Catalog discovery not permitted")
            # Honor both named-agent and wildcard rate declarations, including robots-to-index.
            delay = float(policy.crawl_delay(USER_AGENT) or policy.crawl_delay("*") or 1)
            rate = policy.request_rate(USER_AGENT) or policy.request_rate("*")
            await asyncio.sleep(max(1, delay, rate.seconds / rate.requests if rate else 1))
            html, final = await fetch(catalog.url)
            if final != catalog.url:
                raise ValueError("Unexpected catalog redirect")
            links = parse_catalog(html, catalog)
            if not links:
                raise ValueError("Catalog format changed or no eligible links")
            for link in links:
                if (
                    link["id"] in seen
                    or not policy.can_fetch(USER_AGENT, link["source_url"])
                    or sum(item["kind"] == catalog.kind for item in result) >= 5
                ):
                    continue
                seen.add(link["id"])
                result.append(link)
        except Exception:
            # Never persist page bodies, exception strings or arbitrary URLs in reports.
            reasons.append(
                f"One {catalog.kind} catalog could not be checked; no unchecked content copied."
            )
        await asyncio.sleep(1)
    for kind in ("recipe", "workout"):
        count = sum(item["kind"] == kind for item in result)
        if count < 5:
            reasons.append(
                f"Found {count} new {kind} source links; previously seen links are not repeated."
            )
    return result, list(dict.fromkeys(reasons))
