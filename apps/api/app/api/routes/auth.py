# ruff: noqa: E501

from __future__ import annotations

from fastapi import APIRouter, HTTPException, status
from fastapi.responses import HTMLResponse
from sqlalchemy import select

from app.api.deps import CurrentUser, DbDep
from app.core.config import settings
from app.core.security import (
    create_access_token,
    create_refresh_token,
    decode_token,
    hash_password,
    verify_password,
)
from app.models.entities import Household, HouseholdMember, User, UserProfile
from app.schemas.common import (
    AuthStatus,
    LoginRequest,
    PasswordResetConfirm,
    PasswordResetRequest,
    RefreshRequest,
    RegisterRequest,
    TokenPair,
    VerifyEmailRequest,
)
from app.services.email_auth import (
    create_email_verification,
    create_password_reset,
    reset_password,
    verify_email_token,
)
from app.services.groups import generate_invite_code

router = APIRouter(prefix="/auth", tags=["auth"])


@router.post("/register", response_model=TokenPair)
def register(payload: RegisterRequest, db: DbDep) -> TokenPair:
    email = payload.email.lower()
    if db.scalar(select(User).where(User.email == email)):
        raise HTTPException(status_code=409, detail="Email is already registered")
    user = User(email=email, password_hash=hash_password(payload.password))
    household = Household(name=f"{email}'s household", invite_code=generate_invite_code(db))
    db.add_all([user, household])
    db.flush()
    db.add(HouseholdMember(household_id=household.id, user_id=user.id, role="owner"))
    db.add(UserProfile(user_id=user.id, household_id=household.id))
    db.commit()
    db.refresh(user)
    create_email_verification(db, user)
    return TokenPair(
        access_token=create_access_token(user.id), refresh_token=create_refresh_token(user.id)
    )


@router.post("/login", response_model=TokenPair)
def login(payload: LoginRequest, db: DbDep) -> TokenPair:
    user = db.scalar(select(User).where(User.email == payload.email.lower()))
    if not user or not verify_password(payload.password, user.password_hash):
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid email or password"
        )
    return TokenPair(
        access_token=create_access_token(user.id), refresh_token=create_refresh_token(user.id)
    )


@router.post("/refresh", response_model=TokenPair)
def refresh(payload: RefreshRequest, db: DbDep) -> TokenPair:
    user_id = decode_token(payload.refresh_token, "refresh")
    user = db.get(User, user_id) if user_id else None
    if not user:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid refresh token"
        )
    return TokenPair(
        access_token=create_access_token(user.id), refresh_token=create_refresh_token(user.id)
    )


@router.post("/logout")
def logout() -> dict[str, str]:
    return {"status": "ok"}


@router.get("/status", response_model=AuthStatus)
def status_route(current_user: CurrentUser) -> AuthStatus:
    return AuthStatus(
        email=current_user.email,
        email_verified=current_user.email_verified,
        smtp_configured=settings.smtp_configured,
    )


@router.post("/resend-verification")
def resend_verification(current_user: CurrentUser, db: DbDep) -> dict[str, object]:
    if current_user.email_verified:
        return {"status": "already_verified", "sent": False}
    sent = create_email_verification(db, current_user)
    return {"status": "sent" if sent else "smtp_not_configured", "sent": sent}


@router.post("/verify-email")
def verify_email(payload: VerifyEmailRequest, db: DbDep) -> dict[str, str]:
    verify_email_token(db, payload.token)
    return {"status": "verified"}


@router.get("/verify-email", response_class=HTMLResponse)
def verify_email_link(token: str, db: DbDep) -> str:
    try:
        verify_email_token(db, token)
        title = "Email verified"
        message = (
            "Your Dinner Swipe email is verified. You can close this page and return to the app."
        )
        color = "#2f7d59"
    except HTTPException as exc:
        title = "Verification failed"
        message = str(exc.detail)
        color = "#b3261e"
    return f"""<!doctype html>
<html><body style="margin:0;background:#fff6f3;font-family:Arial,Helvetica,sans-serif;color:#24211f;">
<main style="max-width:520px;margin:48px auto;background:#fff;border:1px solid #eaded2;border-radius:12px;padding:28px;text-align:center;">
<div style="width:64px;height:64px;border-radius:999px;background:#fff;border:4px solid #ffd9d6;display:flex;align-items:center;justify-content:center;font-family:Georgia,serif;font-style:italic;font-weight:900;color:#d71920;font-size:25px;margin:0 auto 18px;">DS</div>
<h1 style="color:{color};margin:0 0 10px;">{title}</h1>
<p style="line-height:24px;color:#756f68;">{message}</p>
</main></body></html>"""


@router.post("/password-reset/request")
def password_reset_request(payload: PasswordResetRequest, db: DbDep) -> dict[str, str]:
    create_password_reset(db, str(payload.email))
    return {"status": "if_account_exists_email_sent"}


@router.post("/password-reset/confirm")
def password_reset_confirm(payload: PasswordResetConfirm, db: DbDep) -> dict[str, str]:
    reset_password(db, payload.token, payload.password)
    return {"status": "password_reset"}
