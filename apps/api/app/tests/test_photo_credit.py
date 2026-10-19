from __future__ import annotations

import copy
from collections.abc import Iterator
from dataclasses import dataclass
from datetime import date
from io import BytesIO
from pathlib import Path
from typing import Any
from uuid import uuid4

import pytest
from fastapi.testclient import TestClient
from PIL import Image
from pydantic import ValidationError
from sqlalchemy import Connection, event, select
from sqlalchemy.orm import Session

from app.core.actor import RequestActor, acting_as
from app.core.config import settings
from app.models.content_automation import ContentCandidate
from app.models.entities import Recipe, User, WeeklyPlan, WeeklyPlanSlot
from app.models.security import MediaObject
from app.models.workouts import WorkoutTemplate, WorkoutTemplateShare
from app.schemas.common import RecipeCreate, RecipeOut
from app.schemas.photo_credit import PhotoCredit
from app.schemas.workouts import TemplateInput
from app.services import content_automation, private_media, recipes, workout_media, workouts
from app.services.media_storage import LocalMediaStorageAdapter
from app.services.photo_credit import (
    CACHE_KEY,
    MODIFICATIONS,
    SHARE_ALIKE,
    credit_from_evidence,
    photo_credit_for,
    recipe_photo_credit,
    sanitized_photo_credit,
)
from app.tests.test_content_automation import NOW, START, provenance, recipe_payload, stage
from app.tests.test_workouts import account, group


def image_evidence(license: str = "CC BY 4.0") -> dict[str, Any]:
    image: dict[str, Any] = provenance()["image"]
    image["license"] = license
    image["license_url"] = (
        "https://creativecommons.org/licenses/by-sa/4.0/"
        if license == "CC BY-SA 4.0"
        else "https://creativecommons.org/licenses/by/4.0/"
    )
    image["credit"] = f"Photo: Example by Test photographer. {license}."
    return image


@dataclass
class ApprovedContent:
    owner: User
    photo: str
    recipes: list[Recipe]
    workouts: list[WorkoutTemplate]
    candidates: list[ContentCandidate]


@pytest.fixture
def approved(
    auth_headers: dict[str, str],
    db_session: Session,
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
) -> ApprovedContent:
    monkeypatch.setattr(settings, "public_api_url", "https://dinner-swipe.example")
    storage = LocalMediaStorageAdapter(tmp_path, settings.public_api_url)
    monkeypatch.setattr(private_media, "get_media_storage", lambda: storage)
    owner = db_session.scalars(select(User).where(User.email == "owner@example.com")).one()
    image = BytesIO()
    Image.new("RGB", (32, 32), "green").save(image, "JPEG")
    photo = private_media.object_url(
        private_media.store_image(db_session, owner, image.getvalue()).id
    )
    campaign = content_automation.create_campaign(db_session, owner.id, START)
    batch = content_automation.begin_batch(db_session, campaign.id, START, NOW)
    assert batch
    candidates = [
        stage(
            db_session,
            batch,
            photo,
            index,
            kind,
            provenance=provenance() | {"image": image_evidence("CC BY-SA 4.0")},
        )
        for kind in ("recipe", "workout")
        for index in range(2)
    ]
    content_automation.decide(
        db_session, owner, batch.id, "approve", [row.id for row in candidates]
    )
    db_session.commit()
    return ApprovedContent(
        owner,
        photo,
        list(db_session.scalars(select(Recipe).order_by(Recipe.name))),
        list(db_session.scalars(select(WorkoutTemplate).order_by(WorkoutTemplate.title))),
        candidates,
    )


@pytest.fixture
def credit_queries(db_session: Session) -> Iterator[list[str]]:
    statements: list[str] = []

    def record(
        connection: Connection,
        cursor: Any,
        statement: str,
        parameters: Any,
        context: Any,
        executemany: bool,
    ) -> None:
        if statement.lstrip().upper().startswith("SELECT") and (
            "content_automation_candidates" in statement
        ):
            statements.append(statement)

    engine = db_session.get_bind()
    event.listen(engine, "before_cursor_execute", record)
    try:
        yield statements
    finally:
        event.remove(engine, "before_cursor_execute", record)


@pytest.mark.parametrize("license", ["CC BY 4.0", "CC BY-SA 4.0"])
def test_credit_contract_sanitizes_text_and_preserves_all_attribution(license: str) -> None:
    image = image_evidence(license)
    image["credit"] += " Credit requested by the photographer."
    image["credit"] = "<b>" + image["credit"] + "</b>\x00"
    image["storage_key"] = "private-storage-sentinel"
    before = copy.deepcopy(image)
    credit = credit_from_evidence(image)
    assert credit
    assert set(credit) == {"text", "source_url", "license_url", "license"}
    assert "Example by Test photographer" in credit["text"]
    assert "Credit requested by the photographer." in credit["text"]
    assert MODIFICATIONS in credit["text"]
    assert (SHARE_ALIKE in credit["text"]) == (license == "CC BY-SA 4.0")
    assert "<b>" not in credit["text"] and "\x00" not in credit["text"]
    assert "private-storage-sentinel" not in str(credit)
    assert sanitized_photo_credit(credit) == credit
    assert credit_from_evidence(image | {"credit": credit["text"]}) == credit
    assert image == before
    assert PhotoCredit.model_validate(credit).model_dump() == credit
    with pytest.raises(ValidationError):
        PhotoCredit.model_validate(credit | {"storage_key": "private"})


