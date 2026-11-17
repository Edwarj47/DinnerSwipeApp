"""Concurrent welcome claims against a separately provisioned disposable database."""

import os
from concurrent.futures import ThreadPoolExecutor
from uuid import uuid4

import pytest
from alembic.config import Config
from sqlalchemy import create_engine, select
from sqlalchemy.engine import make_url
from sqlalchemy.orm import sessionmaker

from alembic import command
from app.core.config import settings
from app.models.entities import AuditEvent, ComplimentaryPremiumAccess, User
from app.services.welcome_access import WELCOME_OFFER, start_welcome


@pytest.mark.skipif(
    not os.environ.get("SECURITY_TEST_DATABASE_URL"), reason="Disposable PostgreSQL only"
)
def test_parallel_welcome_starts_keep_one_expiry_and_one_audit(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    url = os.environ["SECURITY_TEST_DATABASE_URL"]
    parsed = make_url(url)
    assert (parsed.host, parsed.port, parsed.database) == ("127.0.0.1", 15413, "security_test")
    monkeypatch.setattr(settings, "database_url", url)
    command.upgrade(Config("alembic.ini"), "head")
    engine = create_engine(url)
    sessions = sessionmaker(engine)
    with sessions() as db:
        user = User(email=f"{uuid4()}@example.com", password_hash=str(uuid4()), email_verified=True)
        db.add(user)
        db.flush()
        user_id = user.id
        db.add(ComplimentaryPremiumAccess(user_id=user_id, offer_key=WELCOME_OFFER))
        db.commit()

    def claim(_: int) -> str:
        with sessions() as db:
            user = db.get(User, user_id)
            assert user is not None
            row = start_welcome(db, user)
            assert row.ends_at is not None
            return row.ends_at.isoformat()

    with ThreadPoolExecutor(max_workers=4) as pool:
        assert len(set(pool.map(claim, range(8)))) == 1
    with sessions() as db:
        assert (
            len(
                list(
                    db.scalars(
                        select(AuditEvent).where(
                            AuditEvent.user_id == user_id,
                            AuditEvent.event_type == "complimentary_premium_started",
                        )
                    )
                )
            )
            == 1
        )
    engine.dispose()
