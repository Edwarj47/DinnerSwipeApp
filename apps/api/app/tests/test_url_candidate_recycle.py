from __future__ import annotations

from datetime import timedelta

from fastapi.testclient import TestClient
from sqlalchemy.orm import Session

from app.models.entities import UrlIngestionCandidate, User
from app.services.url_ingestion import utcnow_naive


def test_url_candidate_rejects_to_recycle_bin_and_restores(
    client: TestClient, auth_headers: dict[str, str], db_session: Session
) -> None:
    user = db_session.query(User).filter_by(email="owner@example.com").one()
    candidate = UrlIngestionCandidate(
        user_id=user.id,
        source_url="https://example.com/recipe",
        status="requires_review",
        extracted_data={"name": "Test Recipe"},
        validation_warnings=[],
    )
    db_session.add(candidate)
    db_session.commit()

    rejected = client.post(f"/api/v1/url-ingestion/{candidate.id}/reject", headers=auth_headers)

    assert rejected.status_code == 200
    assert rejected.json()["status"] == "recycled"
    assert rejected.json()["restore_until"]

    active = client.get("/api/v1/url-ingestion", headers=auth_headers)
    assert active.status_code == 200
    assert all(item["id"] != candidate.id for item in active.json())

    recycled = client.get("/api/v1/url-ingestion?recycled=true", headers=auth_headers)
    assert recycled.status_code == 200
    assert recycled.json()[0]["id"] == candidate.id
    assert recycled.json()[0]["restore_until"]

    restored = client.post(f"/api/v1/url-ingestion/{candidate.id}/restore", headers=auth_headers)

    assert restored.status_code == 200
    assert restored.json()["status"] == "requires_review"
    active_after_restore = client.get("/api/v1/url-ingestion", headers=auth_headers)
    assert any(item["id"] == candidate.id for item in active_after_restore.json())


def test_expired_recycled_url_candidate_cannot_restore(
    client: TestClient, auth_headers: dict[str, str], db_session: Session
) -> None:
    user = db_session.query(User).filter_by(email="owner@example.com").one()
    candidate = UrlIngestionCandidate(
        user_id=user.id,
        source_url="https://example.com/old-recipe",
        status="recycled",
        rejected_at=utcnow_naive() - timedelta(days=16),
        extracted_data={"name": "Old Recipe"},
        validation_warnings=[],
    )
    db_session.add(candidate)
    db_session.commit()

    recycled = client.get("/api/v1/url-ingestion?recycled=true", headers=auth_headers)
    assert recycled.status_code == 200
    assert all(item["id"] != candidate.id for item in recycled.json())

    restored = client.post(f"/api/v1/url-ingestion/{candidate.id}/restore", headers=auth_headers)

    assert restored.status_code == 410
    assert restored.json()["detail"] == "Draft restore window has expired"
