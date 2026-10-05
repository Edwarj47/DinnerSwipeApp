from __future__ import annotations

from datetime import UTC, date, datetime, time, timedelta
from typing import Any
from zoneinfo import ZoneInfo

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.models.entities import MealMacroConfirmation, User, UserProfile, WeeklyPlan, WeeklyPlanSlot

SETTINGS_KEY = "weekly_planning"
CURSOR_KEY = "weekly_planning_cursor"


def now_utc() -> datetime:
    return datetime.now(UTC)


def planning_settings(user: User) -> dict[str, Any]:
    preferences = (user.profile.notification_preferences or {}) if user.profile else {}
    stored = preferences.get(SETTINGS_KEY, {})
    if not isinstance(stored, dict):
        stored = {}
    return {
        "mode": stored.get("mode", "manual"),
        "reset_day": stored.get("reset_day", 0),
        "notify": stored.get("notify", True),
        "time_zone": stored.get("time_zone", "UTC"),
        "time_zone_configured": "time_zone" in stored,
    }


def local_today(user: User, now: datetime | None = None) -> date:
    return (now or now_utc()).astimezone(ZoneInfo(planning_settings(user)["time_zone"])).date()


def week_start_for(user: User, now: datetime | None = None) -> date:
    today = local_today(user, now)
    return today - timedelta(days=today.weekday())


def week_bounds(user: User, week: date) -> tuple[datetime, datetime]:
    zone = ZoneInfo(planning_settings(user)["time_zone"])
    # Convert both local midnights separately: DST weeks are not always 168 hours.
    start = datetime.combine(week, time.min, zone).astimezone(UTC).replace(tzinfo=None)
    end = (
        datetime.combine(week + timedelta(days=7), time.min, zone)
        .astimezone(UTC)
        .replace(tzinfo=None)
    )
    return start, end


def latest_cycle(user: User, now: datetime | None = None) -> date:
    today = local_today(user, now)
    return today - timedelta(days=(today.weekday() - planning_settings(user)["reset_day"]) % 7)


def reset_plan_slots(
    db: Session, user: User, plan: WeeklyPlan, slot_date: date | None = None
) -> None:
    from app.services.recipes import retire_slot_choices

    slots = list(
        db.scalars(
            select(WeeklyPlanSlot)
            .where(WeeklyPlanSlot.weekly_plan_id == plan.id)
            .order_by(WeeklyPlanSlot.sort_order, WeeklyPlanSlot.id)
        )
    )
    selected = [slot for slot in slots if slot_date is None or slot.slot_date == slot_date]
    ids = [slot.id for slot in selected]
    retire_slot_choices(db, user.id, ids)
    if ids:
        db.query(MealMacroConfirmation).filter(
            MealMacroConfirmation.weekly_plan_slot_id.in_(ids),
            MealMacroConfirmation.user_id == user.id,
        ).update({MealMacroConfirmation.weekly_plan_slot_id: None}, synchronize_session=False)
    for slot in selected:
        slot.recipe_id = None
        slot.slot_type = "flexible"
        slot.servings = user.profile.household_size
        slot.is_locked = False
        if slot_date is None:
            slot.slot_date = None
    if slot_date is None:
        target = user.profile.weekly_meal_target
        plan.meal_target = target
        for slot in slots[target:]:
            db.delete(slot)
        for index, slot in enumerate(slots[:target]):
            slot.sort_order = index
        for index in range(len(slots), target):
            db.add(
                WeeklyPlanSlot(
                    weekly_plan_id=plan.id,
                    slot_type="flexible",
                    servings=user.profile.household_size,
                    sort_order=index,
                )
            )
    db.flush()


