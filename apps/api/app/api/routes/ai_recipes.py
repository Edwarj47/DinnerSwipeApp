from __future__ import annotations

from typing import Annotated, Any

from fastapi import APIRouter, File, Form, HTTPException, UploadFile
from sqlalchemy import select

from app.api.deps import BasicUser, DbDep
from app.core.config import settings
from app.models.entities import IngestionJob
from app.schemas.common import RecipeCreate
from app.services import ai_recipes as service
from app.services.recipes import create_recipe
from app.services.validation import validate_recipe_payload

router = APIRouter(prefix="/ai-recipes", tags=["ai-recipes"])


def serialize(job: IngestionJob) -> dict[str, Any]:
    return {
        "id": job.id,
        "status": job.status,
        "created_at": job.created_at,
        "draft": job.progress.get("draft"),
        "recipe_id": job.progress.get("recipe_id"),
    }


@router.get("/usage")
def usage(db: DbDep, current_user: BasicUser) -> dict[str, Any]:
    return service.usage(db, current_user)


@router.get("")
def drafts(db: DbDep, current_user: BasicUser) -> list[dict[str, Any]]:
    return [
        serialize(job)
        for job in db.scalars(
            select(IngestionJob)
            .where(
                IngestionJob.user_id == current_user.id,
                IngestionJob.job_type == service.JOB_TYPE,
                IngestionJob.status == "succeeded",
            )
            .order_by(IngestionJob.created_at.desc())
            .limit(30)
        ).all()
    ]


@router.post("")
async def generate(
    db: DbDep,
    current_user: BasicUser,
    request_id: Annotated[str, Form(min_length=16, max_length=120)],
    description: Annotated[str, Form(max_length=6000)] = "",
    image: Annotated[UploadFile | None, File()] = None,
) -> dict[str, Any]:
    if not settings.ai_recipe_enabled or not settings.openai_api_key:
        raise HTTPException(503, "AI recipes are not available right now. No use was charged.")
    data = None
    mime = image.content_type if image else None
    if image:
        data = await image.read(5 * 1024 * 1024 + 1)
        if len(data) > 5 * 1024 * 1024:
            raise HTTPException(413, "Choose an image smaller than 5 MB.")
        valid = (
            (mime == "image/jpeg" and data.startswith(b"\xff\xd8\xff"))
            or (mime == "image/png" and data.startswith(b"\x89PNG\r\n\x1a\n"))
            or (mime == "image/webp" and data.startswith(b"RIFF") and data[8:12] == b"WEBP")
        )
        if not valid:
            raise HTTPException(400, "Choose a JPEG, PNG or WebP photo.")
    if not description.strip() and not data:
        raise HTTPException(422, "Add a recipe description or photo first.")
    job, created = service.reserve(db, current_user, str(request_id))
    if not created:
        if job.status == "running":
            raise HTTPException(409, "Your recipe is still being prepared.")
        if job.status == "failed":
            raise HTTPException(422, "This attempt did not produce a recipe. Please start again.")
        return serialize(job)
    try:
        draft = await service.generate(description.strip(), data, mime)
    except Exception:
        job.status = "failed"
        job.error_message = "No recipe generated. No use was charged."
        db.commit()
        raise HTTPException(
            502,
            "We couldn't read a recipe. Try a clearer photo or more detail. No use was charged.",
        ) from None
    job.status = "succeeded"
    job.progress = job.progress | {
        "draft": draft.model_dump(),
        "model": draft._model_used or settings.ai_recipe_model,
    }
    db.commit()
    return serialize(job)


def owned_job(db: DbDep, user_id: str, job_id: str) -> IngestionJob:
    job = db.scalar(
        select(IngestionJob)
        .where(
            IngestionJob.id == job_id,
            IngestionJob.user_id == user_id,
            IngestionJob.job_type == service.JOB_TYPE,
        )
        .with_for_update()
    )
    if not job:
        raise HTTPException(404, "Draft not found.")
    return job


@router.post("/{job_id}/discard")
def discard(job_id: str, db: DbDep, current_user: BasicUser) -> dict[str, str]:
    job = owned_job(db, current_user.id, job_id)
    if job.status not in {"succeeded", "discarded"}:
        raise HTTPException(409, "This draft is not available to discard.")
    job.status = "discarded"
    job.progress = {key: value for key, value in job.progress.items() if key != "draft"}
    db.commit()
    return {"status": "discarded"}


@router.post("/{job_id}/approve")
def approve(
    job_id: str, payload: RecipeCreate, db: DbDep, current_user: BasicUser
) -> dict[str, Any]:
    job = owned_job(db, current_user.id, job_id)
    if job.status == "saved":
        return serialize(job)
    if job.status != "succeeded":
        raise HTTPException(409, "This draft is no longer available.")
    payload.source_type = "ai_assisted"
    payload.source_url = None
    payload.source_title = None
    if not validate_recipe_payload(
        payload.model_dump(), payload.accept_placeholder_photo, allow_incomplete=True
    )["can_approve"]:
        raise HTTPException(422, "Check the recipe name and photo.")
    recipe = create_recipe(db, payload, current_user, commit=False)
    job.status = "saved"
    job.progress = {key: value for key, value in job.progress.items() if key != "draft"} | {
        "recipe_id": recipe.id
    }
    db.commit()
    return serialize(job)
