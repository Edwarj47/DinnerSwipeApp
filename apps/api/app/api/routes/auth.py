# ruff: noqa: E501

from __future__ import annotations

from datetime import UTC, datetime

from fastapi import APIRouter, HTTPException, Request, status
from fastapi.responses import HTMLResponse
from sqlalchemy import select

from app.api.deps import CurrentUser, DbDep
from app.core.config import settings
from app.core.rate_limit import check_auth_rate_limit
from app.core.security import (
    create_access_token,
    create_refresh_token,
    decode_token,
    hash_password,
    verify_password,
)
from app.models.entities import (
    AuditEvent,
    GroceryList,
    GroceryListItem,
    Household,
    HouseholdMember,
    Recipe,
    UrlIngestionCandidate,
    User,
    UserProfile,
    WeeklyPlan,
    WeeklyPlanSlot,
)
from app.schemas.common import (
    AccountDeletionRequest,
    AuthStatus,
    ChangePasswordRequest,
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
def register(payload: RegisterRequest, request: Request, db: DbDep) -> TokenPair:
    email = payload.email.lower()
    check_auth_rate_limit(request, "register", email, subject_limit=4)
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
def login(payload: LoginRequest, request: Request, db: DbDep) -> TokenPair:
    check_auth_rate_limit(request, "login", str(payload.email), subject_limit=8)
    user = db.scalar(select(User).where(User.email == payload.email.lower()))
    if not user or not user.is_active or not verify_password(payload.password, user.password_hash):
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
def password_reset_request(
    payload: PasswordResetRequest, request: Request, db: DbDep
) -> dict[str, str]:
    check_auth_rate_limit(request, "password_reset", str(payload.email), subject_limit=4)
    create_password_reset(db, str(payload.email))
    return {"status": "if_account_exists_email_sent"}


@router.post("/password-reset/confirm")
def password_reset_confirm(payload: PasswordResetConfirm, db: DbDep) -> dict[str, str]:
    reset_password(db, payload.token, payload.password)
    return {"status": "password_reset"}


@router.post("/password/change")
def change_password(
    payload: ChangePasswordRequest, db: DbDep, current_user: CurrentUser
) -> dict[str, str]:
    if not verify_password(payload.current_password, current_user.password_hash):
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED, detail="Current password is incorrect"
        )
    if payload.current_password == payload.new_password:
        raise HTTPException(status_code=400, detail="New password must be different")
    current_user.password_hash = hash_password(payload.new_password)
    db.add(
        AuditEvent(
            user_id=current_user.id,
            event_type="password_changed",
            entity_type="user",
            entity_id=current_user.id,
            payload={"source": "account_settings"},
        )
    )
    db.commit()
    return {"status": "password_changed"}


