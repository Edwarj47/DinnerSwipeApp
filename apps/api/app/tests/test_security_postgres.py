"""Security concurrency checks against an explicitly disposable PostgreSQL instance."""

import os
import threading
import time
from concurrent.futures import ThreadPoolExecutor
from io import BytesIO
from pathlib import Path
from uuid import uuid4

import pytest
from alembic.config import Config
from fastapi import HTTPException, Request, Response
from PIL import Image
from sqlalchemy import create_engine, func, select
from sqlalchemy.engine import make_url
from sqlalchemy.orm import sessionmaker

from alembic import command
from app.core.config import settings
from app.core.rate_limit import DatabaseRateLimiter
from app.core.security import hash_password, verify_password
from app.models.entities import RefreshToken, User
from app.models.security import MediaObject, RateLimitCounter
from app.services.auth_tokens import hash_refresh_token, invalidate_user_sessions
from app.services.media_storage import LocalMediaStorageAdapter
from app.services.private_media import normalize_image, store_image


@pytest.mark.skipif(
    not os.environ.get("SECURITY_TEST_DATABASE_URL"), reason="Disposable PostgreSQL only"
)
def test_shared_rate_limit_and_photo_quota_are_atomic(
    monkeypatch: pytest.MonkeyPatch,
    tmp_path: Path,
) -> None:
    url = os.environ["SECURITY_TEST_DATABASE_URL"]
    parsed = make_url(url)
    assert (
        parsed.host == "127.0.0.1" and parsed.port == 15413 and parsed.database == "security_test"
    )
    monkeypatch.setattr(settings, "database_url", url)
    command.upgrade(Config("alembic.ini"), "head")
    engine = create_engine(url)
    sessions = sessionmaker(engine)
    key = f"concurrent-security-{uuid4()}"

    def reserve(_: int) -> int:
        try:
            DatabaseRateLimiter(sessions).reserve([(key, 3, 86400)])
            return 200
        except HTTPException as error:
            return error.status_code

    try:
        with ThreadPoolExecutor(max_workers=8) as workers:
            results = list(workers.map(reserve, range(8)))
        assert sorted(results) == [200] * 3 + [429] * 5
        with sessions() as db:
            assert db.scalar(select(func.max(RateLimitCounter.count))) == 3
            user = User(email=f"{uuid4()}@example.com", password_hash=str(uuid4()))
            db.add(user)
            db.commit()
            user_id = user.id
        image = BytesIO()
        Image.new("RGB", (16, 16), "blue").save(image, "JPEG")
        raw = image.getvalue()
        monkeypatch.setattr(settings, "media_account_quota_bytes", len(normalize_image(raw)))
        storage = LocalMediaStorageAdapter(tmp_path, settings.public_api_url)
        monkeypatch.setattr("app.services.private_media.get_media_storage", lambda: storage)

        def upload(_: int) -> int:
            with sessions() as db:
                user = db.get(User, user_id)
                assert user
                try:
                    store_image(db, user, raw)
                    return 200
                except HTTPException as error:
                    return error.status_code

        with ThreadPoolExecutor(max_workers=5) as workers:
            results = list(workers.map(upload, range(5)))
        assert sorted(results) == [200] + [413] * 4
        with sessions() as db:
            assert (
                db.scalar(
                    select(func.count())
                    .select_from(MediaObject)
                    .where(MediaObject.owner_user_id == user_id)
                )
                == 1
            )
        assert len(list((tmp_path / "uploads" / user_id).glob("*.jpg"))) == 1
    finally:
        engine.dispose()


@pytest.mark.skipif(
    not os.environ.get("SECURITY_TEST_DATABASE_URL"), reason="Disposable PostgreSQL only"
)
def test_login_and_password_reset_share_account_lock(monkeypatch: pytest.MonkeyPatch) -> None:
    from app.api.routes import auth
    from app.schemas.common import LoginRequest

    url = os.environ["SECURITY_TEST_DATABASE_URL"]
    parsed = make_url(url)
    assert (
        parsed.host == "127.0.0.1" and parsed.port == 15413 and parsed.database == "security_test"
    )
    engine = create_engine(url)
    sessions = sessionmaker(engine)
    email = f"{uuid4()}@example.com"
    old_password = str(uuid4())
    new_hash = hash_password(str(uuid4()))
    with sessions() as db:
        user = User(email=email, password_hash=hash_password(old_password))
        db.add(user)
        db.commit()
        user_id = user.id
    verified, release, reset_started, reset_done = (threading.Event() for _ in range(4))
    original = verify_password

    def pause_verification(password: str, hashed: str) -> bool:
        result = original(password, hashed)
        verified.set()
        assert release.wait(5)
        return result

    monkeypatch.setattr(auth, "verify_password", pause_verification)
    monkeypatch.setattr(auth, "check_auth_rate_limit", lambda *args, **kwargs: None)
    monkeypatch.setattr(auth, "restore_default_household", lambda *args: None)

    def login() -> str:
        with sessions() as db:
            pair = auth.login(
                LoginRequest(email=email, password=old_password),
                Request(
                    {
                        "type": "http",
                        "headers": [],
                        "client": ("127.0.0.1", 1),
                    }
                ),
                Response(),
                db,
            )
            return pair.refresh_token

    def reset() -> None:
        with sessions() as db:
            reset_started.set()
            user = db.scalar(select(User).where(User.id == user_id).with_for_update())
            assert user
            user.password_hash = new_hash
            invalidate_user_sessions(db, user)
            db.commit()
            reset_done.set()

    try:
        with ThreadPoolExecutor(max_workers=2) as workers:
            login_result = workers.submit(login)
            assert verified.wait(5)
            reset_result = workers.submit(reset)
            assert reset_started.wait(5)
            time.sleep(0.1)
            assert not reset_done.is_set()
            release.set()
            token = login_result.result(5)
            reset_result.result(5)
        with sessions() as db:
            row = db.scalar(
                select(RefreshToken).where(RefreshToken.token_hash == hash_refresh_token(token))
            )
            assert row and row.revoked_at
            updated_user = db.get(User, user_id)
            assert updated_user and updated_user.session_version == 1
    finally:
        release.set()
        engine.dispose()
