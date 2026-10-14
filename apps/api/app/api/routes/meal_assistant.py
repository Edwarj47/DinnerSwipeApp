from __future__ import annotations

from typing import Annotated, Any
from uuid import UUID

from fastapi import APIRouter, File, Form, HTTPException, Response, UploadFile
from pydantic import BaseModel, ConfigDict, Field

from app.api.deps import BasicUser, DbDep
from app.core.config import settings
from app.core.rate_limit import auth_rate_limiter
from app.services import meal_assistant, meal_voice
from app.services.billing import require_premium

router = APIRouter(prefix="/nutrition/ai", tags=["nutrition"])


class DescribeMeal(BaseModel):
    model_config = ConfigDict(extra="forbid", str_strip_whitespace=True)
    description: str = Field(min_length=3, max_length=4000)
    request_id: UUID


@router.get("/status")
def status(db: DbDep, user: BasicUser, response: Response) -> dict[str, bool]:
    require_premium(db, user)
    response.headers["Cache-Control"] = "no-store"
    enabled = bool(
        settings.nutrition_ai_enabled and settings.openai_api_key and settings.fatsecret_configured
    )
    return {"enabled": enabled, "voice_enabled": enabled and meal_voice.voice_available()}


@router.post("/drafts")
async def describe(
    db: DbDep, user: BasicUser, payload: DescribeMeal, response: Response
) -> dict[str, Any]:
    meal_assistant.require_assistant(db, user)
    response.headers["Cache-Control"] = "no-store"
    return await meal_assistant.prepare(
        db, user, str(payload.request_id), payload.description.strip()
    )


@router.get("/drafts/{request_id}")
def get_draft(db: DbDep, user: BasicUser, request_id: UUID, response: Response) -> dict[str, Any]:
    meal_assistant.require_assistant(db, user)
    response.headers["Cache-Control"] = "no-store"
    auth_rate_limiter.check(f"nutrition:lookup:{user.id}", 20, 60)
    return meal_assistant.draft_view(db, meal_assistant.owned_job(db, user, str(request_id)))


@router.delete("/drafts/{request_id}")
def discard_draft(
    db: DbDep, user: BasicUser, request_id: UUID, response: Response
) -> dict[str, bool]:
    require_premium(db, user)
    job = meal_assistant.owned_job(db, user, str(request_id))
    job.status = "discarded"
    job.progress = {}
    db.commit()
    response.headers["Cache-Control"] = "no-store"
    return {"discarded": True}


@router.post("/transcriptions")
async def transcription(
    db: DbDep,
    user: BasicUser,
    response: Response,
    request_id: Annotated[UUID, Form()],
    audio: Annotated[UploadFile, File()],
) -> dict[str, Any]:
    meal_assistant.require_assistant(db, user)
    response.headers["Cache-Control"] = "no-store"
    auth_rate_limiter.check(f"nutrition:audio:{user.id}", 3, 60)
    try:
        content = await audio.read(meal_voice.MAX_AUDIO_BYTES + 1)
        if len(content) > meal_voice.MAX_AUDIO_BYTES:
            raise HTTPException(413, "Record up to 60 seconds and 6 MB.")
        return await meal_voice.transcribe(
            db, user, str(request_id), content, audio.content_type or ""
        )
    finally:
        await audio.close()
