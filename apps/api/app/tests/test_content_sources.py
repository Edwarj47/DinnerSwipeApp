"""Source contract fixtures; live read-only preflight is explicitly opt-in."""

from __future__ import annotations

import asyncio
import copy
import os
from dataclasses import asdict
from html import escape
from typing import Any

import httpx
import pytest

from app.services import content_sources as sources
from app.services.content_media import PERMITTED_LICENSES

URL = sources.RECIPE_PREFIX + "20-minute-chicken-creole"
PHOTO = "https://upload.wikimedia.org/wikipedia/commons/a/a1/Test_dish.jpg"
PAGE = "https://commons.wikimedia.org/wiki/File:Test_dish.jpg"


def recipe_html(
    *,
    title: str = "20-Minute Chicken Creole",
    servings: str = "4 servings",
    serving_size: str = "1\u00bd C",
    prep: str = "15 minutes",
    cook: str = "20 minutes",
    nutrients: dict[str, str] | None = None,
    ingredients: str = "<li>1/2 cup oats</li><li>1 1/2 Tbsp oil</li><li>Cooking spray</li>",
    instructions: str = "<li>Combine ingredients.</li><li>Cook until done.</li>",
) -> str:
    facts = {
        "Prep Time": prep,
        "Cook Time": cook,
        "Yields": servings,
        "Serving Size": serving_size,
    }
    nutrition = (
        nutrients
        if nutrients is not None
        else {
            "Calories": "274",
            "Total Fat": "5 g",
            "Saturated Fat": "1 g",
            "Protein": "30 g",
            "Carbohydrates": "30 g",
            "Total Fiber": "4 g",
        }
    )

    def table_rows(values: dict[str, str]) -> str:
        return "".join(
            f"<tr><th>{escape(k)}</th><td><div>{escape(v)}</div></td></tr>"
            for k, v in values.items()
        )

    return (
        '<meta property="og:image" content="https://www.nhlbi.nih.gov/logo.png">'
        '<h1>Healthy Eating Recipes</h1><article class="node--type-recipe">'
        f"<h1><span>{escape(title)}</span></h1>"
        '<div class="field--name-body"><p>Synthetic fixture.</p>'
        f"<h2>Ingredients</h2><ul>{ingredients}</ul>"
        f"<h2>Directions</h2><ol>{instructions}</ol></div>"
        f'<table class="cooking-facts">{table_rows(facts)}</table>'
        f'<table class="health-facts">{table_rows(nutrition)}</table></article>'
    )


@pytest.fixture
def registry(monkeypatch: pytest.MonkeyPatch) -> dict[str, Any]:
    data = copy.deepcopy(sources._registry())
    monkeypatch.setattr(sources, "_registry", lambda: data)
    return data


def approved_image() -> dict[str, Any]:
    # Synthetic permission evidence used only in unit tests, not the live registry.
    return {
        "photo_url": PHOTO,
        "asset_url": PHOTO,
        "source_url": PAGE,
        "license": "CC0-1.0",
        "license_url": "https://creativecommons.org/publicdomain/zero/1.0/",
        "creator": "Fixture author",
        "credit": "Photo: Fixture author. CC0.",
        "permission_verified": True,
        "evidence": "Synthetic exact-asset test permission",
        "reviewed_on": "2026-10-16",
    }


def guarded_fetch(monkeypatch: pytest.MonkeyPatch, html: str, final: str = URL) -> list[str]:
    calls: list[str] = []

    async def fetch(url: str, *, allowed_hosts: Any, https_only: bool) -> tuple[str, str]:
        assert allowed_hosts == sources.HTML_HOSTS
        assert https_only is True
        calls.append(url)
        return html, final

    monkeypatch.setattr(sources, "fetch_public_html", fetch)
    return calls


@pytest.mark.parametrize(
    ("text", "expected"),
    [
        ("1/2 cup oats", 0.5),
        ("1 1/2 cup oats", 1.5),
        ("\u00bd cup oats", 0.5),
        ("1\u00bd cup oats", 1.5),
        ("1 \u00bd cup oats", 1.5),
        ("\u2153 cup oats", 1 / 3),
        ("1.25 cup oats", 1.25),
        ("12 cup oats", 12.0),
    ],
)
def test_exact_fraction_quantity(text: str, expected: float) -> None:
    result = sources.parse_ingredient(text)
    assert result["quantity"] == expected
    assert result["normalized_name"] == "oats"
    assert result["unit"] == "cup"
    assert result["original_text"] == text


