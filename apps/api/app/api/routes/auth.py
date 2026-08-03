from __future__ import annotations

from fastapi import APIRouter, HTTPException, status
from sqlalchemy import select

from app.api.deps import DbDep
from app.core.security import (
    create_access_token,
    create_refresh_token,
    decode_token,
    hash_password,
    verify_password,
)
from app.models.entities import Household, HouseholdMember, User, UserProfile
from app.schemas.common import LoginRequest, RefreshRequest, RegisterRequest, TokenPair
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
