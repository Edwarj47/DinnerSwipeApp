from __future__ import annotations

from datetime import date
from typing import Literal
from uuid import UUID

from pydantic import BaseModel, ConfigDict, Field, model_validator

from app.schemas.common import RecipeNutrition


class CalculatorItem(BaseModel):
    model_config = ConfigDict(extra="forbid")
    source: Literal["manual", "fatsecret"]
    name: str = Field(min_length=1, max_length=160)
    portions: float = Field(default=1, gt=0, le=100, allow_inf_nan=False)
    food_id: str | None = Field(default=None, pattern=r"^[0-9]{1,20}$")
    serving_id: str | None = Field(default=None, pattern=r"^[0-9]{1,20}$")
    nutrition: RecipeNutrition | None = None

    @model_validator(mode="after")
    def source_fields(self) -> CalculatorItem:
        self.name = self.name.strip()
        if not self.name:
            raise ValueError("Enter an ingredient name.")
        if self.source == "fatsecret":
            if not self.food_id or not self.serving_id or self.nutrition is not None:
                raise ValueError(
                    "Database items must contain only IDs, portions, and a user label."
                )
        elif self.food_id or self.serving_id or self.nutrition is None:
            raise ValueError("Manual items need nutrition values and no provider IDs.")
        return self


class CalculatorPreview(BaseModel):
    model_config = ConfigDict(extra="forbid")
    items: list[CalculatorItem] = Field(min_length=1, max_length=30)


class CalculatorSave(BaseModel):
    model_config = ConfigDict(extra="forbid")
    name: str = Field(min_length=2, max_length=160)
    meal_label: Literal["breakfast", "lunch", "dinner", "snack", "beverage"] = "dinner"
    meal_date: date
    servings: int = Field(default=1, ge=1, le=30)
    destination: Literal["entry", "recipe"]
    items: list[CalculatorItem] = Field(min_length=1, max_length=30)
    request_id: UUID

    @model_validator(mode="after")
    def clean_name(self) -> CalculatorSave:
        self.name = self.name.strip()
        if len(self.name) < 2:
            raise ValueError("Enter a meal or recipe name.")
        return self
