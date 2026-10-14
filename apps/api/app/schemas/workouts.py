from __future__ import annotations

from datetime import date
from typing import Annotated, Literal
from uuid import UUID
from zoneinfo import ZoneInfo, ZoneInfoNotFoundError

from pydantic import BaseModel, ConfigDict, Field, HttpUrl, field_validator, model_validator

Category = Literal["upper", "lower", "cardio", "full_body"]
Name = Annotated[str, Field(min_length=1, max_length=160)]


class WorkoutInput(BaseModel):
    model_config = ConfigDict(extra="forbid", str_strip_whitespace=True)


class ExerciseInput(WorkoutInput):
    name: Name
    sets: int | None = Field(default=None, strict=True, ge=1, le=100)
    reps: str | None = Field(default=None, min_length=1, max_length=80)
    duration_seconds: int | None = Field(default=None, strict=True, ge=1, le=86400)


class TemplateInput(WorkoutInput):
    title: Name
    category: Category = "full_body"
    photo_url: HttpUrl | None = Field(default=None, max_length=2048)
    description: str | None = Field(default=None, max_length=4000)
    exercises: list[ExerciseInput] = Field(default_factory=list, max_length=50)


class TemplateShareInput(WorkoutInput):
    template_ids: list[UUID] = Field(min_length=1, max_length=100)
    household_id: UUID


class DiscoverChoicesInput(WorkoutInput):
    household_id: UUID
    enable_ids: list[UUID] = Field(default_factory=list, max_length=100)
    disable_ids: list[UUID] = Field(default_factory=list, max_length=100)


class SlotCreateInput(WorkoutInput):
    household_id: UUID | None = None
    template_id: UUID
    slot_date: date | None = None


class PlanningSettingsInput(WorkoutInput):
    mode: Literal["manual", "automatic"]
    reset_day: int = Field(strict=True, ge=0, le=6)
    notify: bool = Field(strict=True)
    time_zone: str = Field(min_length=1, max_length=80)
    initialize_only: bool = False

    @field_validator("time_zone")
    @classmethod
    def valid_zone(cls, value: str) -> str:
        try:
            ZoneInfo(value)
        except (ZoneInfoNotFoundError, ValueError) as exc:
            raise ValueError("Choose a valid IANA time zone.") from exc
        return value


class PlanResetInput(WorkoutInput):
    slot_date: date | None = None


class SlotUpdateInput(WorkoutInput):
    slot_date: date | None = None
    sort_order: int | None = Field(default=None, strict=True, ge=0, le=10000)

    @model_validator(mode="after")
    def valid_patch(self) -> SlotUpdateInput:
        if not self.model_fields_set:
            raise ValueError("Supply a date or sort order.")
        if "sort_order" in self.model_fields_set and self.sort_order is None:
            raise ValueError("Sort order cannot be null.")
        return self


class ReorderInput(WorkoutInput):
    household_id: UUID | None = None
    slot_ids: list[UUID] = Field(max_length=100)


class ProposalInput(WorkoutInput):
    household_id: UUID
    template_id: UUID


class ProposalDecisionInput(WorkoutInput):
    action: Literal["approve", "reject"]
    slot_date: date | None = None


class PerformanceSetInput(WorkoutInput):
    exercise_index: int = Field(strict=True, ge=0, le=49)
    set_number: int = Field(strict=True, ge=1, le=100)
    reps: int | None = Field(default=None, strict=True, ge=0, le=10000)
    weight_kg: float | None = Field(default=None, strict=True, ge=0, le=2000, allow_inf_nan=False)
    duration_seconds: int | None = Field(default=None, strict=True, ge=1, le=86400)

    @model_validator(mode="after")
    def valid_metrics(self) -> PerformanceSetInput:
        if self.reps is None and self.duration_seconds is None:
            raise ValueError("Record repetitions or duration for each set.")
        if self.weight_kg is not None and self.reps is None:
            raise ValueError("Weighted sets require repetitions.")
        return self


class ExerciseDetailsInput(WorkoutInput):
    exercise_index: int = Field(strict=True, ge=0, le=49)
    completed: bool = Field(strict=True)
    notes: str = Field(default="", max_length=1000)


class LogInput(WorkoutInput):
    template_id: UUID
    performed_on: date
    completed: bool = Field(strict=True)
    notes: str | None = Field(default=None, max_length=4000)
    sets: list[PerformanceSetInput] = Field(default_factory=list, max_length=200)
    exercise_details: list[ExerciseDetailsInput] = Field(default_factory=list, max_length=50)
    expected_revision: str | None = Field(default=None, pattern=r"^[a-f0-9]{64}$")
    plan_slot_id: UUID | None = None
    household_id: UUID | None = None

    @model_validator(mode="after")
    def unique_sets(self) -> LogInput:
        keys = [(item.exercise_index, item.set_number) for item in self.sets]
        if len(keys) != len(set(keys)):
            raise ValueError("Exercise and set numbers must be unique.")
        indices = [item.exercise_index for item in self.exercise_details]
        if len(indices) != len(set(indices)):
            raise ValueError("Exercise details must be unique.")
        return self