@pytest.mark.parametrize(
    "source",
    [
        "http://commons.wikimedia.org/wiki/File:Example.jpg",
        "https://localhost/wiki/File:Example.jpg",
        "https://commons.wikimedia.org.evil.example/wiki/File:Example.jpg",
        "https://user:password@commons.wikimedia.org/wiki/File:Example.jpg",
        "https://commons.wikimedia.org:8443/wiki/File:Example.jpg",
        "https://commons.wikimedia.org/wiki/File:Example.jpg?token=private",
        "https://commons.wikimedia.org/wiki/File:Example.jpg#private",
        "https://commons.wikimedia.org/wiki/File:Example.svg",
        "https://commons.wikimedia.org/api/v1/media/objects/Example.jpg",
        "https://www.nhlbi.nih.gov/%61pi/v1/media/private.jpg",
        "https://www.nhlbi.nih.gov/uploads/private.jpg",
        "https://www.nhlbi.nih.gov/",
        "https://www.nhlbi.nih.gov/photo\n.jpg",
    ],
)
def test_credit_rejects_private_signed_and_unapproved_sources(source: str) -> None:
    assert credit_from_evidence(image_evidence() | {"source_url": source}) is None


@pytest.mark.parametrize(
    "change",
    [
        {"permission_verified": False},
        {"permission_verified": 1},
        {"creator": ""},
        {"creator": "Someone not credited"},
        {"credit": ""},
        {"credit": "Test photographer /api/v1/media/objects/private"},
        {"credit": "Test photographer https://example.com/?token=private"},
        {"license": "Unverified"},
        {"license_url": "https://creativecommons.org/licenses/by-sa/4.0/"},
        {"license_url": None},
        {"credit": "Test photographer" * 2000},
    ],
)
def test_incomplete_or_unsafe_evidence_has_no_credit(change: dict[str, Any]) -> None:
    assert credit_from_evidence(image_evidence() | change) is None
    assert credit_from_evidence(None) is None
    assert sanitized_photo_credit(None) is None


