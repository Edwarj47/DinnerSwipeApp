from __future__ import annotations

from collections.abc import AsyncIterator
from typing import Annotated

from fastapi import Depends, HTTPException, Request, status
from fastapi.security import OAuth2PasswordBearer
from sqlalchemy import select
from sqlalchemy.orm import Session
from starlette.concurrency import run_in_threadpool

from app.core.actor import RequestActor, acting_as
from app.core.security import decode_payload
from app.database.session import get_db
from app.models.entities import User, UserSubscription
from app.services.billing import is_premium_active, require_basic_access
from app.services.nutrition_consent import consent_status
from app.services.web_sessions import ACCESS_COOKIE, cookie_mode, verify_csrf

oauth2_scheme = OAuth2PasswordBearer(tokenUrl="/api/v1/auth/login", auto_error=False)
DbDep = Annotated[Session, Depends(get_db)]


async def get_current_user(
    db: DbDep, request: Request, token: Annotated[str | None, Depends(oauth2_scheme)]
) -> AsyncIterator[User]:
    if token is None:
        token = request.cookies.get(ACCESS_COOKIE)
        if token and request.method not in {"GET", "HEAD", "OPTIONS"}:
            verify_csrf(request)
    if not token:
        raise HTTPException(401, "Invalid token")
    claims = decode_payload(token)
    user_id = claims.get("sub") if claims else None
    if not user_id:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid token")
    user = await run_in_threadpool(db.get, User, user_id)
    version = claims.get("sv", 0) if claims else None
    if (
        not user
        or not user.is_active
        or type(version) is not int
        or version != user.session_version
    ):
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid token")
    expected = request.headers.get("x-dinner-account")
    if expected and expected != user.id:
        raise HTTPException(409, "Account changed. Reload before continuing.")
    subscription = await run_in_threadpool(
        db.scalar, select(UserSubscription).where(UserSubscription.user_id == user.id)
    )
    with acting_as(
        RequestActor(
            user.id, is_premium_active(subscription), bool(consent_status(user)["accepted"])
        )
    ):
        yield user


def get_verified_user(current_user: Annotated[User, Depends(get_current_user)]) -> User:
    if not current_user.email_verified:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Verify your email before using group planning.",
        )
    return current_user


def get_basic_user(db: DbDep, current_user: Annotated[User, Depends(get_current_user)]) -> User:
    return require_basic_access(db, current_user)


def get_verified_basic_user(
    db: DbDep, current_user: Annotated[User, Depends(get_verified_user)]
) -> User:
    return require_basic_access(db, current_user)


async def get_logout_user(
    db: DbDep, request: Request, token: Annotated[str | None, Depends(oauth2_scheme)]
) -> AsyncIterator[User | None]:
    # A valid refresh/CSRF cookie can sign out even after the access cookie expires.
    if cookie_mode(request):
        verify_csrf(request)
        yield None
        return
    async for user in get_current_user(db, request, token):
        yield user


LogoutUser = Annotated[User | None, Depends(get_logout_user)]
CurrentUser = Annotated[User, Depends(get_current_user)]
VerifiedUser = Annotated[User, Depends(get_verified_user)]
BasicUser = Annotated[User, Depends(get_basic_user)]
VerifiedBasicUser = Annotated[User, Depends(get_verified_basic_user)]
