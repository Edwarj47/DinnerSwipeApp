"""Offline catalog contracts; opt in to public-photo preflight with WORKOUT_SOURCE_LIVE=1."""

from __future__ import annotations

import asyncio
import io
import json
import os
import socket
from collections import Counter
from copy import deepcopy
from itertools import product
from typing import Any
from urllib.parse import urlsplit

import pytest
from PIL import Image
from pydantic import ValidationError

from app.schemas.content_automation import WorkoutCandidateInput
from app.schemas.workouts import TemplateInput
from app.services import content_workout_sources as sources
from app.services.content_automation import canonical_source, content_fingerprint, source_identity

RAW = json.loads(sources.CATALOG_PATH.read_text(encoding="utf-8"))


@pytest.fixture()
def raw() -> dict[str, Any]:
    return deepcopy(RAW)


@pytest.fixture(scope="module")
def catalog() -> sources._Catalog:
    return sources._Catalog.model_validate(RAW)


@pytest.mark.parametrize("catalog_id", [routine["catalog_id"] for routine in RAW["routines"]])
def test_every_authored_workout_is_complete(catalog: sources._Catalog, catalog_id: str) -> None:
    routine = next(r for r in catalog.routines if r.catalog_id == catalog_id)
    record = sources._record(catalog, routine)
    base = TemplateInput.model_validate(record["payload"])
    assert base.photo_url is None
    payload = WorkoutCandidateInput.model_validate(
        {
            **record["payload"],
            "photo_url": "https://dinner.dcss.dev/api/v1/media/objects/preflight",
        }
    )
    assert base.model_dump(exclude={"photo_url"}) == payload.model_dump(exclude={"photo_url"})
    assert record["payload"]["photo_url"] is None
    description = payload.description
    assert 80 <= len(description) <= 4000
    for label in ("Equipment:", "Difficulty:", "Setting:", "Warm-up:", "Cooldown:", "Safety:"):
        assert label in description
    assert catalog.warmups[routine.warmup] in description
    assert catalog.cooldowns[routine.cooldown] in description
    assert catalog.safety in description
    assert "not a CDC/NHS published routine" in description
    assert len(payload.exercises) == len(routine.exercises)
    provenance = record["provenance"]
    assert provenance["warmup"]["duration_seconds"] == 360
    assert provenance["cooldown"]["duration_seconds"] == 300
    for step, exercise, prescription in zip(
        routine.exercises, payload.exercises, provenance["prescription"], strict=True
    ):
        movement = catalog.movements[step.movement]
        assert movement.name == exercise.name == prescription["name"]
        assert movement.cue in description
        assert f"Rest: {step.rest_seconds} seconds" in description
        assert set(movement.equipment) <= set(provenance["equipment"])
        assert (exercise.reps is None) != (exercise.duration_seconds is None)
        assert prescription["rest_seconds"] == step.rest_seconds
        assert prescription["cue"] == movement.cue
        assert prescription["sets"] == exercise.sets == step.sets
    assert provenance["estimated_duration_minutes"] == sources._estimated_minutes(routine)
    assert 15 <= provenance["estimated_duration_minutes"] <= 60
    assert "4 seconds" in provenance["duration_estimate_basis"]
    assert record["kind"] == "workout"
    assert provenance["authorship"] == "original_authored_suggestion"
    assert record["source_url"].endswith(f"#{catalog_id}")
    assert "informed by" in record["source_name"]
    assert record["warnings"]
    guidance_urls = [item["url"] for item in provenance["guidance"]]
    assert len(set(guidance_urls)) == len(guidance_urls)


def test_catalog_and_opening_preflight_are_varied_and_distinct() -> None:
    records = sources.workout_candidates()
    assert len(records) >= 52  # Preserve the existing authored pool, not just its sample.
    expected = set(
        product(
            ("upper", "lower", "cardio", "full_body"), ("home", "gym"), ("beginner", "intermediate")
        )
    )
    assert {
        (r["payload"]["category"], r["provenance"]["setting"], r["provenance"]["difficulty"])
        for r in records
    } == expected
    signatures = [
        frozenset(sources._identity(exercise["name"]) for exercise in r["payload"]["exercises"])
        for r in records
    ]
    assert len(set(signatures)) == len(records)
    assert len({content_fingerprint("workout", r["payload"]) for r in records}) == len(records)
    assert len(
        {
            source_identity("workout", canonical_source(r["source_url"]), r["provenance"])
            for r in records
        }
    ) == len(records)
    sample = records[:5]
    assert {r["payload"]["category"] for r in sample} == {"upper", "lower", "cardio", "full_body"}
    assert {r["provenance"]["setting"] for r in sample} == {"home", "gym"}
    assert {r["provenance"]["difficulty"] for r in sample} == {"beginner", "intermediate"}
    assert len({r["photo_page_url"] for r in sample}) == 5


