from __future__ import annotations

import asyncio
import gzip
import socket
import time
import zipfile
from collections.abc import AsyncIterator
from datetime import datetime, timedelta
from io import BytesIO
from pathlib import Path
from typing import Any
from urllib.parse import urlsplit
from uuid import uuid4

import httpx
import pytest
from fastapi import HTTPException
from fastapi.testclient import TestClient
from PIL import Image
from sqlalchemy import select
from sqlalchemy.orm import Session, sessionmaker

from app.core.actor import RequestActor, acting_as
from app.core.body_limits import RequestBodyLimitMiddleware
from app.core.config import settings
from app.core.rate_limit import DatabaseRateLimiter
from app.core.security import create_refresh_token
from app.ingestion import openai_responses, url_fetcher
from app.ingestion.spreadsheet import parse_spreadsheet
from app.models.entities import (
    Household,
    HouseholdMember,
    HouseholdRecipe,
    Recipe,
    User,
    UserSubscription,
)
from app.models.security import MediaObject
from app.services.media_storage import LocalMediaStorageAdapter
from app.services.nutrition_consent import FATSECRET_TERMS_VERSION
from app.tests.test_nutrition_service import provider as provider_fixture

provider = provider_fixture


def test_streamed_request_limits_before_parsing() -> None:
    async def run(declared: int | None, chunks: list[bytes]) -> tuple[int, int]:
        calls = 0
        sent = []

        async def downstream(scope, receive, send):  # type: ignore[no-untyped-def]
            nonlocal calls
            calls += 1
            await receive()

        async def receive():  # type: ignore[no-untyped-def]
            value = chunks.pop(0)
            return {"type": "http.request", "body": value, "more_body": bool(chunks)}

        async def send(message):  # type: ignore[no-untyped-def]
            sent.append(message)

        headers = [] if declared is None else [(b"content-length", str(declared).encode())]
        await RequestBodyLimitMiddleware(downstream)(
            {"type": "http", "path": "/api/v1/auth/login", "headers": headers}, receive, send
        )
        return calls, next(
            (item["status"] for item in sent if item["type"] == "http.response.start"), 200
        )

    assert asyncio.run(run(None, [b"x" * 600000, b"x" * 600000])) == (0, 413)
    assert asyncio.run(run(1, [b"x" * 1100000])) == (0, 413)
    assert asyncio.run(run(None, [b"{}"])) == (1, 200)


def test_webhook_specific_limit_and_url_batch(client: TestClient) -> None:
    assert client.post("/api/v1/premium/stripe/webhook", content=b"x" * 262145).status_code == 413
    from pydantic import ValidationError

    from app.schemas.common import UrlIngestRequest

    with pytest.raises(ValidationError):
        UrlIngestRequest(urls=["https://example.com/recipe"] * 6)
    assert len(UrlIngestRequest(urls=["https://example.com/recipe"]).urls) == 1


def test_password_change_revokes_all_credentials(
    client: TestClient, auth_headers: dict[str, str]
) -> None:
    login = client.post(
        "/api/v1/auth/login", json={"email": "owner@example.com", "password": "change-me-123"}
    ).json()
    response = client.post(
        "/api/v1/auth/password/change",
        headers=auth_headers,
        json={"current_password": "change-me-123", "new_password": "new-password-123"},
    )
    assert response.status_code == 200, response.text
    for token in (login["access_token"], auth_headers["Authorization"].removeprefix("Bearer ")):
        assert (
            client.get(
                "/api/v1/auth/status", headers={"Authorization": f"Bearer {token}"}
            ).status_code
            == 401
        )
    assert (
        client.post(
            "/api/v1/auth/refresh", json={"refresh_token": login["refresh_token"]}
        ).status_code
        == 401
    )
    assert (
        client.post(
            "/api/v1/auth/login",
            json={"email": "owner@example.com", "password": "new-password-123"},
        ).status_code
        == 200
    )


def test_legacy_refresh_jwt_rejected(
    client: TestClient, auth_headers: dict[str, str], db_session: Session
) -> None:
    user = db_session.scalar(select(User))
    assert user
    token = create_refresh_token(user.id)
    assert client.post("/api/v1/auth/refresh", json={"refresh_token": token}).status_code == 401
    assert client.get("/api/v1/auth/status", headers=auth_headers).status_code == 200


