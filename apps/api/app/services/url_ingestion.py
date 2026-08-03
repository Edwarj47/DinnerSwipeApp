from __future__ import annotations

from typing import Any, cast

from fastapi import HTTPException
from sqlalchemy.orm import Session

from app.ingestion.ai_provider import get_ai_provider
from app.ingestion.extractors import (
    extract_json_ld_recipe,
    extract_metadata,
    extract_visible_recipe_hints,
)
from app.ingestion.url_fetcher import fetch_public_html
from app.models.entities import IngestionJob, UrlIngestionCandidate, User
from app.schemas.common import RecipeCreate
from app.services.recipes import create_recipe
from app.services.validation import validate_recipe_payload


async def ingest_url(db: Session, user: User, url: str) -> UrlIngestionCandidate:
    job = IngestionJob(
        user_id=user.id, job_type="url_ingestion", status="running", progress={"url": url}
    )
    db.add(job)
    db.flush()
    html, final_url = await fetch_public_html(url)
    structured = extract_json_ld_recipe(html)
    metadata = extract_metadata(html)
    visible = extract_visible_recipe_hints(html)
    candidate: dict[str, Any] = {
        **metadata,
        **visible,
        **structured,
        "source_url": final_url,
        "source_title": structured.get("source_title") or metadata.get("source_title"),
        "source_type": "url_structured_data" if structured else "url_html",
        "servings": structured.get("servings") or 4,
        "difficulty": "requires_review",
        "meal_type": structured.get("meal_type") or "dinner",
    }
    ai_result = await get_ai_provider().normalize(candidate)
    warnings = list(ai_result.get("warnings", []))
    if ai_result.get("enabled"):
        if ai_result.get("ingredients"):
            candidate["ingredients"] = ai_result["ingredients"]
        if ai_result.get("instructions"):
            candidate["instructions"] = ai_result["instructions"]
        candidate["tags"] = ai_result.get("tags", [])
    validation = validate_recipe_payload(candidate, accept_placeholder=False)
    warnings.extend(validation["warnings"])
    candidate_row = UrlIngestionCandidate(
        user_id=user.id,
        job_id=job.id,
        source_url=final_url,
        extracted_data=candidate,
        raw_snapshot={"structured": bool(structured), "metadata": metadata},
        confidence=ai_result.get("confidence", {}),
        validation_warnings=warnings + validation["errors"],
        status="requires_review",
    )
    db.add(candidate_row)
    job.status = "succeeded" if validation["can_approve"] else "partially_succeeded"
    job.progress = {"candidate_id": candidate_row.id, "ai_enabled": ai_result.get("enabled", False)}
    db.commit()
    db.refresh(candidate_row)
    return candidate_row


def approve_url_candidate(
    db: Session,
    user: User,
    candidate_id: str,
    accept_placeholder_photo: bool,
    edits: RecipeCreate | None,
) -> dict[str, Any]:
    candidate = db.get(UrlIngestionCandidate, candidate_id)
    if not candidate or candidate.user_id != user.id:
        raise HTTPException(status_code=404, detail="Candidate not found")
    payload = edits or RecipeCreate(
        **candidate.extracted_data,
        accept_placeholder_photo=accept_placeholder_photo,
    )
    recipe = create_recipe(db, payload, user)
    recipe.source_type = str(candidate.extracted_data.get("source_type", "url_html"))
    recipe.source_url = candidate.source_url
    recipe.source_title = cast(str | None, candidate.extracted_data.get("source_title"))
    recipe.ai_confidence = candidate.confidence
    candidate.status = "approved"
    candidate.approved_recipe_id = recipe.id
    db.commit()
    return {"recipe_id": recipe.id, "status": candidate.status}
