"""Offline, originally authored workout suggestions; no provider or database access.

The catalog stores shared form cues once, not a generated permutation of workouts.
Each returned payload is a complete legacy TemplateInput. The worker owns selection,
quality-skip/exhaustion logging, persistent deduplication and Commons asset resolution.
Use provenance.catalog_id for authored identity: guidance URLs are not recipe URLs,
and removing their fragments deliberately leaves shared general-guidance pages.
"""

from __future__ import annotations

import math
import re
import unicodedata
from datetime import date
from pathlib import Path
from typing import Annotated, Any, Literal
from urllib.parse import urlsplit

from pydantic import BaseModel, ConfigDict, Field, model_validator

from app.schemas.workouts import Category, TemplateInput

CATALOG_PATH = Path(__file__).resolve().parents[1] / "data" / "workout_candidates.json"
SHARED_GUIDANCE = ("cdc_activity", "cdc_intensity", "nhs_warmup", "nhs_cooldown")
Label = Annotated[str, Field(min_length=1, max_length=160)]
Preparation = Annotated[str, Field(min_length=60, max_length=500)]


def _identity(value: str) -> str:
    return " ".join(re.findall(r"[^\W_]+", unicodedata.normalize("NFKC", value).casefold()))


class _Input(BaseModel):
    model_config = ConfigDict(extra="forbid", strict=True, str_strip_whitespace=True)


class _Guidance(_Input):
    url: str = Field(max_length=2048)
    title: str = Field(min_length=1)
    scope: str = Field(min_length=20)

    @model_validator(mode="after")
    def primary_guidance_page(self) -> _Guidance:
        parts = urlsplit(self.url)
        if (
            parts.scheme != "https"
            or parts.netloc not in {"www.cdc.gov", "www.nhs.uk"}
            or not parts.path.strip("/")
            or parts.query
            or parts.fragment
        ):
            raise ValueError("Guidance must use a primary CDC/NHS HTTPS page")
        return self


class _Photo(_Input):
    page_url: str
    license: Literal["Public domain", "CC0"]
    license_template: str = Field(pattern=r"^(?:PD-[A-Za-z0-9_-]+|Cc-zero)$")
    creator: str = Field(min_length=1)
    source: str = Field(min_length=1)
    license_evidence: str = Field(min_length=30)
    depicts: str = Field(min_length=10)
    warnings: list[Annotated[str, Field(min_length=1)]] = Field(default_factory=list)

    @model_validator(mode="after")
    def commons_photo_page(self) -> _Photo:
        parts = urlsplit(self.page_url)
        if (
            parts.scheme != "https"
            or parts.netloc != "commons.wikimedia.org"
            or not parts.path.startswith("/wiki/File:")
            or not parts.path.lower().endswith((".jpg", ".jpeg", ".png"))
            or parts.query
            or parts.fragment
        ):
            raise ValueError("Photos require individual Commons JPEG/PNG file pages")
        if (self.license == "CC0") != (self.license_template == "Cc-zero"):
            raise ValueError("Photo license and individual-file template must agree")
        return self


class _Movement(_Input):
    name: Label
    cue: str = Field(min_length=20, max_length=400)
    equipment: list[Label] = Field(max_length=12)

    @model_validator(mode="after")
    def meaningful_labels(self) -> _Movement:
        equipment = [_identity(item) for item in self.equipment]
        if not _identity(self.name) or not all(equipment) or len(set(equipment)) != len(equipment):
            raise ValueError("Movement and equipment labels must be meaningful and unique")
        return self


class _Step(_Input):
    movement: str
    sets: int = Field(ge=1, le=6)
    reps: str | None = Field(default=None, pattern=r"^\d+(?:-\d+)?(?: each side)?$")
    duration_seconds: int | None = Field(default=None, ge=10, le=1800)
    rest_seconds: int = Field(ge=0, le=180)

    @model_validator(mode="after")
    def complete_prescription(self) -> _Step:
        if (self.reps is None) == (self.duration_seconds is None):
            raise ValueError("Use either repetitions or duration, with explicit sets")
        if self.reps is not None:
            numbers = [int(n) for n in re.findall(r"\d+", self.reps)]
            if not 1 <= numbers[0] <= numbers[-1] <= 20:
                raise ValueError("Repetitions must be an ascending range within 1-20")
        if self.sets > 1 and self.rest_seconds == 0:
            raise ValueError("Repeated sets require recovery time")
        return self