def test_native_logout_revokes_just_rotated_refresh_lineage(
    client: TestClient, auth_headers: dict[str, str]
) -> None:
    first = client.post(
        "/api/v1/auth/login", json={"email": "owner@example.com", "password": "change-me-123"}
    ).json()
    second = client.post(
        "/api/v1/auth/refresh", json={"refresh_token": first["refresh_token"]}
    ).json()
    assert (
        client.post(
            "/api/v1/auth/logout",
            headers={"Authorization": f"Bearer {second['access_token']}"},
            json={"refresh_token": first["refresh_token"]},
        ).status_code
        == 200
    )
    assert (
        client.post(
            "/api/v1/auth/refresh", json={"refresh_token": second["refresh_token"]}
        ).status_code
        == 401
    )


def test_cookie_sessions_require_origin_csrf_and_do_not_return_tokens(
    client: TestClient, auth_headers: dict[str, str]
) -> None:
    headers = {"X-Dinner-Web-Session": "cookie", "Origin": settings.allowed_origin_list[0]}
    response = client.post(
        "/api/v1/auth/login",
        headers=headers,
        json={"email": "owner@example.com", "password": "change-me-123"},
    )
    assert response.status_code == 200
    assert (
        response.json()["web_session"]
        and not response.json()["access_token"]
        and not response.json()["refresh_token"]
    )
    assert "HttpOnly" in ";".join(response.headers.get_list("set-cookie"))
    assert client.get("/api/v1/auth/status").status_code == 200
    assert client.post("/api/v1/auth/refresh", headers=headers, json={}).status_code == 403
    csrf = client.cookies.get("ds_csrf")
    assert csrf
    headers["X-CSRF-Token"] = csrf
    assert client.post("/api/v1/auth/refresh", headers=headers, json={}).status_code == 200
    assert (
        client.post(
            "/api/v1/auth/login",
            headers={"X-Dinner-Web-Session": "cookie", "Origin": "https://attacker.example"},
            json={"email": "owner@example.com", "password": "change-me-123"},
        ).status_code
        == 403
    )


def test_browser_logout_revokes_refresh_with_expired_access(
    client: TestClient, auth_headers: dict[str, str]
) -> None:
    headers = {"X-Dinner-Web-Session": "cookie", "Origin": settings.allowed_origin_list[0]}
    assert (
        client.post(
            "/api/v1/auth/login",
            headers=headers,
            json={
                "email": "owner@example.com",
                "password": "change-me-123",
            },
        ).status_code
        == 200
    )
    refresh = client.cookies.get("ds_refresh")
    csrf = client.cookies.get("ds_csrf")
    assert refresh and csrf
    headers["X-CSRF-Token"] = csrf
    client.cookies.clear()
    client.cookies.set("ds_access", "expired")
    client.cookies.set("ds_refresh", refresh)
    client.cookies.set("ds_csrf", csrf)
    assert client.post("/api/v1/auth/logout", headers=headers, json={}).status_code == 200
    client.cookies.clear()
    client.cookies.set("ds_refresh", refresh)
    client.cookies.set("ds_csrf", csrf)
    assert client.post("/api/v1/auth/refresh", headers=headers, json={}).status_code == 401


def test_account_rate_limit_shared_across_independent_instances(db_session: Session) -> None:
    sessions = sessionmaker(bind=db_session.get_bind())
    first, second = DatabaseRateLimiter(sessions), DatabaseRateLimiter(sessions)
    first.reserve([("account:Owner@example.com", 2, 86400)])
    second.reserve([("account:Owner@example.com", 2, 86400)])
    with pytest.raises(HTTPException) as failure:
        first.reserve([("account:Owner@example.com", 2, 86400)])
    assert failure.value.status_code == 429
    second.reserve([("account:another@example.com", 2, 86400)])


def test_ai_failures_have_durable_attempt_budget(
    db_session: Session, monkeypatch: pytest.MonkeyPatch
) -> None:
    sent = []

    class AIClient:
        async def __aenter__(self) -> AIClient:
            return self

        async def __aexit__(self, *args: Any) -> None:
            pass

        async def post(self, url: str, **kwargs: Any) -> httpx.Response:
            sent.append(kwargs["json"])
            return httpx.Response(500, request=httpx.Request("POST", url))

    monkeypatch.setattr(httpx, "AsyncClient", lambda **kwargs: AIClient())
    monkeypatch.setattr(settings, "ai_basic_daily_attempts", 2)

    async def dispatch() -> None:
        await openai_responses.create_response(
            {"model": "test-model", "max_output_tokens": 100000}, timeout=2
        )

    with acting_as(RequestActor("limited-basic", False, False)):
        for _ in range(2):
            with pytest.raises(httpx.HTTPStatusError):
                asyncio.run(dispatch())
        with pytest.raises(HTTPException) as error:
            asyncio.run(dispatch())
    assert error.value.status_code == 429 and len(sent) == 2
    assert all(item["max_output_tokens"] == 6000 for item in sent)


