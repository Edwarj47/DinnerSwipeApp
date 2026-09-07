from __future__ import annotations

import os
from collections.abc import Callable, Generator

os.environ["DATABASE_URL"] = "sqlite:///:memory:"
os.environ["JWT_SECRET"] = "test-secret-value-that-is-long-enough"

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import create_engine
from sqlalchemy.orm import Session, sessionmaker
from sqlalchemy.pool import StaticPool

from app.core.rate_limit import auth_rate_limiter
from app.database.session import get_db
from app.main import app
from app.models import entities  # noqa: F401
from app.models.base import Base
from app.models.entities import User, UserSubscription


@pytest.fixture(autouse=True)
def reset_rate_limiter() -> Generator[None, None, None]:
    auth_rate_limiter.counters.clear()
    yield
    auth_rate_limiter.counters.clear()


@pytest.fixture()
def db_session() -> Generator[Session, None, None]:
    engine = create_engine(
        "sqlite:///:memory:",
        connect_args={"check_same_thread": False},
        poolclass=StaticPool,
    )
    TestingSessionLocal = sessionmaker(bind=engine, autoflush=False, autocommit=False)
    Base.metadata.create_all(bind=engine)
    db = TestingSessionLocal()
    try:
        yield db
    finally:
        db.close()


@pytest.fixture()
def client(db_session: Session) -> Generator[TestClient, None, None]:
    def override_db() -> Generator[Session, None, None]:
        yield db_session

    app.dependency_overrides[get_db] = override_db
    try:
        yield TestClient(app)
    finally:
        app.dependency_overrides.clear()


@pytest.fixture()
def auth_headers(client: TestClient, db_session: Session) -> dict[str, str]:
    response = client.post(
        "/api/v1/auth/register",
        json={
            "email": "owner@example.com",
            "password": "change-me-123",
            "terms_accepted": True,
            "privacy_accepted": True,
        },
    )
    user = db_session.query(User).filter_by(email="owner@example.com").one()
    user.email_verified = True
    db_session.add(
        UserSubscription(
            user_id=user.id,
            plan_key="basic_monthly",
            status="active",
            source="waiver_code",
            metadata_json={"fixture": "basic_access"},
        )
    )
    db_session.commit()
    token = response.json()["access_token"]
    return {"Authorization": f"Bearer {token}"}


@pytest.fixture()
def grant_basic_access(db_session: Session) -> Callable[[str], UserSubscription]:
    def grant(email: str) -> UserSubscription:
        user = db_session.query(User).filter_by(email=email).one()
        subscription = UserSubscription(
            user_id=user.id,
            plan_key="basic_monthly",
            status="active",
            source="waiver_code",
            metadata_json={"fixture": "basic_access"},
        )
        db_session.add(subscription)
        db_session.commit()
        return subscription

    return grant
