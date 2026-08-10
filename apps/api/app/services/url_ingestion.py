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
    warnings = _user_facing_warnings(list(ai_result.get("warnings", [])))
    if ai_result.get("enabled"):
        if ai_result.get("ingredients"):
            candidate["ingredients"] = ai_result["ingredients"]
        if ai_result.get("instructions"):
            candidate["instructions"] = ai_result["instructions"]
        candidate["tags"] = ai_result.get("tags", [])
    validation = validate_recipe_payload(candidate, accept_placeholder=False)
    warnings.extend(_user_facing_warnings(validation["warnings"]))
    candidate_row = UrlIngestionCandidate(
        user_id=user.id,
        job_id=job.id,
        source_url=final_url,
        extracted_data=candidate,
        raw_snapshot={"structured": bool(structured), "metadata": metadata},
        confidence=ai_result.get("confidence", {}),
        validation_warnings=warnings + _user_facing_warnings(validation["errors"]),
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


def reject_url_candidate(db: Session, user: User, candidate_id: str) -> dict[str, str]:
    candidate = db.get(UrlIngestionCandidate, candidate_id)
    if not candidate or candidate.user_id != user.id:
        raise HTTPException(status_code=404, detail="Candidate not found")
    candidate.status = "rejected"
    db.commit()
    return {"status": candidate.status}


def _user_facing_warnings(messages: list[str]) -> list[str]:
    cleaned: list[str] = []
    seen: set[str] = set()
    for raw in messages:
        message = _user_facing_warning(raw)
        if not message or message in seen:
            continue
        seen.add(message)
        cleaned.append(message)
    return cleaned


def _user_facing_warning(raw: str) -> str:
    value = raw.strip()
    lower = value.lower()
    if not value:
        return ""
    if "timer_minutes" in lower or "single integer" in lower:
        return ""
    if "ai ingestion is disabled" in lower or "openai_api_key" in lower:
        return "Automatic cleanup is not configured yet. Review the recipe before approving."
    if "ai normalization failed" in lower:
        return "Automatic cleanup had trouble with this page. Review the recipe before approving."
    if "ai normalization returned invalid" in lower:
        return (
            "Automatic cleanup returned an unexpected format. "
            "Review the recipe before approving."
        )
    if lower == "missing photo":
        return "Add a photo link or approve a placeholder."
    if lower == "unsupported photo url":
        return "Use a secure image link or leave the photo blank for a placeholder."
    if lower == "blocked photo url":
        return "That photo link is blocked. Use another image or approve a placeholder."
    if lower == "empty ingredients":
        return "Add at least one ingredient."
    if lower == "empty instructions":
        return "Add at least one instruction step."
    if lower == "missing name":
        return "Add a recipe name."
    if lower == "missing servings":
        return "Serving size was not found. You can still approve after reviewing."
    if lower == "missing timing information":
        return ""
    return value.replace("_", " ")
