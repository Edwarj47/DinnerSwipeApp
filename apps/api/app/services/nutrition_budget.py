from __future__ import annotations

from collections.abc import Callable
from datetime import UTC, datetime, timedelta

from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.core.config import Settings
from app.models.nutrition import NutritionCall, NutritionProviderState


def utcnow() -> datetime:
    return datetime.now(UTC).replace(tzinfo=None)


class NutritionError(Exception):
    def __init__(self, code: str, retry_seconds: int = 60) -> None:
        super().__init__(code)
        self.code = code
        self.retry_seconds = retry_seconds


class NutritionBudget:
    def __init__(self, sessions: Callable[[], Session], settings: Settings) -> None:
        self.sessions = sessions
        self.settings = settings

    def reserve(self, kind: str, background: bool = False) -> str:
        with self.sessions() as db:
            state = db.scalar(
                select(NutritionProviderState)
                .where(NutritionProviderState.provider == "fatsecret")
                .with_for_update()
            )
            if state is None:
                raise NutritionError("schema_not_ready")
            now = utcnow()
            if state.blocked_until and state.blocked_until > now:
                raise NutritionError(
                    "provider_paused", max(1, int((state.blocked_until - now).total_seconds()))
                )
            start = now - timedelta(hours=24)
            calls = (
                select(func.count())
                .select_from(NutritionCall)
                .where(NutritionCall.reserved_at >= start)
            )
            rolling = db.scalar(calls) or 0
            today = (
                db.scalar(
                    calls.where(
                        NutritionCall.reserved_at
                        >= now.replace(hour=0, minute=0, second=0, microsecond=0)
                    )
                )
                or 0
            )
            background_calls = db.scalar(calls.where(NutritionCall.background == 1)) or 0
            if max(rolling, today) >= self.settings.fatsecret_daily_budget:
                raise NutritionError("daily_budget_exhausted", 3600)
            if background and background_calls >= min(
                self.settings.fatsecret_background_budget, self.settings.fatsecret_daily_budget
            ):
                raise NutritionError("background_budget_exhausted", 3600)
            if state.next_request_at and state.next_request_at > now:
                raise NutritionError(
                    "paced", max(1, int((state.next_request_at - now).total_seconds()) + 1)
                )
            state.next_request_at = now + timedelta(
                seconds=self.settings.fatsecret_min_interval_seconds
            )
            call = NutritionCall(reserved_at=now, background=int(background), kind=kind)
            db.add(call)
            db.commit()
            return call.id

    def finish(self, call_id: str, outcome: str) -> None:
        with self.sessions() as db:
            call = db.get(NutritionCall, call_id)
            if call:
                call.outcome = outcome
                db.commit()

    def pause(self, reason: str, seconds: int) -> None:
        with self.sessions() as db:
            state = db.scalar(
                select(NutritionProviderState)
                .where(NutritionProviderState.provider == "fatsecret")
                .with_for_update()
            )
            if state:
                until = utcnow() + timedelta(seconds=seconds)
                state.blocked_until = max(state.blocked_until or until, until)
                state.block_reason = reason
                db.commit()

    def status(self) -> dict[str, object]:
        with self.sessions() as db:
            now = utcnow()
            query = (
                select(func.count())
                .select_from(NutritionCall)
                .where(NutritionCall.reserved_at >= now - timedelta(hours=24))
            )
            rolling = db.scalar(query) or 0
            state = db.get(NutritionProviderState, "fatsecret")
            return {
                "configured": self.settings.fatsecret_configured,
                "budget": self.settings.fatsecret_daily_budget,
                "rolling_24h_calls": rolling,
                "background_24h_calls": db.scalar(query.where(NutritionCall.background == 1)) or 0,
                "remaining": max(0, self.settings.fatsecret_daily_budget - rolling),
                "blocked_until": state.blocked_until.isoformat()
                if state and state.blocked_until
                else None,
                "block_reason": state.block_reason if state else None,
                "discovery_enabled": False,
            }
