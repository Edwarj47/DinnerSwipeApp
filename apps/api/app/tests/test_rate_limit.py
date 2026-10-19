from __future__ import annotations

import time
from typing import cast

import pytest
from fastapi import HTTPException
from sqlalchemy import select
from sqlalchemy.orm import Session, sessionmaker

from app.core.rate_limit import DatabaseRateLimiter
from app.models.security import RateLimitCounter


def test_rate_limit_has_structured_code_and_rounds_retry_up(
    db_session: Session, monkeypatch: pytest.MonkeyPatch
) -> None:
    monkeypatch.setattr(time, "time", lambda: 120.1)
    limiter = DatabaseRateLimiter(sessionmaker(bind=db_session.get_bind()))
    key = "nutrition:lookup:private-user-id"
    limiter.check(key, 1, 60)
    with pytest.raises(HTTPException) as failure:
        limiter.check(key, 1, 60)
    error = failure.value
    assert error.status_code == 429
    assert cast(dict[str, object], error.detail) == {
        "code": "rate_limit",
        "message": "Nutrition database lookup limit reached. Please wait and retry.",
        "retry_after_seconds": 60,
    }
    assert error.headers == {"Retry-After": "60", "Cache-Control": "no-store"}
    assert "private-user-id" not in str(error.detail)
    assert db_session.scalar(select(RateLimitCounter.count)) == 1


def test_rejected_reservation_does_not_charge_other_bucket(
    db_session: Session, monkeypatch: pytest.MonkeyPatch
) -> None:
    monkeypatch.setattr(time, "time", lambda: 120.1)
    limiter = DatabaseRateLimiter(sessionmaker(bind=db_session.get_bind()))
    limiter.check("full", 1, 60)
    with pytest.raises(HTTPException):
        limiter.reserve([("full", 1, 60), ("unused", 1, 60)])
    limiter.check("unused", 1, 60)
    assert list(db_session.scalars(select(RateLimitCounter.count))) == [1, 1]


def test_rate_limit_resets_at_window_boundary(
    db_session: Session, monkeypatch: pytest.MonkeyPatch
) -> None:
    limiter = DatabaseRateLimiter(sessionmaker(bind=db_session.get_bind()))
    monkeypatch.setattr(time, "time", lambda: 179.9)
    limiter.check("test", 1, 60)
    with pytest.raises(HTTPException) as failure:
        limiter.check("test", 1, 60)
    assert failure.value.headers and failure.value.headers["Retry-After"] == "1"
    monkeypatch.setattr(time, "time", lambda: 180.0)
    limiter.check("test", 1, 60)
