from __future__ import annotations

from datetime import date
from typing import Any, Literal
from uuid import UUID

from pydantic import BaseModel, ConfigDict, Field, HttpUrl, field_validator, model_validator

from app.schemas.common import IngredientIn, InstructionIn, RecipeCreate, RecipeNutrition
from app.schemas.photo_credit import PhotoCredit
from app.schemas.workouts import ExerciseInput, TemplateInput

Kind = Literal["recipe", "workout"]
CandidateStatus = Literal["pending", "approved", "dismissed"]


class StrictInput(BaseModel):
    model_config = ConfigDict(extra="forbid", str_strip_whitespace=True)


class PublishedNutrition(RecipeNutrition):
    model_config = ConfigDict(extra="forbid")

    calories: float = Field(gt=0, le=20000, allow_inf_nan=False, strict=True)
    protein_g: float = Field(ge=0, le=1000, allow_inf_nan=False, strict=True)
    carbs_g: float = Field(ge=0, le=2000, allow_inf_nan=False, strict=True)
    fat_g: float = Field(ge=0, le=1000, allow_inf_nan=False, strict=True)
    fiber_g: float = Field(ge=0, le=500, allow_inf_nan=False, strict=True)


class CandidateIngredient(IngredientIn):
    model_config = ConfigDict(extra="forbid", str_strip_whitespace=True)

    original_text: str = Field(min_length=1, max_length=4000)
    quantity: float | None = Field(default=None, ge=0, allow_inf_nan=False, strict=True)


class CandidateInstruction(InstructionIn):
    model_config = ConfigDict(extra="forbid", str_strip_whitespace=True)

    step_number: int = Field(ge=1, le=100, strict=True)
    text: str = Field(min_length=1, max_length=8000)
    timer_minutes: int | None = Field(default=None, ge=0, le=1440, strict=True)


class RecipeCandidateInput(RecipeCreate):
    model_config = ConfigDict(extra="forbid", str_strip_whitespace=True)

    servings: int = Field(ge=1, le=30, strict=True)
    prep_minutes: int = Field(ge=0, le=1440, strict=True)
    cook_minutes: int = Field(ge=0, le=1440, strict=True)
    # The inherited aggregate_minutes validator replaces this with prep + cook.
    total_minutes: int = Field(default=0, ge=0, le=1440, strict=True)
    photo_url: str = Field(min_length=1, max_length=2048)
    nutrition: PublishedNutrition
    ingredients: list[IngredientIn] = Field(min_length=1, max_length=100)
    instructions: list[InstructionIn] = Field(min_length=1, max_length=100)
    accept_placeholder_photo: Literal[False] = False
    calculator_source_id: None = None

    @field_validator("ingredients", mode="before")
    @classmethod
    def strict_ingredients(cls, values: Any) -> list[CandidateIngredient]:
        if not isinstance(values, list):
            raise ValueError("Ingredients must be a list.")
        return [CandidateIngredient.model_validate(value) for value in values]

    @field_validator("instructions", mode="before")
    @classmethod
    def strict_instructions(cls, values: Any) -> list[CandidateInstruction]:
        if not isinstance(values, list):
            raise ValueError("Instructions must be a list.")
        return [CandidateInstruction.model_validate(value) for value in values]

    @model_validator(mode="after")
    def complete_steps(self) -> RecipeCandidateInput:
        if [step.step_number for step in self.instructions] != list(
            range(1, len(self.instructions) + 1)
        ):
            raise ValueError("Recipe steps must be ordered and numbered consecutively.")
        return self


class WorkoutCandidateInput(TemplateInput):
    photo_url: HttpUrl = Field(max_length=2048)
    description: str = Field(min_length=80, max_length=4000)
    exercises: list[ExerciseInput] = Field(min_length=1, max_length=50)

    @model_validator(mode="after")
    def prescribed_exercises(self) -> WorkoutCandidateInput:
        for exercise in self.exercises:
            if exercise.duration_seconds is None and (exercise.sets is None or not exercise.reps):
                raise ValueError("Each exercise requires sets and reps, or a duration.")
        return self


class DecisionsInput(StrictInput):
    action: Literal["approve", "dismiss"]
    candidate_ids: list[UUID] = Field(min_length=1, max_length=10)

    @model_validator(mode="after")
    def unique_ids(self) -> DecisionsInput:
        if len(set(self.candidate_ids)) != len(self.candidate_ids):
            raise ValueError("Candidate IDs must be unique.")
        return self


class CampaignPatch(StrictInput):
    paused: bool = Field(strict=True)


class Candidate(StrictInput):
    id: UUID
    kind: Kind
    status: CandidateStatus
    title: str
    payload: dict[str, Any]
    photo_url: str | None
    photo_credit: PhotoCredit | None = None
    source_url: str
    source_name: str
    warnings: list[str]


class BatchReport(StrictInput):
    reasons: list[str]


class BatchSummary(StrictInput):
    id: UUID
    scheduled_date: date
    status: Literal["running", "complete", "partial", "skipped"]
    recipe_count: int
    workout_count: int
    pending_count: int
    approved_count: int
    dismissed_count: int
    report: BatchReport


class BatchDetail(BatchSummary):
    recipes: list[Candidate]
    workouts: list[Candidate]


class CampaignSummary(StrictInput):
    id: UUID
    status: Literal["active", "paused", "completed"]
    time_zone: str
    start_date: date
    end_date: date
    days_total: int
    completed_days: int
    pending_count: int


class AutomationOverview(StrictInput):
    campaign: CampaignSummary | None
    batches: list[BatchSummary]


class DiscoveredSource(StrictInput):
    id: str = Field(pattern=r"^[a-f0-9]{64}$")
    kind: Kind
    title: str = Field(min_length=3, max_length=240)
    source_url: str = Field(min_length=1, max_length=2048)
    source_name: str = Field(min_length=1, max_length=240)
    status: Literal["pending", "dismissed"]


class DiscoveryRun(StrictInput):
    id: UUID
    scheduled_date: date
    status: Literal["running", "complete", "partial"]
    sources: list[DiscoveredSource]
    reasons: list[str]


class SourcesOverview(StrictInput):
    runs: list[DiscoveryRun]


class DismissSourcesInput(StrictInput):
    source_ids: list[str] = Field(min_length=1, max_length=10)

    @field_validator("source_ids")
    @classmethod
    def distinct_source_ids(cls, values: list[str]) -> list[str]:
        import re

        if len(set(values)) != len(values) or any(
            re.fullmatch(r"[a-f0-9]{64}", value) is None for value in values
        ):
            raise ValueError("Choose distinct source identifiers.")
        return values