def test_offline_reads_are_deterministic_and_return_independent_records(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    def unexpected_network(*args: Any, **kwargs: Any) -> None:
        pytest.fail("The authored workout source must not access the network")

    monkeypatch.setattr(socket, "getaddrinfo", unexpected_network)
    monkeypatch.setattr(socket, "create_connection", unexpected_network)
    first = sources.workout_candidates()
    baseline = deepcopy(first)
    first[0]["payload"]["exercises"][0]["name"] = "mutated"
    first[0]["provenance"]["prescription"][0]["cue"] = "mutated"
    first[0]["warnings"].append("mutated")
    assert sources.workout_candidates() == baseline


def test_all_photos_have_individual_file_rights_and_relevance(catalog: sources._Catalog) -> None:
    used = Counter(r.photo for r in catalog.routines)
    assert set(used) == set(catalog.photos)
    for photo in catalog.photos.values():
        assert urlsplit(photo.page_url).path.startswith("/wiki/File:")
        assert photo.license in {"Public domain", "CC0"}
        assert photo.license_template and photo.creator and photo.source
        assert len(photo.license_evidence) >= 30 and len(photo.depicts) >= 10
    for record in sources.workout_candidates():
        image = record["provenance"]["image"]
        assert image["license_proof_url"] == record["photo_page_url"] + "#Licensing"
        assert image["runtime_verification_required"] is True
        # Editorial notes are not a runtime license check or an owned media reference.
        assert "permission_verified" not in image
        assert record["payload"]["photo_url"] is None


def test_reviewed_photos_do_not_reintroduce_misleading_equipment(catalog: sources._Catalog) -> None:
    # The previous Navy "bands" caption actually illustrated suspension straps.
    assert catalog.photos["bands"].page_url.endswith(
        "/File:Resistance_training_develops_functional_strength_(9834695).jpg"
    )
    assert "elastic" in catalog.photos["bands"].depicts
    assert catalog.photos["push_up"].page_url.endswith("/File:RECRUIT_PUSH_UPS_DVIDS1078131.jpg")


@pytest.mark.parametrize("field", ["guidance", "photo", "warmup", "cooldown"])
def test_unknown_routine_references_fail(raw: dict[str, Any], field: str) -> None:
    raw["routines"][0][field] = "missing"
    with pytest.raises(ValidationError, match="Unknown reference"):
        sources._Catalog.model_validate(raw)


@pytest.mark.parametrize("field", sources.SHARED_GUIDANCE)
def test_missing_shared_guidance_fails_early(raw: dict[str, Any], field: str) -> None:
    del raw["guidance"][field]
    with pytest.raises(ValidationError, match="Missing shared guidance|Unknown reference"):
        sources._Catalog.model_validate(raw)


@pytest.mark.parametrize("field", ["warmups", "cooldowns"])
def test_blank_preparation_is_rejected(raw: dict[str, Any], field: str) -> None:
    raw[field]["upper"] = " " * 80
    with pytest.raises(ValidationError):
        sources._Catalog.model_validate(raw)


@pytest.mark.parametrize("variant", ["renamed", "reordered", "dose_only", "duplicate_exercise"])
def test_cosmetic_workout_variants_are_rejected(raw: dict[str, Any], variant: str) -> None:
    duplicate = deepcopy(raw["routines"][0])
    duplicate.update(catalog_id="ds-workout-v1-not-a-new-workout", title="An Invented New Name")
    if variant == "reordered":
        duplicate["exercises"].reverse()
    elif variant == "dose_only":
        duplicate["exercises"][0].update(sets=3, reps="10-12", rest_seconds=90)
    elif variant == "duplicate_exercise":
        duplicate["exercises"].append(deepcopy(duplicate["exercises"][0]))
    raw["routines"].append(duplicate)
    with pytest.raises(ValidationError, match="Repeated exercise combination"):
        sources._Catalog.model_validate(raw)


def test_duplicate_movement_alias_cannot_disguise_a_variant(raw: dict[str, Any]) -> None:
    raw["movements"]["alias"] = deepcopy(raw["movements"]["wall_press"])
    raw["movements"]["alias"]["name"] = "WALL  PRESS UP!"
    with pytest.raises(ValidationError, match="Duplicate movement names"):
        sources._Catalog.model_validate(raw)


@pytest.mark.parametrize("field", ["catalog_id", "title"])
def test_duplicate_workout_identity_is_rejected(raw: dict[str, Any], field: str) -> None:
    raw["routines"][1][field] = raw["routines"][0][field]
    with pytest.raises(ValidationError, match="Duplicate workout identity"):
        sources._Catalog.model_validate(raw)


@pytest.mark.parametrize(
    "patch",
    [
        {"reps": None},
        {"duration_seconds": 30},
        {"reps": "12-8"},
        {"reps": "0"},
        {"reps": "21"},
        {"reps": "8 each arm"},
        {"sets": True},
        {"sets": "2"},
        {"sets": 0},
        {"sets": 7},
        {"rest_seconds": -1},
        {"rest_seconds": 181},
        {"rest_seconds": 0},
        {"duration_seconds": 9, "reps": None},
        {"duration_seconds": 1801, "reps": None},
        {"movement": "missing"},
        {"cue": "Unrecognized legacy field"},
    ],
)
def test_incomplete_or_unsafe_prescriptions_fail(
    raw: dict[str, Any], patch: dict[str, Any]
) -> None:
    raw["routines"][0]["exercises"][0].update(patch)
    with pytest.raises(ValidationError):
        sources._Catalog.model_validate(raw)


@pytest.mark.parametrize(
    "page",
    [
        "http://commons.wikimedia.org/wiki/File:Gym.jpg",
        "https://commons.wikimedia.org.evil.example/wiki/File:Gym.jpg",
        "https://user@commons.wikimedia.org/wiki/File:Gym.jpg",
        "https://commons.wikimedia.org/wiki/Category:Exercise",
        "https://commons.wikimedia.org/wiki/File:Gym.svg",
        "https://commons.wikimedia.org/wiki/File:Gym.jpg#Licensing",
        "https://commons.wikimedia.org/wiki/File:Gym.jpg?download=1",
    ],
)
def test_non_photo_or_untrusted_pages_are_rejected(raw: dict[str, Any], page: str) -> None:
    raw["photos"]["push_up"]["page_url"] = page
    with pytest.raises(ValidationError, match="individual Commons"):
        sources._Catalog.model_validate(raw)


@pytest.mark.parametrize(
    "patch", [{"license": "CC-BY-4.0"}, {"license": "CC0"}, {"license_template": "Cc-by-4.0"}]
)
def test_unsupported_or_inconsistent_photo_rights_fail(
    raw: dict[str, Any], patch: dict[str, Any]
) -> None:
    raw["photos"]["push_up"].update(patch)
    with pytest.raises(ValidationError):
        sources._Catalog.model_validate(raw)


@pytest.mark.parametrize(
    "url",
    [
        "https://www.cdc.gov/",
        "http://www.cdc.gov/activity/",
        "https://www.cdc.gov.evil.example/activity/",
        "https://user@www.cdc.gov/activity/",
        "https://www.nhs.uk/activity/?tracking=1",
        "https://www.nhs.uk/activity/#routine",
    ],
)
def test_untrustworthy_guidance_is_rejected(raw: dict[str, Any], url: str) -> None:
    raw["guidance"]["cdc_activity"]["url"] = url
    with pytest.raises(ValidationError, match="primary CDC/NHS"):
        sources._Catalog.model_validate(raw)


def test_invalid_review_date_and_truncated_catalog_fail(raw: dict[str, Any]) -> None:
    raw["reviewed_on"] = "2026-02-30"
    with pytest.raises(ValidationError):
        sources._Catalog.model_validate(raw)
    raw["reviewed_on"] = RAW["reviewed_on"]
    raw["routines"] = raw["routines"][:4]
    with pytest.raises(ValidationError):
        sources._Catalog.model_validate(raw)


@pytest.mark.parametrize(
    ("steps", "minutes"),
    [
        ([{"movement": "x", "sets": 2, "reps": "6-8 each side", "rest_seconds": 60}], 15),
        ([{"movement": "x", "sets": 3, "duration_seconds": 30, "rest_seconds": 45}], 14),
        ([{"movement": "x", "sets": 1, "duration_seconds": 30, "rest_seconds": 180}], 12),
        (
            [
                {"movement": "x", "sets": 2, "reps": "10", "rest_seconds": 60},
                {"movement": "y", "sets": 1, "duration_seconds": 120, "rest_seconds": 180},
            ],
            17,
        ),
    ],
)
def test_duration_includes_sides_rest_transitions_and_preparation(
    steps: list[dict[str, Any]], minutes: int
) -> None:
    routine = sources._Routine.model_validate({**RAW["routines"][0], "exercises": steps})
    assert sources._estimated_minutes(routine) == minutes


@pytest.mark.skipif(os.environ.get("WORKOUT_SOURCE_LIVE") != "1", reason="Opt-in public HTTP only")
def test_live_all_catalog_photos_and_five_candidate_preflight(catalog: sources._Catalog) -> None:
    """Exercise production resolution/normalization, but never upload, enroll, or stage anything."""
    from app.services.content_media import commons_photo, photo_bytes
    from app.workers.content_daily import clean_payload

    async def check() -> None:
        evidence = {}
        for key, photo in catalog.photos.items():
            resolved = await commons_photo(photo.page_url)
            assert resolved.evidence["license"] == photo.license, key
            data = await photo_bytes(resolved)
            with Image.open(io.BytesIO(data)) as image:
                assert image.format == "JPEG" and min(image.size) >= 200
                assert max(image.size) <= 1280
            assert 0 < len(data) <= 786_432
            evidence[photo.page_url] = resolved.evidence
            print(f"PHOTO OK {key}: {resolved.evidence['license']}; {len(data)} bytes")
            await asyncio.sleep(1)
        sample = sources.workout_candidates()[:5]
        for record in sample:
            assert evidence[record["photo_page_url"]]["permission_verified"] is True
            payload = clean_payload(
                record, "https://dinner.dcss.dev/api/v1/media/objects/preflight"
            )
            assert payload["title"] and payload["exercises"] and payload["description"]
            print(f"PREFLIGHT OK {record['provenance']['catalog_id']}: {payload['title']}")
        assert len(sample) == 5

    asyncio.run(check())