@pytest.mark.parametrize("text", ["1/0 cup oats", "1 1/0 cup oats"])
def test_zero_denominator_is_a_controlled_error(text: str) -> None:
    with pytest.raises(ValueError, match="Invalid ingredient fraction"):
        sources.parse_ingredient(text)


@pytest.mark.parametrize(
    "text", ["1-2 cups oats", "1\u20132 cups oats", "1 to 2 cups oats", "Cooking spray"]
)
def test_unknown_and_ranges_do_not_guess(text: str) -> None:
    result = sources.parse_ingredient(text)
    assert result["quantity"] is None and result["unit"] is None
    assert result["original_text"] == result["normalized_name"] == text


def test_fixed_queue_url_identity_and_exclusion() -> None:
    queue = sources.recipe_sources()
    assert len(queue) == len(set(queue)) == 54
    assert sources.recipe_sources(exclude_urls=queue[:2], limit=3) == queue[2:5]
    assert sources.recipe_sources(limit=0) == []
    with pytest.raises(ValueError):
        sources.recipe_sources(limit=55)


def test_live_registry_has_reviewed_pool_and_honest_capacity() -> None:
    data = sources._registry()
    eligible = [
        url
        for url, record in data["recipes"].items()
        if record.get("nutrition_evidence") and record.get("image")
    ]
    assert len(eligible) >= 12
    assert data["verified_photo_count"] == len(eligible)
    assert data["campaign_capacity"]["verified_complete_recipes"] == len(eligible)
    assert data["campaign_capacity"]["remaining_blocked_urls"] == 54 - len(eligible)
    assert sources.recipe_sources()[: len(eligible)] == eligible
    assert data["campaign_capacity"]["requested_unique_recipes"] == 175
    assert data["campaign_capacity"]["unique_recipe_shortfall"] == 175 - len(eligible)
    assert data["campaign_capacity"]["full_five_recipe_dates"] == len(eligible) // 5
    assert data["campaign_capacity"]["remainder_recipes"] == len(eligible) % 5
    assert data["campaign_capacity"]["guaranteed_full_campaign"] is False
    for url in eligible:
        record = data["recipes"][url]
        evidence = record["nutrition_evidence"]
        assert evidence["basis"] == "serving"
        assert set(evidence["values"]) == {field for field, _ in sources.NUTRIENTS.values()}
        assert evidence["source_url"].startswith("https://www.nhlbi.nih.gov/")
        assert "#page=" in evidence["source_url"]
        assert record["image"]["photo_page_url"].startswith(
            "https://commons.wikimedia.org/wiki/File:"
        )
        assert record["image"]["depicts"] and record["image"]["relevance_review"]
        assert record["meal_type"] in {"dinner", "lunch", "snack", "beverage"}


def test_bounded_expansion_keeps_primary_evidence_and_exclusions() -> None:
    data = sources._registry()
    records = data["recipes"]
    pages = {
        "asparagus-lemon-sauce": (117, "103"),
        "chicken-and-mushroom-fricassee": (39, "25"),
        "cold-fusilli-pasta-summer": (79, "65"),
        "creamy-squash-soup-shredded-apples": (128, "114"),
    }
    for slug, (page, printed) in pages.items():
        evidence = records[sources.RECIPE_PREFIX + slug]["nutrition_evidence"]
        assert evidence["source_url"] == (
            "https://www.nhlbi.nih.gov/sites/default/files/publications/10-2921.pdf"
            f"#page={page}"
        )
        assert evidence["printed_page"] == printed
        assert evidence["basis"] == "serving"
        assert evidence["review_note"]
    tuna = records[sources.RECIPE_PREFIX + "grilled-tuna-chickpea-and-spinach"]["image"]
    assert tuna["photo_page_url"] == "https://commons.wikimedia.org/wiki/File:Grilled_Tuna.jpg"
    assert tuna["creator"] == "MDRX" and tuna["license"] == "CC BY-SA 4.0"
    assert "chickpea-spinach" in tuna["relevance_review"]
    for slug in ["baked-salmon-dijon", "summer-breeze-smoothie", "rainbow-fruit-salad"]:
        blocked = records[sources.RECIPE_PREFIX + slug]
        assert not blocked.get("image") and not blocked.get("nutrition_evidence")
        assert blocked["blocked_reason"]
    assert all(url.startswith(sources.RECIPE_PREFIX) for url in records)
    assert "nhs" in data["excluded_sources"]