def test_provider_checks_entitlement_even_on_cache_hit(provider) -> None:  # type: ignore[no-untyped-def]
    provider.request("food.get.v5", {"food_id": "42"})
    from app.services.nutrition_budget import NutritionError

    with (
        acting_as(RequestActor("basic", False, True)),
        pytest.raises(NutritionError, match="account_not_authorized"),
    ):
        provider.request("food.get.v5", {"food_id": "42"})
    with (
        acting_as(RequestActor("premium-no-consent", True, False)),
        pytest.raises(NutritionError, match="account_not_authorized"),
    ):
        provider.request("food.get.v5", {"food_id": "42"})


def test_terms_persist_once_and_basic_cannot_accept(
    client: TestClient, auth_headers: dict[str, str], db_session: Session
) -> None:
    assert client.get("/api/v1/nutrition/consent", headers=auth_headers).status_code == 402
    user = db_session.scalar(select(User))
    subscription = db_session.scalar(select(UserSubscription))
    assert user and subscription
    subscription.plan_key = "macro_tracker_monthly"
    db_session.commit()
    assert not client.get("/api/v1/nutrition/consent", headers=auth_headers).json()["accepted"]
    path = "/api/v1/nutrition/consent"
    assert (
        client.post(path, headers=auth_headers, json={"terms_version": "unknown"}).status_code
        == 409
    )
    first = client.post(
        path, headers=auth_headers, json={"terms_version": FATSECRET_TERMS_VERSION}
    ).json()
    second = client.post(
        path, headers=auth_headers, json={"terms_version": FATSECRET_TERMS_VERSION}
    ).json()
    assert first["accepted"] and first["accepted_at"] == second["accepted_at"]


