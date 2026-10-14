from __future__ import annotations

import json
from collections.abc import Iterator
from datetime import UTC, date, datetime, timedelta
from io import BytesIO
from pathlib import Path
from typing import Any, cast
from unittest.mock import AsyncMock, Mock
from urllib.parse import parse_qs, urlsplit
from uuid import uuid4

import httpx
import pytest
from fastapi import FastAPI, HTTPException
from fastapi.testclient import TestClient
from PIL import Image
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.api.routes import media, recipes, workouts
from app.core.config import settings
from app.database.session import get_db
from app.models.base import Base
from app.models.entities import Household, HouseholdMember, User
from app.models.security import MediaObject
from app.models.workouts import (
    WorkoutLog,
    WorkoutPlan,
    WorkoutPlanSlot,
    WorkoutProposal,
    WorkoutTemplate,
    WorkoutTemplateShare,
)
from app.schemas.workouts import TemplateInput
from app.services import media_maintenance, planning, private_media, workout_media
from app.services.media_storage import LocalMediaStorageAdapter
from app.tests.test_workouts import BASE, NOW, WEEK, account, enable, group, share

type SnapshotRow = WorkoutTemplateShare | WorkoutPlanSlot | WorkoutProposal | WorkoutLog

SNAPSHOT_MODELS: tuple[type[SnapshotRow], ...] = (
    WorkoutTemplateShare,
    WorkoutPlanSlot,
    WorkoutProposal,
    WorkoutLog,
)


