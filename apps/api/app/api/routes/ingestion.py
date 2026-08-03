from __future__ import annotations

from fastapi import APIRouter
from sqlalchemy import select

from app.api.deps import CurrentUser, DbDep
from app.models.entities import UrlIngestionCandidate
from app.schemas.common import UrlApprovalRequest, UrlIngestRequest
from app.services.url_ingestion import approve_url_candidate, ingest_url

router = APIRouter(prefix="/url-ingestion", tags=["url-ingestion"])


@router.post("")
async def submit_urls(
    payload: UrlIngestRequest, db: DbDep, current_user: CurrentUser
) -> dict[str, object]:
    candidates = []
    for url in payload.urls:
        candidate = await ingest_url(db, current_user, str(url))
        candidates.append(
            {"id": candidate.id, "status": candidate.status, "source_url": candidate.source_url}
        )
    return {"candidates": candidates}


@router.get("/{candidate_id}")
def get_candidate(candidate_id: str, db: DbDep, current_user: CurrentUser) -> dict[str, object]:
    candidate = db.get(UrlIngestionCandidate, candidate_id)
    if not candidate or candidate.user_id != current_user.id:
        return {"status": "not_found"}
    return {
        "id": candidate.id,
        "source_url": candidate.source_url,
        "status": candidate.status,
        "extracted_data": candidate.extracted_data,
        "raw_snapshot": candidate.raw_snapshot,
        "confidence": candidate.confidence,
        "validation_warnings": candidate.validation_warnings,
        "approved_recipe_id": candidate.approved_recipe_id,
    }


@router.get("")
def list_candidates(db: DbDep, current_user: CurrentUser) -> list[dict[str, object]]:
    rows = db.scalars(
        select(UrlIngestionCandidate)
        .where(UrlIngestionCandidate.user_id == current_user.id)
        .order_by(UrlIngestionCandidate.created_at.desc())
    ).all()
    return [
        {
            "id": row.id,
            "source_url": row.source_url,
            "status": row.status,
            "created_at": row.created_at,
        }
        for row in rows
    ]


@router.post("/{candidate_id}/approve")
def approve(
    candidate_id: str, payload: UrlApprovalRequest, db: DbDep, current_user: CurrentUser
) -> dict[str, object]:
    return approve_url_candidate(
        db, current_user, candidate_id, payload.accept_placeholder_photo, payload.edits
    )