def test_reusable_but_misleading_photo_does_not_make_recipe_eligible() -> None:
    record = sources._registry()["recipes"][
        sources.RECIPE_PREFIX + "heavenly-chicken-angel-hair-pasta"
    ]
    assert record["image"] is None
    assert record["nutrition_evidence"]["basis"] == "serving"
    assert "misrepresents" in record["blocked_reason"]
    assert "Excluded" in record["photo_research"]["finding"]


def test_curated_meal_types_and_unset_difficulty() -> None:
    from app.schemas.content_automation import RecipeCandidateInput

    registry = sources._registry()["recipes"]
    reviewed = {
        "red-beans-and-rice": "dinner",
        "chicken-salad": "lunch",
        "lentil-soup": "lunch",
        "mango-shake": "beverage",
        "savory-potato-salad": "snack",
        "strawberry-banana-yogurt-parfait": "snack",
    }
    for slug, category in reviewed.items():
        entry = registry[sources.RECIPE_PREFIX + slug]
        url = sources.RECIPE_PREFIX + slug
        facts = entry["nutrition_evidence"]
        payload = sources.parse_recipe_html(
            recipe_html(
                title=entry["name"],
                servings=f"{facts['servings']} servings",
                serving_size=facts["serving_size"],
                nutrients={
                    label: str(facts["values"][field]) + ("" if field == "calories" else " g")
                    for label, (field, _) in sources.NUTRIENTS.items()
                },
            ),
            url,
        )
        payload["photo_url"] = PHOTO
        validated = RecipeCandidateInput.model_validate(payload)
        assert validated.meal_type == category
        assert validated.difficulty == "requires_review"


def test_late_eligible_records_cannot_be_starved_by_blocked_records(
    registry: dict[str, Any],
) -> None:
    records = registry["recipes"]
    eligible = [url for url, record in records.items() if record.get("image")]
    blocked = [url for url in records if url not in eligible]
    registry["recipes"] = {url: records[url] for url in [*blocked, *eligible]}
    assert sources.recipe_sources(limit=20)[: len(eligible)] == eligible
    assert sources.recipe_sources(exclude_urls=eligible[:3], limit=2) == eligible[3:5]


@pytest.mark.parametrize(
    ("value", "expected"),
    [
        ("1 hour", 60),
        ("1 hour 30 minutes", 90),
        ("2 hours 20 minutes", 140),
        ("0 minutes", 0),
        ("24 hours", 1440),
    ],
)
def test_exact_published_hour_minute_timing(value: str, expected: int) -> None:
    assert sources._minutes(value, URL) == expected


@pytest.mark.parametrize("value", ["1-2 hours", "about 1 hour", "25 hours", "1.5 hours"])
def test_nonexact_or_unbounded_timing_blocks(value: str) -> None:
    with pytest.raises(sources.SourceBlocked, match="timing_unverified"):
        sources._minutes(value, URL)


def test_source_parser_full_five_no_double_serving_division() -> None:
    result = sources.parse_recipe_html(recipe_html(), URL)
    assert result["servings"] == 4
    assert result["nutrition"] == {
        "calories": 274,
        "protein_g": 30,
        "carbs_g": 30,
        "fat_g": 5,
        "fiber_g": 4,
    }
    assert result["total_minutes"] == 35
    assert result["ingredients"][0]["quantity"] == 0.5
    assert result["ingredients"][1]["quantity"] == 1.5
    assert len(result["instructions"]) == 2
    assert result["accept_placeholder_photo"] is False
    assert "photo_url" not in result


def test_yield_is_not_a_four_serving_fallback(registry: dict[str, Any]) -> None:
    registry["recipes"][URL]["nutrition_evidence"]["servings"] = 6
    assert sources.parse_recipe_html(recipe_html(servings="6 servings"), URL)["servings"] == 6