class _Routine(_Input):
    catalog_id: str = Field(max_length=160, pattern=r"^ds-workout-v1-[a-z0-9]+(?:-[a-z0-9]+)*$")
    title: str = Field(min_length=5, max_length=160)
    category: Category
    setting: Literal["home", "gym"]
    difficulty: Literal["beginner", "intermediate"]
    purpose: str = Field(min_length=30, max_length=400)
    guidance: str
    photo: str
    warmup: str
    cooldown: str
    exercises: list[_Step] = Field(min_length=1, max_length=8)


class _Catalog(_Input):
    version: Literal[1]
    authored_by: str = Field(min_length=1)
    reviewed_on: str = Field(pattern=r"^\d{4}-\d{2}-\d{2}$")
    editorial_note: str = Field(min_length=30)
    safety: str = Field(min_length=80)
    guidance: dict[str, _Guidance]
    photos: dict[str, _Photo]
    warmups: dict[str, Preparation]
    cooldowns: dict[str, Preparation]
    movements: dict[str, _Movement]
    routines: list[_Routine] = Field(min_length=5)

    @model_validator(mode="after")
    def references_and_distinctness(self) -> _Catalog:
        date.fromisoformat(self.reviewed_on)
        missing = set(SHARED_GUIDANCE) - self.guidance.keys()
        if missing:
            raise ValueError(f"Missing shared guidance: {', '.join(sorted(missing))}")
        movement_names = [_identity(movement.name) for movement in self.movements.values()]
        if len(movement_names) != len(set(movement_names)):
            raise ValueError("Duplicate movement names cannot disguise workout variants")
        ids: set[str] = set()
        titles: set[str] = set()
        combinations: set[frozenset[str]] = set()
        for routine in self.routines:
            title = _identity(routine.title)
            if not title or routine.catalog_id in ids or title in titles:
                raise ValueError(f"Duplicate workout identity: {routine.catalog_id}")
            ids.add(routine.catalog_id)
            titles.add(title)
            for key, values in (
                (routine.guidance, self.guidance),
                (routine.photo, self.photos),
                (routine.warmup, self.warmups),
                (routine.cooldown, self.cooldowns),
            ):
                if key not in values:
                    raise ValueError(f"Unknown reference {key!r}: {routine.catalog_id}")
            names = []
            for step in routine.exercises:
                if step.movement not in self.movements:
                    raise ValueError(f"Unknown movement {step.movement!r}: {routine.catalog_id}")
                names.append(_identity(self.movements[step.movement].name))
            signature = frozenset(names)
            if len(signature) != len(names) or signature in combinations:
                raise ValueError(f"Repeated exercise combination: {routine.catalog_id}")
            combinations.add(signature)
        return self


def _estimated_minutes(routine: _Routine) -> int:
    # Budget 4 s/rep (both sides when specified), inter-set rests, and transitions.
    seconds = 0
    for step in routine.exercises:
        if step.duration_seconds is not None:
            work = step.duration_seconds
        else:
            reps = step.reps or "1"
            work = max(int(n) for n in re.findall(r"\d+", reps)) * 4
            if "each side" in reps:
                work *= 2
        seconds += step.sets * work + (step.sets - 1) * step.rest_seconds
    seconds += sum(step.rest_seconds for step in routine.exercises[:-1])
    seconds += 15 * (len(routine.exercises) - 1)
    return 6 + 5 + math.ceil(seconds / 60)