@router.get("/account/export")
def export_account(db: DbDep, current_user: CurrentUser) -> dict[str, object]:
    profile = current_user.profile
    household = (
        db.get(Household, profile.household_id) if profile and profile.household_id else None
    )
    household_members = []
    if household:
        rows = db.scalars(
            select(HouseholdMember).where(HouseholdMember.household_id == household.id)
        ).all()
        for member in rows:
            member_user = db.get(User, member.user_id)
            household_members.append(
                {
                    "user_id": member.user_id,
                    "email": member_user.email if member_user else None,
                    "role": member.role,
                    "joined_at": member.created_at.isoformat(),
                }
            )
    recipes = db.scalars(select(Recipe).where(Recipe.owner_user_id == current_user.id)).all()
    weekly_plans = db.scalars(select(WeeklyPlan).where(WeeklyPlan.user_id == current_user.id)).all()
    grocery_lists = db.scalars(
        select(GroceryList).where(GroceryList.user_id == current_user.id)
    ).all()
    candidates = db.scalars(
        select(UrlIngestionCandidate).where(UrlIngestionCandidate.user_id == current_user.id)
    ).all()
    audit_events = db.scalars(
        select(AuditEvent)
        .where(AuditEvent.user_id == current_user.id)
        .order_by(AuditEvent.created_at)
    ).all()
    return {
        "exported_at": datetime.now(UTC).isoformat(),
        "account": {
            "id": current_user.id,
            "email": current_user.email,
            "email_verified": current_user.email_verified,
            "created_at": current_user.created_at.isoformat(),
        },
        "profile": {
            "household_size": profile.household_size if profile else None,
            "weekly_meal_target": profile.weekly_meal_target if profile else None,
            "max_cook_minutes": profile.max_cook_minutes if profile else None,
            "difficulty_preference": profile.difficulty_preference if profile else None,
            "dietary_preferences": profile.dietary_preferences if profile else [],
            "allergens": profile.allergens if profile else [],
            "disliked_ingredients": profile.disliked_ingredients if profile else [],
            "favorite_proteins": profile.favorite_proteins if profile else [],
            "budget_preference": profile.budget_preference if profile else None,
            "walmart_zip": profile.walmart_zip if profile else None,
            "notification_preferences": profile.notification_preferences if profile else {},
        },
        "household": {
            "id": household.id,
            "name": household.name,
            "members": household_members,
        }
        if household
        else None,
        "recipes": [
            {
                "id": recipe.id,
                "name": recipe.name,
                "source_type": recipe.source_type,
                "source_url": recipe.source_url,
                "validation_status": recipe.validation_status,
                "created_at": recipe.created_at.isoformat(),
            }
            for recipe in recipes
        ],
        "weekly_plans": [
            {
                "id": plan.id,
                "week_start": plan.week_start.isoformat(),
                "meal_target": plan.meal_target,
                "slots": [
                    {
                        "slot_date": slot.slot_date.isoformat() if slot.slot_date else None,
                        "slot_type": slot.slot_type,
                        "recipe_id": slot.recipe_id,
                        "servings": slot.servings,
                        "is_locked": slot.is_locked,
                    }
                    for slot in db.scalars(
                        select(WeeklyPlanSlot).where(WeeklyPlanSlot.weekly_plan_id == plan.id)
                    ).all()
                ],
            }
            for plan in weekly_plans
        ],
        "grocery_lists": [
            {
                "id": grocery.id,
                "weekly_plan_id": grocery.weekly_plan_id,
                "items": [
                    {
                        "display_name": item.display_name,
                        "quantity": item.quantity,
                        "unit": item.unit,
                        "category": item.category,
                        "is_checked": item.is_checked,
                        "notes": item.notes,
                    }
                    for item in db.scalars(
                        select(GroceryListItem).where(GroceryListItem.grocery_list_id == grocery.id)
                    ).all()
                ],
            }
            for grocery in grocery_lists
        ],
        "url_ingestion_candidates": [
            {
                "id": candidate.id,
                "source_url": candidate.source_url,
                "status": candidate.status,
                "validation_warnings": candidate.validation_warnings,
                "approved_recipe_id": candidate.approved_recipe_id,
                "created_at": candidate.created_at.isoformat(),
            }
            for candidate in candidates
        ],
        "audit_events": [
            {
                "event_type": event.event_type,
                "entity_type": event.entity_type,
                "entity_id": event.entity_id,
                "payload": event.payload,
                "created_at": event.created_at.isoformat(),
            }
            for event in audit_events
        ],
    }


@router.post("/account/delete-request")
def request_account_deletion(
    payload: AccountDeletionRequest, db: DbDep, current_user: CurrentUser
) -> dict[str, str]:
    if not verify_password(payload.current_password, current_user.password_hash):
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED, detail="Current password is incorrect"
        )
    db.add(
        AuditEvent(
            user_id=current_user.id,
            event_type="account_deletion_requested",
            entity_type="user",
            entity_id=current_user.id,
            payload={"confirmation": payload.confirmation, "status": "pending_manual_review"},
        )
    )
    db.commit()
    return {"status": "deletion_requested"}
