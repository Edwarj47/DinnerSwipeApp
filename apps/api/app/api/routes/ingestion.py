from __future__ import annotations

from datetime import timedelta

from fastapi import APIRouter, Query
from sqlalchemy import or_, select

from app.api.deps import BasicUser, DbDep
from app.models.entities import UrlIngestionCandidate
from app.schemas.common import UrlApprovalRequest, UrlIngestRequest
from app.services.url_ingestion import (
    RECYCLED_CANDIDATE_STATUSES,
    URL_CANDIDATE_RECYCLE_DAYS,
    approve_url_candidate,
    candidate_can_restore,
    ingest_url,
    recycle_restore_until,
    reject_url_candidate,
    restore_url_candidate,
    utcnow_naive,
)

router = APIRouter(prefix="/url-ingestion", tags=["url-ingestion"])


@router.post("")
async def submit_urls(
    payload: UrlIngestRequest, db: DbDep, current_user: BasicUser
) -> dict[str, object]:
    candidates = []
    for url in payload.urls:
        candidate = await ingest_url(db, current_user, str(url))
        candidates.append(
            {"id": candidate.id, "status": candidate.status, "source_url": candidate.source_url}
        )
    return {"candidates": candidates}


@router.get("/{candidate_id}")
def get_candidate(candidate_id: str, db: DbDep, current_user: BasicUser) -> dict[str, object]:
    candidate = db.get(UrlIngestionCandidate, candidate_id)
    if not candidate or candidate.user_id != current_user.id:
        return {"status": "not_found"}
    return serialize_candidate(candidate)


@router.get("")
def list_candidates(
    db: DbDep, current_user: BasicUser, recycled: bool = Query(default=False)
) -> list[dict[str, object]]:
    query = select(UrlIngestionCandidate).where(UrlIngestionCandidate.user_id == current_user.id)
    if recycled:
        cutoff = utcnow_naive() - timedelta(days=URL_CANDIDATE_RECYCLE_DAYS)
        query = query.where(
            UrlIngestionCandidate.status.in_(RECYCLED_CANDIDATE_STATUSES),
            or_(
                UrlIngestionCandidate.rejected_at.is_(None),
                UrlIngestionCandidate.rejected_at >= cutoff,
            ),
        )
    else:
        query = query.where(UrlIngestionCandidate.status.notin_(RECYCLED_CANDIDATE_STATUSES))
    rows = db.scalars(query.order_by(UrlIngestionCandidate.created_at.desc())).all()
    return [serialize_candidate(row, summary=True) for row in rows]


def serialize_candidate(
    candidate: UrlIngestionCandidate, summary: bool = False
) -> dict[str, object]:
    payload: dict[str, object] = {
        "id": candidate.id,
        "source_url": candidate.source_url,
        "status": candidate.status,
        "recipe_name": candidate.extracted_data.get("name"),
        "warnings": candidate.validation_warnings,
        "created_at": candidate.created_at,
        "rejected_at": candidate.rejected_at,
        "restore_until": recycle_restore_until(candidate)
        if candidate.status in RECYCLED_CANDIDATE_STATUSES and candidate_can_restore(candidate)
        else None,
    }
    if summary:
        return payload
    return payload | {
        "extracted_data": candidate.extracted_data,
        "raw_snapshot": candidate.raw_snapshot,
        "confidence": candidate.confidence,
        "validation_warnings": candidate.validation_warnings,
        "approved_recipe_id": candidate.approved_recipe_id,
    }


@router.post("/{candidate_id}/approve")
def approve(
    candidate_id: str, payload: UrlApprovalRequest, db: DbDep, current_user: BasicUser
) -> dict[str, object]:
    return approve_url_candidate(
        db, current_user, candidate_id, payload.accept_placeholder_photo, payload.edits
    )


@router.post("/{candidate_id}/reject")
def reject(candidate_id: str, db: DbDep, current_user: BasicUser) -> dict[str, str]:
    return reject_url_candidate(db, current_user, candidate_id)


@router.post("/{candidate_id}/restore")
def restore(candidate_id: str, db: DbDep, current_user: BasicUser) -> dict[str, str]:
    return restore_url_candidate(db, current_user, candidate_id)