@pytest.mark.parametrize(
    ("options", "code"),
    [
        ({"servings": ""}, "yield_unverified"),
        ({"servings": "1/2 servings"}, "yield_unverified"),
        ({"servings": "6 servings"}, "nutrition_evidence_changed"),
        ({"serving_size": ""}, "nutrition_basis_unverified"),
        ({"serving_size": "per 100 g"}, "nutrition_evidence_changed"),
        ({"prep": ""}, "timing_unverified"),
        ({"cook": "10-20 minutes"}, "timing_unverified"),
        ({"ingredients": ""}, "recipe_incomplete"),
        ({"instructions": ""}, "recipe_incomplete"),
        ({"ingredients": "<li>1/0 cup oats</li>"}, "ingredient_quantity_invalid"),
        ({"title": "Another recipe"}, "recipe_identity_changed"),
    ],
)
def test_incomplete_or_changed_content_blocks(options: dict[str, Any], code: str) -> None:
    with pytest.raises(sources.SourceBlocked) as caught:
        sources.parse_recipe_html(recipe_html(**options), URL)
    assert caught.value.code == code
    assert caught.value.source_url == URL and caught.value.reason


@pytest.mark.parametrize(
    "value", ["", "less than 1 g", "0 (less than 1g)", "5 mg", "NaN g", "-1 g"]
)
def test_missing_ambiguous_units_and_nonexact_nutrition_block(value: str) -> None:
    nutrition = {
        "Calories": "274",
        "Total Fat": "5 g",
        "Protein": "30 g",
        "Carbohydrates": "30 g",
        "Total Fiber": value,
    }
    with pytest.raises(sources.SourceBlocked, match="nutrition_unverified"):
        sources.parse_recipe_html(recipe_html(nutrients=nutrition), URL)


def test_zero_fiber_is_not_treated_as_missing(registry: dict[str, Any]) -> None:
    registry["recipes"][URL]["nutrition_evidence"]["values"]["fiber_g"] = 0
    nutrition = {
        "Calories": "274",
        "Total Fat": "5 g",
        "Protein": "30 g",
        "Carbohydrates": "30 g",
        "Total Fiber": "0 g",
    }
    assert (
        sources.parse_recipe_html(recipe_html(nutrients=nutrition), URL)["nutrition"]["fiber_g"]
        == 0
    )


def test_no_assumed_nutrition_basis(registry: dict[str, Any]) -> None:
    del registry["recipes"][URL]["nutrition_evidence"]
    with pytest.raises(sources.SourceBlocked, match="nutrition_basis_unverified"):
        sources.parse_recipe_html(recipe_html(), URL)


def test_nested_ingredient_sections_preserved() -> None:
    html = recipe_html(
        ingredients=(
            "<li>1/2 cup oats</li><li>For sauce:<ul><li>1 Tbsp oil</li>"
            "<li>2 tsp herbs (optional)</li></ul></li>"
        )
    )
    ingredients = sources.parse_recipe_html(html, URL)["ingredients"]
    assert len(ingredients) == 3
    assert ingredients[1]["section"] == "For sauce"
    assert ingredients[2]["is_optional"] is True


def test_oversized_and_wrong_layout_block() -> None:
    with pytest.raises(sources.SourceBlocked, match="source_too_large"):
        sources.parse_recipe_html("x" * (sources.MAX_HTML_BYTES + 1), URL)
    with pytest.raises(sources.SourceBlocked, match="recipe_layout_changed"):
        sources.parse_recipe_html("<html>A consent page</html>", URL)


def test_duplicate_table_field_is_not_arbitrarily_chosen() -> None:
    html = recipe_html().replace(
        "</table>", "<tr><th>Yields</th><td>8 servings</td></tr></table>", 1
    )
    with pytest.raises(sources.SourceBlocked, match="ambiguous_recipe_field"):
        sources.parse_recipe_html(html, URL)