def _record(catalog: _Catalog, routine: _Routine) -> dict[str, Any]:
    equipment = sorted(
        {item for step in routine.exercises for item in catalog.movements[step.movement].equipment}
    )
    lines = [
        routine.purpose,
        f"Equipment: {', '.join(equipment) if equipment else 'None; clear floor space'}.",
        f"Difficulty: {routine.difficulty.capitalize()}. Setting: {routine.setting}.",
        f"Estimated duration: about {_estimated_minutes(routine)} minutes, including preparation.",
        f"Warm-up: 6 minutes. {catalog.warmups[routine.warmup]}",
        "Main work: finish an exercise's sets before moving on. "
        "Use the listed rest between sets and before the next exercise; "
        "take longer if needed. For timed work, duration is per set. "
        "For repetitions marked each side, complete that many on both sides before resting.",
        (
            "Effort: stay conversational; lower the pace or resistance if talking becomes hard."
            if routine.category == "cardio"
            else "Effort: use controlled repetitions, ending each set before technique slips. "
            "If new to a movement, start with one set at the low end of the range."
        ),
    ]
    exercises = []
    for number, step in enumerate(routine.exercises, 1):
        movement = catalog.movements[step.movement]
        dose = (
            f"{step.sets} x {step.duration_seconds} seconds"
            if step.duration_seconds is not None
            else f"{step.sets} x {step.reps} reps"
        )
        lines.append(
            f"{number}. {movement.name}: {dose}. {movement.cue} "
            f"Rest: {step.rest_seconds} seconds; easy movement is fine during recovery."
        )
        exercises.append(
            {
                "name": movement.name,
                "sets": step.sets,
                "reps": step.reps,
                "duration_seconds": step.duration_seconds,
            }
        )
    lines.extend(
        [
            f"Cooldown: 5 minutes. {catalog.cooldowns[routine.cooldown]}",
            f"Safety: {catalog.safety}",
            "Original general-fitness suggestion; not a CDC/NHS published routine, "
            "clinical program or personalized prescription.",
        ]
    )
    payload = TemplateInput.model_validate(
        {
            "title": routine.title,
            "category": routine.category,
            "description": "\n".join(lines),
            "exercises": exercises,
        }
    )
    if len(payload.description or "") < 80:
        raise ValueError(f"Incomplete workout description: {routine.catalog_id}")
    photo = catalog.photos[routine.photo]
    guidance_keys = dict.fromkeys([routine.guidance, *SHARED_GUIDANCE])
    return {
        "kind": "workout",
        "payload": payload.model_dump(mode="json"),
        "source_url": f"{catalog.guidance[routine.guidance].url}#{routine.catalog_id}",
        "source_name": f"{catalog.authored_by} (informed by CDC/NHS general guidance)",
        "photo_page_url": photo.page_url,
        "provenance": {
            "catalog_id": routine.catalog_id,
            "catalog_version": catalog.version,
            "authorship": "original_authored_suggestion",
            "editorial_note": catalog.editorial_note,
            "guidance_reviewed_on": catalog.reviewed_on,
            "guidance": [catalog.guidance[key].model_dump() for key in guidance_keys],
            "setting": routine.setting,
            "difficulty": routine.difficulty,
            "equipment": equipment,
            "estimated_duration_minutes": _estimated_minutes(routine),
            "duration_estimate_basis": "Listed sets, upper rep range at 4 seconds per rep "
            "(both sides where stated), prescribed recoveries, 15-second exercise transitions, "
            "6-minute warm-up and 5-minute cooldown; extra setup or rest adds time.",
            "warmup": {"duration_seconds": 360, "instructions": catalog.warmups[routine.warmup]},
            "cooldown": {
                "duration_seconds": 300,
                "instructions": catalog.cooldowns[routine.cooldown],
            },
            "prescription": [
                {
                    **step.model_dump(exclude={"movement"}),
                    "name": catalog.movements[step.movement].name,
                    "cue": catalog.movements[step.movement].cue,
                }
                for step in routine.exercises
            ],
            "image": {
                **photo.model_dump(exclude={"warnings"}),
                "license_proof_url": f"{photo.page_url}#Licensing",
                "rights_reviewed_on": catalog.reviewed_on,
                "runtime_verification_required": True,
            },
        },
        "warnings": [
            "Originally authored general suggestion, not a publisher workout or medical advice.",
            "Photo illustrates a movement or setting, not every exercise or correct technique.",
            "Recheck the individual Commons file license and actual photo before publication.",
            *photo.warnings,
        ],
    }


def workout_candidates() -> list[dict[str, Any]]:
    """Return fresh, validated records in editorial order without network or DB I/O.

    This is a finite pool, not a promise to produce 175 different workouts. Callers
    should skip already-seen catalog IDs, log quality skips, and report exhaustion
    rather than regenerating renamed routines. No candidate is published here.
    """
    catalog = _Catalog.model_validate_json(CATALOG_PATH.read_text(encoding="utf-8"))
    return [_record(catalog, routine) for routine in catalog.routines]
