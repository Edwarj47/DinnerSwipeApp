from __future__ import annotations

from datetime import UTC, datetime, timedelta
from typing import cast

from jose import JWTError, jwt
from passlib.context import CryptContext

from app.core.config import settings

pwd_context = CryptContext(schemes=["bcrypt"], deprecated="auto")
ALGORITHM = "HS256"


def hash_password(password: str) -> str:
    return pwd_context.hash(password)


def verify_password(password: str, password_hash: str) -> bool:
    return pwd_context.verify(password, password_hash)


def create_token(
    subject: str, token_type: str, expires_delta: timedelta, *, session_version: int = 0
) -> str:
    expires_at = datetime.now(UTC) + expires_delta
    payload = {"sub": subject, "type": token_type, "exp": expires_at, "sv": session_version}
    return cast(str, jwt.encode(payload, settings.jwt_secret, algorithm=ALGORITHM))


def create_access_token(user_id: str, session_version: int = 0) -> str:
    return create_token(
        user_id,
        "access",
        timedelta(minutes=settings.access_token_minutes),
        session_version=session_version,
    )


def create_refresh_token(user_id: str) -> str:
    return create_token(user_id, "refresh", timedelta(days=settings.refresh_token_days))


def decode_token(token: str, expected_type: str = "access") -> str | None:
    payload = decode_payload(token, expected_type)
    if payload is None:
        return None
    subject = payload.get("sub")
    return str(subject) if subject else None


def decode_payload(token: str, expected_type: str = "access") -> dict[str, object] | None:
    try:
        payload = jwt.decode(
            token,
            settings.jwt_secret,
            algorithms=[ALGORITHM],
            options={"require_exp": True, "require_sub": True},
        )
    except JWTError:
        return None
    if payload.get("type") != expected_type:
        return None
    return cast(dict[str, object], payload)