@pytest.fixture()
def media_storage(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> Iterator[LocalMediaStorageAdapter]:
    storage = LocalMediaStorageAdapter(tmp_path, settings.public_api_url)
    monkeypatch.setattr(private_media, "get_media_storage", lambda: storage)
    monkeypatch.setattr(media_maintenance, "get_media_storage", lambda: storage)
    remote_photo = AsyncMock(side_effect=AssertionError("Unexpected remote photo fetch"))
    async_http = AsyncMock(side_effect=AssertionError("Unexpected provider HTTP request"))
    sync_http = Mock(side_effect=AssertionError("Unexpected provider HTTP request"))
    monkeypatch.setattr(media, "fetch_public_bytes", remote_photo)
    monkeypatch.setattr(httpx.AsyncClient, "send", async_http)
    monkeypatch.setattr(httpx.HTTPTransport, "handle_request", sync_http)
    yield storage
    remote_photo.assert_not_called()
    async_http.assert_not_called()
    sync_http.assert_not_called()


@pytest.fixture()
def workout_media_client(
    db_session: Session,
    media_storage: LocalMediaStorageAdapter,
    monkeypatch: pytest.MonkeyPatch,
) -> Iterator[TestClient]:
    del media_storage
    db_session.connection().exec_driver_sql("PRAGMA foreign_keys=ON")
    monkeypatch.setattr(settings, "workouts_enabled", True)
    monkeypatch.setattr(planning, "now_utc", lambda: NOW)
    test_app = FastAPI()
    for router in (workouts.router, recipes.router, media.router):
        test_app.include_router(router, prefix="/api/v1")

    def override_db() -> Iterator[Session]:
        try:
            yield db_session
        except Exception:
            db_session.rollback()
            raise

    test_app.dependency_overrides[get_db] = override_db
    with TestClient(test_app) as client:
        yield client


def image_bytes(color: str = "blue", image_format: str = "PNG") -> bytes:
    output = BytesIO()
    Image.new("RGB", (16, 16), color).save(output, image_format)
    return output.getvalue()


def upload(client: TestClient, headers: dict[str, str], color: str = "blue") -> str:
    response = client.post(
        "/api/v1/recipes/photo-upload",
        headers=headers,
        files={"file": ("workout.png", image_bytes(color), "image/png")},
    )
    assert response.status_code == 200, response.text
    assert response.json()["image_status"] == "validated"
    return cast(str, response.json()["photo_url"])


def create_template(
    client: TestClient, headers: dict[str, str], photo: str | None
) -> dict[str, Any]:
    response = client.post(
        f"{BASE}/templates", headers=headers, json={"title": "Photo routine", "photo_url": photo}
    )
    assert response.status_code == 200, response.text
    return cast(dict[str, Any], response.json())


def read_path(signed_url: str) -> str:
    parsed = urlsplit(signed_url)
    return f"{parsed.path}?{parsed.query}"


def assert_photo(client: TestClient, result: dict[str, Any], reference: str) -> None:
    assert result["photo_reference"] == reference
    signed = urlsplit(result["photo_url"])
    assert signed.path == urlsplit(reference).path
    assert signed.netloc == urlsplit(settings.public_api_url).netloc
    assert set(parse_qs(signed.query)) == {"v", "token"}
    response = client.get(read_path(result["photo_url"]))
    assert response.status_code == 200, response.text
    assert response.headers["Content-Type"] == "image/jpeg"
    assert response.headers["Cache-Control"].startswith("private,")
    assert response.headers["X-Content-Type-Options"] == "nosniff"
    with Image.open(BytesIO(response.content)) as image:
        assert image.format == "JPEG" and image.size == (16, 16)


def assert_raw_snapshot(snapshot: dict[str, Any], reference: str) -> None:
    assert (snapshot.get("photo_reference") or snapshot.get("photo_url")) == reference
    assert "token=" not in json.dumps(snapshot)
    assert "/media/uploads/" not in json.dumps(snapshot)


def stored_media(
    db: Session, storage: LocalMediaStorageAdapter, user: User, color: str = "blue"
) -> MediaObject:
    data = image_bytes(color, "JPEG")
    stored = storage.save_recipe_image(
        user_id=user.id, data=data, suffix=".jpg", content_type="image/jpeg"
    )
    row = MediaObject(
        owner_user_id=user.id,
        storage_key=stored.key,
        backend=stored.backend,
        content_type="image/jpeg",
        size_bytes=len(data),
    )
    db.add(row)
    db.commit()
    return row


def bare_template(db: Session, owner: User) -> WorkoutTemplate:
    row = WorkoutTemplate(
        owner_id=owner.id, title="Frozen routine", category="full_body", exercises=[]
    )
    db.add(row)
    db.commit()
    return row


def attach_reference(
    db: Session,
    kind: str,
    routine: WorkoutTemplate,
    user: User,
    household: Household,
    snapshot: dict[str, Any],
) -> Base:
    row: Base
    if kind == "template":
        routine.photo_url = cast(str, snapshot["photo_url"])
        row = routine
    elif kind == "share":
        row = WorkoutTemplateShare(
            household_id=household.id, template_id=routine.id, snapshot=snapshot
        )
    elif kind in {"private_plan", "group_plan"}:
        plan = WorkoutPlan(
            user_id=user.id if kind == "private_plan" else None,
            household_id=household.id if kind == "group_plan" else None,
            week_start=date.fromisoformat(WEEK),
        )
        db.add(plan)
        db.flush()
        row = WorkoutPlanSlot(
            plan_id=plan.id, template_id=routine.id, sort_order=0, snapshot=snapshot
        )
    elif kind == "proposal":
        row = WorkoutProposal(
            household_id=household.id,
            template_id=routine.id,
            week_start=date.fromisoformat(WEEK),
            snapshot=snapshot,
        )
    elif kind == "log":
        row = WorkoutLog(
            user_id=user.id,
            request_uuid=str(uuid4()),
            template_id=routine.id,
            performed_on=date.fromisoformat(WEEK),
            completed=True,
            sets=[],
            snapshot=snapshot,
        )
    else:
        raise AssertionError(f"Unknown workout reference kind: {kind}")
    db.add(row)
    db.commit()
    return row


def test_title_only_schema_and_route_defaults(
    workout_media_client: TestClient, db_session: Session
) -> None:
    payload = TemplateInput(title="  Mobility  ")
    assert payload.title == "Mobility"
    assert payload.category == "full_body" and payload.exercises == []
    assert payload.photo_url is None
    _, headers = account(db_session, "title-only")
    response = workout_media_client.post(
        f"{BASE}/templates", headers=headers, json={"title": "Mobility"}
    )
    assert response.status_code == 200, response.text
    result = response.json()
    assert result["category"] == "full_body" and result["exercises"] == []
    assert result["photo_url"] == workout_media.brand_photo()
    assert result["photo_reference"] is None
    assert workout_media_client.get(f"{BASE}/templates", headers=headers).json()["items"] == [
        result
    ]


@pytest.mark.parametrize("use_signed_upload", [False, True])
def test_owner_upload_create_read_replace_and_clear_photo(
    workout_media_client: TestClient,
    db_session: Session,
    media_storage: LocalMediaStorageAdapter,
    use_signed_upload: bool,
) -> None:
    owner, headers = account(db_session, "photo-owner")
    signed = upload(workout_media_client, headers)
    media_id = workout_media.object_id(signed)
    assert media_id is not None
    reference = private_media.object_url(media_id)
    routine = create_template(
        workout_media_client, headers, signed if use_signed_upload else reference
    )
    assert_photo(workout_media_client, routine, reference)
    row = db_session.get(WorkoutTemplate, routine["id"])
    media_row = db_session.get(MediaObject, media_id)
    assert row is not None and row.photo_url == reference
    assert media_row is not None and media_row.owner_user_id == owner.id
    assert media_row.claimed_at is not None and media_row.orphaned_at is None
    assert media_row.content_type == "image/jpeg" and media_row.storage_key.endswith(".jpg")
    assert (media_storage.root / media_row.storage_key).is_file()
    listed = workout_media_client.get(f"{BASE}/templates", headers=headers)
    assert listed.status_code == 200, listed.text
    assert_photo(workout_media_client, listed.json()["items"][0], reference)
    assert media_row.storage_key not in listed.text
    assert Path(media_row.storage_key).name not in listed.text
    assert workout_media_client.get(f"/media/{media_row.storage_key}").status_code == 404
    assert workout_media_client.get(urlsplit(reference).path).status_code == 422
    renewed = workout_media_client.get(urlsplit(reference).path + "/link", headers=headers)
    assert renewed.status_code == 200, renewed.text
    assert renewed.headers["Cache-Control"] == "no-store"
    assert_photo(workout_media_client, renewed.json() | {"photo_reference": reference}, reference)

    replacement = upload(workout_media_client, headers, "red")
    replacement_id = workout_media.object_id(replacement)
    assert replacement_id is not None
    replacement_ref = private_media.object_url(replacement_id)
    edited = workout_media_client.put(
        f"{BASE}/templates/{routine['id']}",
        headers=headers,
        json={"title": "Replaced photo", "photo_url": replacement},
    )
    assert edited.status_code == 200, edited.text
    assert_photo(workout_media_client, edited.json(), replacement_ref)
    db_session.refresh(row)
    assert row.photo_url == replacement_ref
    cleared = workout_media_client.put(
        f"{BASE}/templates/{routine['id']}",
        headers=headers,
        json={"title": "No photo", "photo_url": None},
    )
    assert cleared.status_code == 200, cleared.text
    assert cleared.json()["photo_url"] == workout_media.brand_photo()
    assert cleared.json()["photo_reference"] is None
    db_session.refresh(row)
    assert row.photo_url is None


@pytest.mark.parametrize(
    "source",
    [
        "https://example.com/workout.jpg",
        "http://127.0.0.1:11434/api/tags",
        "file:///etc/passwd",
        "javascript:alert(1)",
        "https://example.com/api/v1/media/objects/{id}",
        "{base}/media/uploads/{owner}/{filename}",
        "{base}/api/v1/media/recipes/{id}",
        "{base}/api/v1/media/objects/{id}#fragment",
        "{base}/api/v1/media/objects/{id}?redirect=https://example.com",
        "{base}/api/v1/media/objects/{id}/../../../../../etc/passwd",
    ],
)
def test_reject_external_file_and_noncanonical_upload_sources(
    workout_media_client: TestClient,
    db_session: Session,
    media_storage: LocalMediaStorageAdapter,
    source: str,
) -> None:
    owner, headers = account(db_session, "invalid-photo")
    media_row = stored_media(db_session, media_storage, owner)
    photo = source.format(
        base=settings.public_api_url.rstrip("/"),
        id=media_row.id,
        owner=owner.id,
        filename=Path(media_row.storage_key).name,
    )
    created = workout_media_client.post(
        f"{BASE}/templates", headers=headers, json={"title": "Rejected", "photo_url": photo}
    )
    assert created.status_code == 422, created.text
    assert db_session.scalar(select(WorkoutTemplate.id)) is None
    routine = create_template(workout_media_client, headers, None)
    edited = workout_media_client.put(
        f"{BASE}/templates/{routine['id']}",
        headers=headers,
        json={"title": "Rejected update", "photo_url": photo},
    )
    assert edited.status_code == 422, edited.text
    row = db_session.get(WorkoutTemplate, routine["id"])
    assert row is not None and row.photo_url is None and row.title == "Photo routine"


@pytest.mark.parametrize("deleted", [False, True])
def test_missing_or_deleted_object_cannot_be_attached(
    workout_media_client: TestClient,
    db_session: Session,
    media_storage: LocalMediaStorageAdapter,
    deleted: bool,
) -> None:
    owner, headers = account(db_session, "unavailable-photo")
    media_row = stored_media(db_session, media_storage, owner)
    if deleted:
        media_row.deleted_at = datetime.now(UTC).replace(tzinfo=None)
        db_session.commit()
    resource_id = media_row.id if deleted else str(uuid4())
    response = workout_media_client.post(
        f"{BASE}/templates",
        headers=headers,
        json={"title": "Unavailable", "photo_url": private_media.object_url(resource_id)},
    )
    assert response.status_code == 404, response.text


def test_upload_quota_failure_does_not_replace_workout_photo(
    workout_media_client: TestClient,
    db_session: Session,
    media_storage: LocalMediaStorageAdapter,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    _, headers = account(db_session, "quota-owner")
    signed = upload(workout_media_client, headers)
    routine = create_template(workout_media_client, headers, signed)
    media_row = db_session.scalar(select(MediaObject))
    assert media_row is not None
    reference = private_media.object_url(media_row.id)
    monkeypatch.setattr(settings, "media_account_quota_bytes", media_row.size_bytes)
    response = workout_media_client.post(
        "/api/v1/recipes/photo-upload",
        headers=headers,
        files={"file": ("replacement.png", image_bytes("red"), "image/png")},
    )
    assert response.status_code == 413, response.text
    assert list(db_session.scalars(select(MediaObject.id))) == [media_row.id]
    assert len(list(media_storage.root.rglob("*.jpg"))) == 1
    row = db_session.get(WorkoutTemplate, routine["id"])
    assert row is not None and row.photo_url == reference
    listed = workout_media_client.get(f"{BASE}/templates", headers=headers)
    assert listed.status_code == 200, listed.text
    assert_photo(workout_media_client, listed.json()["items"][0], reference)


def test_other_account_cannot_attach_update_renew_or_mint_read_link(
    workout_media_client: TestClient, db_session: Session
) -> None:
    _, owner_headers = account(db_session, "isolated-owner")
    other, other_headers = account(db_session, "isolated-other")
    signed = upload(workout_media_client, owner_headers)
    media_id = workout_media.object_id(signed)
    assert media_id is not None
    reference = private_media.object_url(media_id)
    for source in (signed, reference):
        response = workout_media_client.post(
            f"{BASE}/templates",
            headers=other_headers,
            json={"title": "Stolen photo", "photo_url": source},
        )
        assert response.status_code == 404, response.text
    routine = create_template(workout_media_client, other_headers, None)
    response = workout_media_client.put(
        f"{BASE}/templates/{routine['id']}",
        headers=other_headers,
        json={"title": "Stolen update", "photo_url": signed},
    )
    assert response.status_code == 404, response.text
    response = workout_media_client.get(urlsplit(reference).path + "/link", headers=other_headers)
    assert response.status_code == 404, response.text
    other_link = private_media.photo_url(db_session, other, "objects", media_id, reference)
    assert other_link is not None
    assert workout_media_client.get(read_path(other_link)).status_code == 404


def test_shared_photo_is_frozen_until_explicit_reshare_and_all_snapshots_render(
    workout_media_client: TestClient, db_session: Session
) -> None:
    owner, owner_headers = account(db_session, "snapshot-owner")
    member, member_headers = account(db_session, "snapshot-member")
    household = group(db_session, owner, member)
    old_photo = upload(workout_media_client, owner_headers)
    old_id = workout_media.object_id(old_photo)
    assert old_id is not None
    old_ref = private_media.object_url(old_id)
    routine = create_template(workout_media_client, owner_headers, old_photo)
    share(workout_media_client, owner_headers, household, routine)
    enable(workout_media_client, owner_headers, household, routine)
    group_library = f"{BASE}/templates?household_id={household.id}"
    shared = workout_media_client.get(group_library, headers=member_headers).json()["items"][0]
    assert_photo(workout_media_client, shared, old_ref)
    # Read sharing is not permission to attach another account's upload to a private template.
    stolen = workout_media_client.post(
        f"{BASE}/templates",
        headers=member_headers,
        json={"title": "Copied photo", "photo_url": shared["photo_url"]},
    )
    assert stolen.status_code == 404, stolen.text

    for scope in ({}, {"household_id": household.id}):
        response = workout_media_client.post(
            f"{BASE}/plans/slots",
            headers=owner_headers,
            json={"template_id": routine["id"], "slot_date": WEEK} | scope,
        )
        assert response.status_code == 200, response.text
        assert_photo(workout_media_client, response.json()["snapshot"], old_ref)
    proposed = workout_media_client.post(
        f"{BASE}/proposals",
        headers=member_headers,
        json={"household_id": household.id, "template_id": routine["id"]},
    )
    assert proposed.status_code == 200, proposed.text
    assert_photo(workout_media_client, proposed.json()["snapshot"], old_ref)
    logged = workout_media_client.put(
        f"{BASE}/logs/{uuid4()}",
        headers=member_headers,
        json={"template_id": routine["id"], "performed_on": WEEK, "completed": True},
    )
    assert logged.status_code == 200, logged.text
    assert_photo(workout_media_client, logged.json()["snapshot"], old_ref)
    for model in SNAPSHOT_MODELS:
        rows = db_session.scalars(select(model)).all()
        assert rows
        for row in rows:
            assert_raw_snapshot(cast(SnapshotRow, row).snapshot, old_ref)

    new_photo = upload(workout_media_client, owner_headers, "red")
    new_id = workout_media.object_id(new_photo)
    assert new_id is not None
    new_ref = private_media.object_url(new_id)
    edited = workout_media_client.put(
        f"{BASE}/templates/{routine['id']}",
        headers=owner_headers,
        json={"title": "Private replacement", "photo_url": new_photo},
    )
    assert edited.status_code == 200, edited.text
    assert_photo(workout_media_client, edited.json(), new_ref)
    still_shared = workout_media_client.get(group_library, headers=member_headers)
    assert still_shared.status_code == 200, still_shared.text
    frozen = still_shared.json()["items"][0]
    assert frozen["title"] == routine["title"]
    assert_photo(workout_media_client, frozen, old_ref)
    assert new_ref not in still_shared.text
    assert (
        workout_media_client.get(
            urlsplit(new_ref).path + "/link", headers=member_headers
        ).status_code
        == 404
    )
    for path, headers, key in (
        (f"{BASE}/plans/current", owner_headers, "slots"),
        (f"{BASE}/plans/current?household_id={household.id}", member_headers, "slots"),
        (f"{BASE}/proposals?household_id={household.id}", member_headers, "items"),
        (f"{BASE}/logs", member_headers, "items"),
    ):
        response = workout_media_client.get(path, headers=headers)
        assert response.status_code == 200, response.text
        assert new_ref not in response.text
        for item in response.json()[key]:
            assert_photo(workout_media_client, item["snapshot"], old_ref)
    share(workout_media_client, owner_headers, household, routine)
    refreshed = workout_media_client.get(group_library, headers=member_headers).json()["items"][0]
    assert refreshed["title"] == "Private replacement"
    assert_photo(workout_media_client, refreshed, new_ref)
    share_row = db_session.scalar(select(WorkoutTemplateShare))
    assert share_row is not None
    assert_raw_snapshot(share_row.snapshot, new_ref)
    for model in SNAPSHOT_MODELS[1:]:
        for row in db_session.scalars(select(model)):
            assert_raw_snapshot(cast(SnapshotRow, row).snapshot, old_ref)


@pytest.mark.parametrize("grant_kind", ["share", "group_plan", "proposal"])
def test_membership_revocation_rejects_old_token_and_renewal_despite_own_log(
    workout_media_client: TestClient,
    db_session: Session,
    media_storage: LocalMediaStorageAdapter,
    grant_kind: str,
) -> None:
    owner, owner_headers = account(db_session, "grant-owner")
    member, member_headers = account(db_session, "grant-member")
    household = group(db_session, owner, member)
    media_row = stored_media(db_session, media_storage, owner)
    reference = private_media.object_url(media_row.id)
    routine = bare_template(db_session, owner)
    snapshot = {
        "id": routine.id,
        "title": routine.title,
        "category": "full_body",
        "photo_url": reference,
        "exercises": [],
    }
    grant_row = attach_reference(db_session, grant_kind, routine, owner, household, snapshot)
    attach_reference(db_session, "log", routine, member, household, snapshot)
    assert workout_media.allows_photo(db_session, member, media_row)
    renewed = workout_media_client.get(urlsplit(reference).path + "/link", headers=member_headers)
    assert renewed.status_code == 200, renewed.text
    old_link = renewed.json()["photo_url"]
    assert workout_media_client.get(read_path(old_link)).status_code == 200
    assert_photo(
        workout_media_client, workout_media.render_snapshot(db_session, member, snapshot), reference
    )
    group_path, key = {
        "share": (f"{BASE}/templates?household_id={household.id}", "items"),
        "group_plan": (f"{BASE}/plans/current?household_id={household.id}", "slots"),
        "proposal": (f"{BASE}/proposals?household_id={household.id}", "items"),
    }[grant_kind]
    group_response = workout_media_client.get(group_path, headers=member_headers)
    assert group_response.status_code == 200, group_response.text
    item = group_response.json()[key][0]
    group_snapshot = item if grant_kind == "share" else item["snapshot"]
    assert_photo(workout_media_client, group_snapshot, reference)
    before_revocation = workout_media_client.get(f"{BASE}/logs", headers=member_headers)
    assert before_revocation.status_code == 200, before_revocation.text
    log_snapshot = before_revocation.json()["items"][0]["snapshot"]
    assert_photo(workout_media_client, log_snapshot, reference)
    old_links = [old_link, group_snapshot["photo_url"], log_snapshot["photo_url"]]
    membership = db_session.scalar(
        select(HouseholdMember).where(
            HouseholdMember.household_id == household.id, HouseholdMember.user_id == member.id
        )
    )
    assert membership is not None
    db_session.delete(membership)
    db_session.commit()
    assert not workout_media.allows_photo(db_session, member, media_row)
    with pytest.raises(HTTPException) as denied:
        private_media.source_for(db_session, member, "objects", media_row.id)
    assert denied.value.status_code == 404
    for signed in old_links:
        assert workout_media_client.get(read_path(signed)).status_code == 404
    assert (
        workout_media_client.get(
            urlsplit(reference).path + "/link", headers=member_headers
        ).status_code
        == 404
    )
    log_response = workout_media_client.get(f"{BASE}/logs", headers=member_headers)
    assert log_response.status_code == 200, log_response.text
    hidden = log_response.json()["items"][0]["snapshot"]
    assert hidden["photo_url"] == workout_media.brand_photo()
    assert hidden["photo_reference"] is None
    assert reference not in log_response.text and "token=" not in log_response.text
    log_row = db_session.scalar(select(WorkoutLog))
    assert log_row is not None
    assert_raw_snapshot(log_row.snapshot, reference)
    db_session.delete(grant_row)
    db_session.commit()
    assert workout_media.referenced(db_session, media_row)
    assert media_maintenance.referenced(db_session, media_row)
    assert (
        workout_media_client.get(
            urlsplit(reference).path + "/link", headers=owner_headers
        ).status_code
        == 200
    )


@pytest.mark.parametrize("retention_kind", ["private_plan", "log"])
def test_private_retention_of_another_owners_photo_does_not_grant_read(
    workout_media_client: TestClient,
    db_session: Session,
    media_storage: LocalMediaStorageAdapter,
    retention_kind: str,
) -> None:
    owner, _ = account(db_session, "retention-owner")
    member, headers = account(db_session, "retention-member")
    household = group(db_session, owner, member)
    media_row = stored_media(db_session, media_storage, owner)
    reference = private_media.object_url(media_row.id)
    routine = bare_template(db_session, owner)
    snapshot = {"photo_reference": reference, "photo_url": reference, "exercises": []}
    attach_reference(db_session, retention_kind, routine, member, household, snapshot)
    assert media_maintenance.referenced(db_session, media_row)
    assert not workout_media.allows_photo(db_session, member, media_row)
    assert (
        workout_media_client.get(urlsplit(reference).path + "/link", headers=headers).status_code
        == 404
    )
    rendered = workout_media.render_snapshot(db_session, member, snapshot)
    assert rendered["photo_url"] == workout_media.brand_photo()
    assert rendered["photo_reference"] is None
    assert snapshot["photo_reference"] == reference


@pytest.mark.parametrize(
    "kind,snapshot_field",
    [("template", "photo_url")]
    + [
        (kind, field)
        for kind in ("share", "private_plan", "group_plan", "proposal", "log")
        for field in ("photo_url", "photo_reference")
    ],
)
def test_cleanup_retains_each_workout_reference_and_deletes_unreferenced_photo(
    db_session: Session,
    media_storage: LocalMediaStorageAdapter,
    monkeypatch: pytest.MonkeyPatch,
    kind: str,
    snapshot_field: str,
) -> None:
    monkeypatch.setattr(settings, "media_cleanup_enabled", True)
    owner, _ = account(db_session, "cleanup-owner")
    member, _ = account(db_session, "cleanup-member")
    household = group(db_session, owner, member)
    retained = stored_media(db_session, media_storage, owner)
    orphan = stored_media(db_session, media_storage, owner, "red")
    old = datetime.now(UTC).replace(tzinfo=None) - timedelta(hours=49)
    for media_row in (retained, orphan):
        media_row.created_at = old
        media_row.claimed_at = old
        media_row.orphaned_at = old
    db_session.commit()
    routine = bare_template(db_session, owner)
    reference = private_media.object_url(retained.id)
    retained_by = attach_reference(
        db_session, kind, routine, owner, household, {snapshot_field: reference}
    )
    assert workout_media.referenced(db_session, retained)
    assert media_maintenance.referenced(db_session, retained)
    assert not media_maintenance.referenced(db_session, orphan)
    assert media_maintenance.cleanup_media(db_session) == 1
    db_session.refresh(retained)
    db_session.refresh(orphan)
    assert retained.deleted_at is None and retained.orphaned_at is None
    assert (media_storage.root / retained.storage_key).is_file()
    assert orphan.deleted_at is not None
    assert not (media_storage.root / orphan.storage_key).exists()
    if kind == "template":
        routine.photo_url = None
    else:
        db_session.delete(retained_by)
    retained.orphaned_at = old
    db_session.commit()
    assert not media_maintenance.referenced(db_session, retained)
    assert media_maintenance.cleanup_media(db_session) == 1
    db_session.refresh(retained)
    assert retained.deleted_at is not None
    assert not (media_storage.root / retained.storage_key).exists()