def reconcile_current_plan(db: Session, user: User, *, lock: bool = False) -> WeeklyPlan:
    from app.services.recipes import accessible_recipes_query, regenerate_grocery_list

    # Every planner mutation and settings change locks the account first.
    db.execute(select(User.id).where(User.id == user.id).with_for_update()).one()
    profile = db.scalar(
        select(UserProfile)
        .where(UserProfile.user_id == user.id)
        .with_for_update()
        .execution_options(populate_existing=True)
    )
    if profile is None:
        profile = UserProfile(user_id=user.id)
        db.add(profile)
        db.flush()
    user.profile = profile
    instant = now_utc()
    week = week_start_for(user, instant)
    preferences = dict(user.profile.notification_preferences or {})
    automatic = planning_settings(user)["mode"] == "automatic"
    cycle = latest_cycle(user, instant).isoformat()
    cursor = preferences.get(CURSOR_KEY)
    # Missing cursors never imply permission to erase a plan.
    due = automatic and isinstance(cursor, str) and cursor < cycle
    changed = automatic and not isinstance(cursor, str)
    if changed:
        preferences[CURSOR_KEY] = cycle
    plan = db.scalar(
        select(WeeklyPlan).where(WeeklyPlan.user_id == user.id, WeeklyPlan.week_start == week)
    )
    if plan is None:
        previous = db.scalar(
            select(WeeklyPlan)
            .where(WeeklyPlan.user_id == user.id, WeeklyPlan.week_start < week)
            .order_by(WeeklyPlan.week_start.desc())
            .limit(1)
        )
        plan = WeeklyPlan(
            user_id=user.id, week_start=week, meal_target=user.profile.weekly_meal_target
        )
        db.add(plan)
        db.flush()
        if previous is not None and not due:
            allowed = {recipe.id for recipe in db.scalars(accessible_recipes_query(user)).unique()}
            old_slots = db.scalars(
                select(WeeklyPlanSlot)
                .where(WeeklyPlanSlot.weekly_plan_id == previous.id)
                .order_by(WeeklyPlanSlot.sort_order, WeeklyPlanSlot.id)
            ).all()
            for old in old_slots:
                recipe_id = old.recipe_id if old.recipe_id in allowed else None
                db.add(
                    WeeklyPlanSlot(
                        weekly_plan_id=plan.id,
                        slot_date=week + (old.slot_date - previous.week_start)
                        if old.slot_date
                        else None,
                        slot_type=old.slot_type if not old.recipe_id or recipe_id else "flexible",
                        recipe_id=recipe_id,
                        servings=old.servings,
                        is_locked=old.is_locked if not old.recipe_id or recipe_id else False,
                        sort_order=old.sort_order,
                    )
                )
        else:
            reset_plan_slots(db, user, plan)
        db.flush()
        changed = True
    if due:
        reset_plan_slots(db, user, plan)
        preferences[CURSOR_KEY] = cycle
        changed = True
    if changed:
        user.profile.notification_preferences = preferences
        regenerate_grocery_list(db, user, plan, preserve_edits=True, commit=False)
        db.commit()
        db.refresh(plan)
        if lock:
            db.execute(select(User.id).where(User.id == user.id).with_for_update()).one()
    return plan


def update_planning_settings(db: Session, user: User, values: dict[str, Any]) -> None:
    db.execute(select(User.id).where(User.id == user.id).with_for_update()).one()
    db.scalar(
        select(UserProfile)
        .where(UserProfile.user_id == user.id)
        .with_for_update()
        .execution_options(populate_existing=True)
    )
    old = planning_settings(user)
    initialize_only = values.pop("initialize_only", False)
    if initialize_only and old["time_zone_configured"]:
        return
    preferences = dict(user.profile.notification_preferences or {})
    preferences[SETTINGS_KEY] = values
    user.profile.notification_preferences = preferences
    if any(old[key] != values[key] for key in ("mode", "reset_day", "time_zone")):
        # Start with the NEXT occurrence, even when saved on reset day.
        preferences[CURSOR_KEY] = latest_cycle(user).isoformat()
        user.profile.notification_preferences = dict(preferences)
    db.commit()