@pytest.mark.parametrize(
    "url",
    [
        "http://www.nhlbi.nih.gov/a",
        "https://127.0.0.1/a",
        "https://www.nhlbi.nih.gov.evil.example/a",
        "https://user:password@www.nhlbi.nih.gov/a",
        URL + "?page=1",
        URL + "#fragment",
        URL.replace(".gov/", ".gov:444/"),
        sources.RECIPE_PREFIX + "not-registered",
    ],
)
def test_unregistered_source_never_fetches(monkeypatch: pytest.MonkeyPatch, url: str) -> None:
    def never_fetch(*args: Any, **kwargs: Any) -> None:
        pytest.fail("Unregistered URL reached the network")

    monkeypatch.setattr(sources, "fetch_public_html", never_fetch)
    with pytest.raises(sources.SourceBlocked, match="source_not_allowlisted"):
        asyncio.run(sources.load_recipe(url))


def test_unguarded_fetcher_never_runs(monkeypatch: pytest.MonkeyPatch) -> None:
    async def legacy_fetch(url: str) -> tuple[str, str]:
        pytest.fail("Fetcher without redirect policy was invoked")

    monkeypatch.setattr(sources, "fetch_public_html", legacy_fetch)
    with pytest.raises(sources.SourceBlocked, match="fetch_policy_unavailable"):
        asyncio.run(sources.load_recipe(URL))


@pytest.mark.parametrize(
    "final",
    ["https://example.org/a", "http://www.nhlbi.nih.gov/a", sources.RECIPE_PREFIX],
)
def test_redirect_identity_blocks(monkeypatch: pytest.MonkeyPatch, final: str) -> None:
    guarded_fetch(monkeypatch, recipe_html(), final)
    with pytest.raises(sources.SourceBlocked, match="source_redirect_not_allowed"):
        asyncio.run(sources.load_recipe(URL))


def test_fetch_exception_is_quality_skip(monkeypatch: pytest.MonkeyPatch) -> None:
    async def fail(url: str, *, allowed_hosts: Any, https_only: bool) -> tuple[str, str]:
        raise httpx.ReadTimeout("Synthetic timeout")

    monkeypatch.setattr(sources, "fetch_public_html", fail)
    with pytest.raises(sources.SourceBlocked, match="source_fetch_failed"):
        asyncio.run(sources.load_recipe(URL))


def test_no_photo_never_substitutes_logo(monkeypatch: pytest.MonkeyPatch) -> None:
    calls = guarded_fetch(monkeypatch, recipe_html())
    with pytest.raises(sources.SourceBlocked, match="photo_rights_unverified"):
        asyncio.run(sources.load_recipe(URL))
    assert calls == [URL]


@pytest.mark.parametrize(
    "changes",
    [
        {"permission_verified": False},
        {"creator": ""},
        {"credit": ""},
        {"evidence": ""},
        {"asset_url": PHOTO + "other"},
        {"photo_url": "http://upload.wikimedia.org/a.jpg"},
        {"license": "CC-BY-4.0"},
        {"license": "unknown"},
    ],
)
def test_unknown_and_unenabled_rights_block(
    monkeypatch: pytest.MonkeyPatch, registry: dict[str, Any], changes: dict[str, Any]
) -> None:
    guarded_fetch(monkeypatch, recipe_html())
    registry["recipes"][URL]["image"] = approved_image() | changes
    with pytest.raises(sources.SourceBlocked):
        asyncio.run(sources.load_recipe(URL))


@pytest.mark.parametrize("license_name", sorted(PERMITTED_LICENSES))
def test_shared_photo_license_policy_preserves_exact_asset_evidence(license_name: str) -> None:
    from app.services.content_media import LICENSE_URLS

    evidence = approved_image() | {
        "license": license_name,
        "license_url": LICENSE_URLS[license_name],
        "title": "Test dish",
        "modifications": "Resized and camera metadata removed for Dinner Swipe.",
    }
    assert sources._image({"image": evidence}, URL)["license"] == license_name
    with pytest.raises(sources.SourceBlocked, match="photo_evidence_invalid"):
        sources._image({"image": evidence | {"asset_url": PHOTO + "other"}}, URL)