def test_photo_authorization_quota_and_password_revocation(
    client: TestClient,
    auth_headers: dict[str, str],
    db_session: Session,
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    storage = LocalMediaStorageAdapter(tmp_path, settings.public_api_url)
    monkeypatch.setattr("app.services.private_media.get_media_storage", lambda: storage)
    image = BytesIO()
    Image.new("RGB", (16, 16), "blue").save(image, "JPEG")
    upload = client.post(
        "/api/v1/recipes/photo-upload",
        headers=auth_headers,
        files={"file": ("photo.jpg", image.getvalue(), "image/jpeg")},
    )
    assert upload.status_code == 200, upload.text
    signed = upload.json()["photo_url"]
    parsed = urlsplit(signed)
    assert client.get(parsed.path).status_code == 422
    assert client.get(parsed.path + "?" + parsed.query).status_code == 200
    assert client.get(parsed.path + "/link").status_code == 401
    renewed = client.get(parsed.path + "/link", headers=auth_headers)
    assert renewed.status_code == 200 and renewed.headers["Cache-Control"] == "no-store"
    media = db_session.scalar(select(MediaObject))
    assert media
    assert client.get(f"/media/{media.storage_key}").status_code == 404
    monkeypatch.setattr(settings, "media_account_quota_bytes", media.size_bytes)
    assert (
        client.post(
            "/api/v1/recipes/photo-upload",
            headers=auth_headers,
            files={"file": ("photo.jpg", image.getvalue(), "image/jpeg")},
        ).status_code
        == 413
    )
    assert db_session.query(MediaObject).count() == 1
    user = db_session.scalar(select(User))
    assert user
    user.session_version += 1
    db_session.commit()
    assert client.get(parsed.path + "?" + parsed.query).status_code == 401


def test_private_photo_shared_group_and_unrelated_attachment(
    db_session: Session,
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    from app.services.private_media import canonical_photo, object_url, source_for, store_image

    storage = LocalMediaStorageAdapter(tmp_path, settings.public_api_url)
    monkeypatch.setattr("app.services.private_media.get_media_storage", lambda: storage)
    owner = User(email="photo-owner@example.com", password_hash=str(uuid4()))
    member = User(email="photo-member@example.com", password_hash=str(uuid4()))
    stranger = User(email="photo-stranger@example.com", password_hash=str(uuid4()))
    group = Household(name="Photo sharing")
    db_session.add_all([owner, member, stranger, group])
    db_session.flush()
    db_session.add(HouseholdMember(household_id=group.id, user_id=member.id, role="member"))
    image = BytesIO()
    Image.new("RGB", (8, 8), "red").save(image, "JPEG")
    media = store_image(db_session, owner, image.getvalue())
    recipe = Recipe(
        name="Shared photo",
        owner_user_id=owner.id,
        photo_url=object_url(media.id),
        content_hash=str(uuid4()),
    )
    db_session.add(recipe)
    db_session.flush()
    db_session.add(HouseholdRecipe(household_id=group.id, recipe_id=recipe.id))
    db_session.commit()
    assert source_for(db_session, member, "recipes", recipe.id) == object_url(media.id)
    assert canonical_photo(db_session, member, object_url(media.id)) == object_url(media.id)
    db_session.commit()
    for kind, resource in (("recipes", recipe.id), ("objects", media.id)):
        with pytest.raises(HTTPException) as denied:
            source_for(db_session, stranger, kind, resource)
        assert denied.value.status_code == 404
    with pytest.raises(HTTPException):
        canonical_photo(db_session, stranger, object_url(media.id))


def test_legacy_photo_edits_and_copies_remain_authorized(
    db_session: Session,
    tmp_path: Path,
) -> None:
    from app.services.private_media import canonical_photo, photo_url

    owner = User(email="legacy-photo@example.com", password_hash=str(uuid4()))
    stranger = User(email="legacy-stranger@example.com", password_hash=str(uuid4()))
    db_session.add_all([owner, stranger])
    db_session.flush()
    storage = LocalMediaStorageAdapter(tmp_path, settings.public_api_url)
    image = BytesIO()
    Image.new("RGB", (8, 8), "blue").save(image, "JPEG")
    old = storage.save_recipe_image(
        user_id=owner.id, data=image.getvalue(), suffix=".jpg", content_type="image/jpeg"
    )
    recipe = Recipe(
        name="Legacy recipe", owner_user_id=owner.id, photo_url=old.url, content_hash=str(uuid4())
    )
    db_session.add(recipe)
    db_session.commit()
    signed = photo_url(db_session, owner, "recipes", recipe.id, old.url)
    assert canonical_photo(db_session, owner, signed) == old.url
    with pytest.raises(HTTPException):
        canonical_photo(db_session, stranger, old.url)


def test_cleanup_scans_beyond_referenced_objects_and_preserves_legacy(
    db_session: Session,
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    from app.services.media_maintenance import cleanup_media
    from app.services.private_media import object_url

    monkeypatch.setattr(settings, "media_cleanup_enabled", True)
    storage = LocalMediaStorageAdapter(tmp_path, settings.public_api_url)
    monkeypatch.setattr("app.services.media_maintenance.get_media_storage", lambda: storage)
    owner = User(email="cleanup-owner@example.com", password_hash=str(uuid4()))
    db_session.add(owner)
    db_session.flush()
    old = datetime.utcnow() - timedelta(hours=49)
    for index in range(101):
        media = MediaObject(
            id=f"{index:036d}",
            owner_user_id=owner.id,
            storage_key=f"uploads/{owner.id}/{index}.jpg",
            backend="local",
            content_type="image/jpeg",
            size_bytes=100,
            created_at=old,
            claimed_at=old,
        )
        db_session.add(media)
        db_session.add(
            Recipe(
                name=f"Referenced {index}",
                owner_user_id=owner.id,
                photo_url=object_url(media.id),
                content_hash=str(uuid4()),
            )
        )
    orphan = MediaObject(
        id="f" * 36,
        owner_user_id=owner.id,
        storage_key=f"uploads/{owner.id}/orphan.jpg",
        backend="local",
        content_type="image/jpeg",
        size_bytes=100,
        created_at=old,
    )
    legacy = MediaObject(
        id="e" * 36,
        owner_user_id=owner.id,
        storage_key=f"uploads/{owner.id}/legacy.jpg",
        backend="local",
        content_type="image/jpeg",
        size_bytes=100,
        created_at=old,
        managed=False,
    )
    db_session.add_all([orphan, legacy])
    db_session.commit()
    assert cleanup_media(db_session) == 0
    assert cleanup_media(db_session) == 1
    assert orphan.deleted_at and not legacy.deleted_at


def test_spreadsheet_limits_before_materialization_and_normal_truncation(tmp_path: Path) -> None:
    limits = (2000, 100, 10000, 50000000, 10000000)
    path = tmp_path / "recipes.csv"
    path.write_text("name,ingredients,instructions\n" + "Eggs,,\n" * 2001)
    rows, headers = parse_spreadsheet(str(path), ".csv", limits)
    assert (
        len(rows) == 2000
        and headers == ["name", "ingredients", "instructions"]
        and rows[0]["ingredients"] == ""
    )
    path.write_text(",".join(f"column{i}" for i in range(101)))
    with pytest.raises(ValueError):
        parse_spreadsheet(str(path), ".csv", limits)


def test_dimensionless_xlsx_preserves_columns(tmp_path: Path) -> None:
    import re

    from openpyxl import Workbook

    workbook = Workbook()
    assert workbook.active
    workbook.active.append(["name", "ingredients", "instructions"])
    workbook.active.append(["Eggs", "2 eggs", "Cook"])
    stream = BytesIO()
    workbook.save(stream)
    path = tmp_path / "dimensionless.xlsx"
    with zipfile.ZipFile(stream) as original, zipfile.ZipFile(path, "w") as rewritten:
        for item in original.infolist():
            data = original.read(item.filename)
            if item.filename == "xl/worksheets/sheet1.xml":
                data = re.sub(rb"<dimension[^>]*/>", b"", data)
            rewritten.writestr(item, data)
    rows, headers = parse_spreadsheet(str(path), ".xlsx", (2000, 100, 10000, 50000000, 10000000))
    assert headers == ["name", "ingredients", "instructions"]
    assert rows == [{"name": "Eggs", "ingredients": "2 eggs", "instructions": "Cook"}]


def test_slow_dns_does_not_block_async_requests(monkeypatch: pytest.MonkeyPatch) -> None:
    def resolve(_: str) -> str:
        time.sleep(0.15)
        return "93.184.216.34"

    monkeypatch.setattr(url_fetcher, "validate_public_url", resolve)
    original = httpx.AsyncClient
    monkeypatch.setattr(
        httpx,
        "AsyncClient",
        lambda **kwargs: original(
            transport=httpx.MockTransport(
                lambda request: httpx.Response(
                    200, headers={"Content-Type": "text/html"}, stream=httpx.ByteStream(b"OK")
                )
            ),
            **kwargs,
        ),
    )

    async def run() -> None:
        task = asyncio.create_task(url_fetcher.fetch_public_html("https://public.example/"))
        started = time.monotonic()
        await asyncio.sleep(0.01)
        assert time.monotonic() - started < 0.1
        assert await task == ("OK", "https://public.example/")

    asyncio.run(run())


def test_dns_connection_pinned_and_redirect_private_blocked(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    addresses = []
    monkeypatch.setattr(
        socket,
        "getaddrinfo",
        lambda *args, **kwargs: (
            [(2, 1, 6, "", ("93.184.216.34", 443))]
            if args[0] == "public.example"
            else [(2, 1, 6, "", ("127.0.0.1", 80))]
        ),
    )

    class Stream(httpx.AsyncByteStream):
        async def __aiter__(self) -> AsyncIterator[bytes]:
            yield b"<html>recipe</html>"

    def handler(request: httpx.Request) -> httpx.Response:
        addresses.append(request)
        return httpx.Response(200, headers={"Content-Type": "text/html"}, stream=Stream())

    original = httpx.AsyncClient
    monkeypatch.setattr(
        httpx,
        "AsyncClient",
        lambda **kwargs: original(transport=httpx.MockTransport(handler), **kwargs),
    )
    assert (
        asyncio.run(url_fetcher.fetch_public_html("https://public.example/recipe"))[0]
        == "<html>recipe</html>"
    )
    assert (
        addresses[0].url.host == "93.184.216.34"
        and addresses[0].headers["Host"] == "public.example"
    )
    assert addresses[0].extensions["sni_hostname"] == "public.example"
    monkeypatch.setattr(
        httpx,
        "AsyncClient",
        lambda **kwargs: original(
            transport=httpx.MockTransport(
                lambda request: httpx.Response(
                    302, headers={"Location": "http://localhost/private"}
                )
            ),
            **kwargs,
        ),
    )
    with pytest.raises(HTTPException):
        asyncio.run(url_fetcher.fetch_public_html("https://public.example/recipe"))


def test_gzip_html_is_supported_but_expansion_is_bounded(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(url_fetcher, "validate_public_url", lambda _: "93.184.216.34")
    original = httpx.AsyncClient
    payload = b"<html>Recipe</html>"
    monkeypatch.setattr(
        httpx,
        "AsyncClient",
        lambda **kwargs: original(
            transport=httpx.MockTransport(
                lambda request: httpx.Response(
                    200,
                    headers={"Content-Type": "text/html", "Content-Encoding": "gzip"},
                    stream=httpx.ByteStream(gzip.compress(payload)),
                )
            ),
            **kwargs,
        ),
    )
    assert (
        asyncio.run(url_fetcher.fetch_public_html("https://public.example/recipe"))[0]
        == payload.decode()
    )
    payload = b"x" * (settings.max_url_response_size_bytes + 1)
    with pytest.raises(HTTPException) as error:
        asyncio.run(url_fetcher.fetch_public_html("https://public.example/recipe"))
    assert error.value.status_code == 413