def test_credits_reach_recipe_workout_and_meal_plan_without_writing(
    approved: ApprovedContent,
    db_session: Session,
    client: TestClient,
    auth_headers: dict[str, str],
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setattr(settings, "workouts_enabled", True)
    expected = credit_from_evidence(image_evidence("CC BY-SA 4.0"))
    recipe = approved.recipes[0]
    template = approved.workouts[0]
    recipe_before = (recipe.photo_attribution, recipe.photo_source_url, recipe.updated_at)
    media = db_session.scalars(select(MediaObject)).one()
    media_before = (media.claimed_at, media.orphaned_at, media.created_at)
    candidate_before = [copy.deepcopy(row.provenance) for row in approved.candidates]
    response = client.get(f"/api/v1/recipes/{recipe.id}", headers=auth_headers)
    assert response.status_code == 200, response.text
    assert response.json()["photo_credit"] == expected
    legacy = response.json()
    legacy.pop("photo_credit")
    assert RecipeOut.model_validate(legacy).photo_credit is None
    response = client.get("/api/v1/workouts/templates", headers=auth_headers)
    assert response.status_code == 200, response.text
    assert all(row["photo_credit"] == expected for row in response.json()["items"])
    plan = WeeklyPlan(user_id=approved.owner.id, week_start=date(2026, 10, 19), meal_target=3)
    db_session.add(plan)
    db_session.flush()
    db_session.add(WeeklyPlanSlot(weekly_plan_id=plan.id, recipe_id=recipe.id, servings=2))
    db_session.commit()
    with acting_as(RequestActor(approved.owner.id, True, True)):
        assert (
            recipes.serialize_plan(db_session, plan)["slots"][0]["recipe_photo_credit"] == expected
        )
    assert (
        workouts.render_template(db_session, approved.owner, template)["photo_credit"] == expected
    )
    assert (recipe.photo_attribution, recipe.photo_source_url, recipe.updated_at) == recipe_before
    assert (media.claimed_at, media.orphaned_at, media.created_at) == media_before
    assert [row.provenance for row in approved.candidates] == candidate_before
    assert not db_session.dirty


def test_credit_lookup_is_once_per_owner_and_kind_not_per_item(
    approved: ApprovedContent, db_session: Session, credit_queries: list[str]
) -> None:
    db_session.info.pop(CACHE_KEY, None)
    for _ in range(3):
        for recipe in approved.recipes:
            assert recipe_photo_credit(db_session, recipe)
        for template in approved.workouts:
            assert workouts.serialize_template(template, db=db_session)["photo_credit"]
    assert len(credit_queries) == 2
    other, _ = account(db_session, "credit-other")
    for recipe in approved.recipes:
        assert (
            photo_credit_for(
                db_session,
                owner_id=other.id,
                kind="recipe",
                target_id=recipe.id,
                photo_url=approved.photo,
            )
            is None
        )
    assert len(credit_queries) == 3
    result = recipe_photo_credit(db_session, approved.recipes[0])
    assert result
    result["text"] = "Changed response"
    assert recipe_photo_credit(db_session, approved.recipes[0]) != result
    assert len(credit_queries) == 3


@pytest.mark.parametrize("photo", [None, "https://example.com/manual.jpg", "uploaded"])
def test_legacy_lists_never_query_per_item_or_gain_fabricated_credits(
    approved: ApprovedContent, db_session: Session, credit_queries: list[str], photo: str | None
) -> None:
    reference = approved.photo if photo == "uploaded" else photo
    manual_recipes = [
        Recipe(id=str(uuid4()), owner_user_id=approved.owner.id, photo_url=reference)
        for _ in range(20)
    ]
    manual_workouts = [
        WorkoutTemplate(id=str(uuid4()), owner_id=approved.owner.id, photo_url=reference)
        for _ in range(20)
    ]
    db_session.info.pop(CACHE_KEY, None)
    for recipe in manual_recipes:
        assert recipe_photo_credit(db_session, recipe) is None
    assert not credit_queries
    for template in manual_workouts:
        assert workouts.serialize_template(template, db=db_session)["photo_credit"] is None
    assert len(credit_queries) == (1 if photo == "uploaded" else 0)
    assert not db_session.dirty


@pytest.mark.parametrize("replacement", [None, "uploaded"])
def test_photo_edits_drop_stale_credits_but_keep_frozen_shared_snapshots(
    approved: ApprovedContent, db_session: Session, replacement: str | None
) -> None:
    recipe = approved.recipes[0]
    template = approved.workouts[0]
    member, _ = account(db_session, "credit-member")
    household = group(db_session, approved.owner, member)
    workouts.share_templates(db_session, approved.owner, household.id, [template.id])
    db_session.commit()
    share = db_session.scalars(select(WorkoutTemplateShare)).one()
    frozen = copy.deepcopy(share.snapshot)
    assert frozen["photo_credit"] and frozen["photo_reference"] == approved.photo
    assert recipe_photo_credit(db_session, recipe)
    if replacement:
        image = BytesIO()
        Image.new("RGB", (32, 32), "red").save(image, "JPEG")
        replacement = private_media.object_url(
            private_media.store_image(db_session, approved.owner, image.getvalue()).id
        )
    with acting_as(RequestActor(approved.owner.id, True, True)):
        recipes.update_recipe(
            db_session,
            recipe,
            RecipeCreate.model_validate(
                recipe_payload(approved.photo) | {"photo_url": replacement}
            ),
            commit=False,
        )
    workouts.save_template(
        db_session,
        approved.owner,
        TemplateInput.model_validate({"title": template.title, "photo_url": replacement}),
        template.id,
    )
    db_session.commit()
    assert recipe_photo_credit(db_session, recipe) is None
    assert workouts.render_template(db_session, approved.owner, template)["photo_credit"] is None
    rendered = workout_media.render_snapshot(db_session, member, workouts.shared_snapshot(share))
    assert rendered["photo_credit"] == frozen["photo_credit"]
    assert rendered["photo_reference"] == approved.photo
    assert share.snapshot == frozen
    workouts.share_templates(db_session, approved.owner, household.id, [template.id])
    assert share.snapshot["photo_credit"] is None
    assert share.snapshot["photo_reference"] == replacement


def test_legacy_or_unreadable_snapshots_are_read_only_and_never_show_credit(
    approved: ApprovedContent, db_session: Session
) -> None:
    template = approved.workouts[0]
    snapshot = workouts.serialize_template(template, db=db_session)
    before = copy.deepcopy(snapshot)
    other, _ = account(db_session, "no-credit-access")
    rendered = workout_media.render_snapshot(db_session, other, snapshot)
    assert rendered["photo_url"] == workout_media.brand_photo()
    assert rendered["photo_credit"] is None
    assert snapshot == before
    legacy = dict(snapshot)
    legacy.pop("photo_credit")
    assert "photo_credit" not in workout_media.render_snapshot(db_session, approved.owner, legacy)
    assert "photo_credit" not in legacy
    missing = dict(snapshot) | {"photo_reference": private_media.object_url(str(uuid4()))}
    assert (
        workout_media.render_snapshot(db_session, approved.owner, missing)["photo_credit"] is None
    )
    media = db_session.scalars(select(MediaObject)).one()
    media.deleted_at = NOW.replace(tzinfo=None)
    db_session.flush()
    assert (
        workout_media.render_snapshot(db_session, approved.owner, snapshot)["photo_credit"] is None
    )