@pytest.mark.parametrize("license_name", ["CC BY 4.0", "CC BY-SA 4.0"])
@pytest.mark.parametrize(
    "changes",
    [
        {"title": ""},
        {"title": "  "},
        {"title": 42},
        {"modifications": None},
        {"modifications": "  "},
        {"license_url": "https://creativecommons.org/licenses/by/3.0/"},
    ],
)
def test_attribution_license_needs_title_modifications_and_exact_license(
    license_name: str, changes: dict[str, Any]
) -> None:
    from app.services.content_media import LICENSE_URLS

    evidence = approved_image() | {
        "license": license_name,
        "license_url": LICENSE_URLS[license_name],
        "title": "Test dish",
        "modifications": "Resized and camera metadata removed for Dinner Swipe.",
    }
    with pytest.raises(sources.SourceBlocked, match="photo_evidence_invalid"):
        sources._image({"image": evidence | changes}, URL)


def test_complete_candidate_contract_and_pending_approval(
    monkeypatch: pytest.MonkeyPatch, registry: dict[str, Any]
) -> None:
    guarded_fetch(monkeypatch, recipe_html(), URL.replace("www.nhlbi", "nhlbi"))
    registry["recipes"][URL]["image"] = approved_image()
    candidate = asyncio.run(sources.load_recipe(URL))
    assert set(asdict(candidate)) == {
        "kind",
        "payload",
        "source_url",
        "source_name",
        "photo_url",
        "provenance",
        "warnings",
    }
    assert candidate.kind == "recipe" and candidate.source_url == URL
    assert candidate.photo_url == candidate.payload["photo_url"] == PHOTO
    assert candidate.provenance["approval_status"] == "pending_approval"
    assert candidate.provenance["nutrition"]["basis"] == "serving"
    assert candidate.provenance["nutrition"]["verified"] is True
    assert candidate.provenance["image"]["permission_verified"] is True
    assert len(candidate.provenance["html_sha256"]) == 64


def test_commons_file_page_runtime_resolution(
    monkeypatch: pytest.MonkeyPatch, registry: dict[str, Any]
) -> None:
    from app.services import content_media

    calls: list[str] = []

    async def resolve(page: str) -> Any:
        calls.append(page)
        return content_media.ResolvedPhoto(
            url=PHOTO,
            evidence=approved_image() | {"verification": "Individual file-page license"},
        )

    monkeypatch.setattr(content_media, "commons_photo", resolve)
    guarded_fetch(monkeypatch, recipe_html())
    registry["recipes"][URL]["image"] = {
        "photo_page_url": PAGE,
        "depicts": "A similar dish",
    }
    candidate = asyncio.run(sources.load_recipe(URL))
    assert calls == [PAGE]
    assert candidate.provenance["image"]["photo_page_url"] == PAGE
    assert candidate.provenance["image"]["representative"] is True
    assert "Representative photo of A similar dish" in candidate.payload["description"]
    assert "not a photograph of this NHLBI recipe" in candidate.payload["description"]
    assert candidate.warnings


@pytest.mark.parametrize(
    "changes",
    [
        {"source_url": "https://commons.wikimedia.org/wiki/File:Another_dish.jpg"},
        {"license": "CC BY 4.0"},
        {"creator": "Another photographer"},
    ],
)
def test_reviewed_commons_identity_creator_and_license_changes_fail_closed(
    monkeypatch: pytest.MonkeyPatch, changes: dict[str, Any]
) -> None:
    from app.services import content_media

    async def resolve(page: str) -> Any:
        return content_media.ResolvedPhoto(url=PHOTO, evidence=approved_image() | changes)

    monkeypatch.setattr(content_media, "commons_photo", resolve)
    record = {"image": {"photo_page_url": PAGE, "license": "CC0-1.0", "creator": "Fixture author"}}
    with pytest.raises(sources.SourceBlocked, match="photo_evidence_changed"):
        asyncio.run(sources._resolve_image(record, URL))


