from __future__ import annotations

import hashlib
import hmac
import ipaddress
import time
from collections.abc import Callable
from datetime import UTC, datetime

from fastapi import HTTPException, Request
from sqlalchemy import delete, select
from sqlalchemy.dialects.postgresql import insert as pg_insert
from sqlalchemy.dialects.sqlite import insert as sqlite_insert
from sqlalchemy.orm import Session

from app.core.config import settings
from app.database.session import SessionLocal
from app.models.security import RateLimitCounter


class DatabaseRateLimiter:
    def __init__(self, sessions: Callable[[], Session]) -> None:
        self.sessions = sessions

    def check(self, key: str, limit: int, window_seconds: int) -> None:
        self.reserve([(key, limit, window_seconds)])

    def reserve(self, limits: list[tuple[str, int, int]]) -> None:
        now = time.time()
        with self.sessions() as db:
            insert = pg_insert if db.get_bind().dialect.name == "postgresql" else sqlite_insert
            reservations = []
            for key, limit, window in limits:
                bucket = int(now // window)
                digest = hmac.new(
                    settings.jwt_secret.encode(),
                    f"{key}:{window}:{bucket}".encode(),
                    hashlib.sha256,
                ).hexdigest()
                reset = datetime.fromtimestamp((bucket + 1) * window, UTC).replace(tzinfo=None)
                reservations.append((digest, limit, reset))
            for digest, limit, reset in sorted(reservations):
                db.execute(
                    insert(RateLimitCounter)
                    .values(key=digest, count=0, reset_at=reset)
                    .on_conflict_do_nothing(index_elements=["key"])
                )
                counter = db.scalars(
                    select(RateLimitCounter).where(RateLimitCounter.key == digest).with_for_update()
                ).one()
                if counter.count >= limit:
                    raise HTTPException(
                        429,
                        "Too many attempts. Please wait and try again.",
                        headers={
                            "Retry-After": str(
                                max(1, int((reset - datetime.utcnow()).total_seconds()))
                            )
                        },
                    )
                counter.count += 1
            db.commit()

    def prune(self) -> None:
        with self.sessions() as db:
            db.execute(
                delete(RateLimitCounter).where(RateLimitCounter.reset_at < datetime.utcnow())
            )
            db.commit()


auth_rate_limiter = DatabaseRateLimiter(SessionLocal)


def client_identifier(request: Request) -> str:
    # Uvicorn rewrites request.client only for configured trusted proxy peers.
    raw = request.client.host if request.client else "unknown"
    try:
        return str(ipaddress.ip_address(raw))
    except ValueError:
        return "unknown"


def check_auth_rate_limit(
    request: Request,
    action: str,
    subject: str,
    *,
    ip_limit: int = 60,
    subject_limit: int = 8,
    window_seconds: int = 60,
) -> None:
    ip = client_identifier(request)
    normalized_subject = subject.lower().strip() or "anonymous"
    auth_rate_limiter.reserve(
        [
            (f"auth:{action}:ip:{ip}", ip_limit, window_seconds),
            (f"auth:{action}:subject:{normalized_subject}", subject_limit, window_seconds),
        ]
    )