def test_attributed_commons_candidate_retains_credit_and_representative_warning(
    monkeypatch: pytest.MonkeyPatch, registry: dict[str, Any]
) -> None:
    from app.services import content_media

    evidence = approved_image() | {
        "license": "CC BY-SA 4.0",
        "license_url": "https://creativecommons.org/licenses/by-sa/4.0/",
        "title": "Test dish",
        "modifications": "Resized and camera metadata removed for Dinner Swipe.",
        "credit": "Test dish by Fixture author. CC BY-SA 4.0. Resized. Share alike.",
    }

    async def resolve(page: str) -> Any:
        return content_media.ResolvedPhoto(url=PHOTO, evidence=evidence)

    monkeypatch.setattr(content_media, "commons_photo", resolve)
    guarded_fetch(monkeypatch, recipe_html())
    registry["recipes"][URL]["image"] = {
        "photo_page_url": PAGE,
        "license": "CC BY-SA 4.0",
        "creator": "Fixture author",
        "depicts": "Independent chicken dish",
        "relevance_review": "The sauce and portion differ.",
    }
    candidate = asyncio.run(sources.load_recipe(URL))
    image = candidate.provenance["image"]
    for field in ["title", "license", "license_url", "creator", "credit", "modifications"]:
        assert image[field] == evidence[field]
    assert evidence["credit"] in candidate.payload["description"]
    assert evidence["license_url"] in candidate.payload["description"]
    assert "The sauce and portion differ." in candidate.warnings


def test_commons_thumbnail_host_is_supported() -> None:
    photo = "https://thumb.wikimedia.org/wikipedia/commons/thumb/a/a1/Dish.jpg/960px-Dish.jpg"
    evidence = approved_image() | {"photo_url": photo, "asset_url": photo}
    assert sources._image({"image": evidence}, URL)["photo_url"] == photo


def test_commons_rejected_license_is_blocked(
    monkeypatch: pytest.MonkeyPatch, registry: dict[str, Any]
) -> None:
    from app.services import content_media

    async def rejected(page: str) -> Any:
        raise content_media.ContentPhotoError("Copyrighted")

    monkeypatch.setattr(content_media, "commons_photo", rejected)
    guarded_fetch(monkeypatch, recipe_html())
    registry["recipes"][URL]["image"] = {"photo_page_url": PAGE}
    with pytest.raises(sources.SourceBlocked, match="photo_rights_unverified"):
        asyncio.run(sources.load_recipe(URL))


@pytest.mark.skipif(
    os.environ.get("DINNER_CONTENT_SOURCES_LIVE") != "1",
    reason="Opt-in read-only primary-source and photo downloads",
)
def test_live_reviewed_recipes_pass_worker_preflight(monkeypatch: pytest.MonkeyPatch) -> None:
    from app.services.photo_credit import credit_from_evidence
    from app.workers import content_daily
    from app.workers.content_daily import clean_payload, record, resolve_photo

    def no_writes(*args: Any, **kwargs: Any) -> Any:
        pytest.fail("Read-only preflight attempted a database connection or owned-media write")

    monkeypatch.setattr(content_daily, "SessionLocal", no_writes)
    monkeypatch.setattr(content_daily, "own_photo", no_writes)

    async def check() -> None:
        cache: dict[str, Any] = {}
        passed: list[str] = []
        for url in sources.recipe_sources():
            entry = sources._record(url)
            if not entry.get("image") or not entry.get("nutrition_evidence"):
                continue
            candidate = await sources.load_recipe(url)
            item = record(candidate)
            photo, data = await resolve_photo(item, cache)
            payload = clean_payload(item, "https://dinner.dcss.dev/api/v1/media/objects/preflight")
            assert photo.evidence["permission_verified"] is True
            assert data and len(data) <= 786_432
            assert payload["nutrition"] == entry["nutrition_evidence"]["values"]
            assert payload["servings"] == entry["nutrition_evidence"]["servings"]
            assert payload["accept_placeholder_photo"] is False
            assert payload["meal_type"] == entry["meal_type"]
            assert payload["difficulty"] == "requires_review"
            assert payload["ingredients"] and payload["instructions"]
            assert payload["total_minutes"] == payload["prep_minutes"] + payload["cook_minutes"]
            assert credit_from_evidence(photo.evidence) is not None
            assert photo.evidence["license"] in PERMITTED_LICENSES
            for field in ("license", "creator"):
                if field in entry["image"]:
                    assert photo.evidence[field] == entry["image"][field]
            assert candidate.warnings
            passed.append(payload["name"])
            print(f"PREFLIGHT PASS: {payload['name']} ({len(data)} image bytes)", flush=True)
            await asyncio.sleep(1)
        assert len(set(passed)) == len(passed) == sources._registry()["verified_photo_count"]
        print(f"VERIFIED RECIPE POOL: {len(passed)}; requested campaign: 175", flush=True)

    asyncio.run(check())
