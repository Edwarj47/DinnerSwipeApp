"""Synthetic concurrency checks; only run against the disposable content_test database."""

from __future__ import annotations

import sys
from concurrent.futures import ThreadPoolExecutor
from datetime import UTC, date, datetime
from pathlib import Path
from uuid import uuid4

sys.path.insert(0, str(Path(__file__).resolve().parents[2] / "apps/api"))

from fastapi import HTTPException
from sqlalchemy import func, select

from app.database.session import SessionLocal
from app.models.content_automation import ContentCandidate
from app.models.entities import Recipe, User
from app.models.security import MediaObject
from app.services import content_automation as service
from app.services.private_media import object_url


def main() -> None:
    with SessionLocal() as db:
        assert db.get_bind().url.database == "content_test", "Disposable database required"
        user = User(
            email=f"content-race-{uuid4().hex}@example.com",
            password_hash=uuid4().hex,
            is_active=True,
            email_verified=True,
        )
        db.add(user)
        db.flush()
        media = MediaObject(
            owner_user_id=user.id,
            storage_key=f"uploads/{user.id}/{uuid4()}.jpg",
            backend="local",
            content_type="image/jpeg",
            size_bytes=100,
        )
        db.add(media)
        db.flush()
        campaign = service.create_campaign(db, user.id, date(2026, 10, 17))
        now = datetime(2026, 10, 17, 10, tzinfo=UTC)
        batch = service.begin_batch(db, campaign.id, date(2026, 10, 17), now)
        assert batch and batch.lease_token
        owner, batch_id, token, photo = user.id, batch.id, batch.lease_token, object_url(media.id)
        db.commit()

    def stage(number: int) -> bool:
        source = f"https://fixture.example/recipe/{number}"
        payload = {
            "name": f"Synthetic recipe {number}",
            "servings": 2,
            "prep_minutes": 5,
            "cook_minutes": 10,
            "total_minutes": 15,
            "photo_url": photo,
            "meal_type": "dinner",
            "source_url": source,
            "ingredients": [
                {
                    "original_text": f"{number} cups beans",
                    "normalized_name": "beans",
                    "quantity": float(number),
                    "unit": "cup",
                }
            ],
            "instructions": [{"step_number": 1, "text": f"Combine {number} cups and cook."}],
            "nutrition": {
                "calories": 200,
                "protein_g": 10,
                "carbs_g": 25,
                "fat_g": 6,
                "fiber_g": 4,
            },
        }
        provenance = {
            "nutrition": {"source_url": source, "basis": "serving"},
            "image": {
                "source_url": "https://fixture.example/photo",
                "license": "Public domain",
                "license_url": "https://creativecommons.org/publicdomain/mark/1.0/",
                "creator": "Fixture",
                "credit": "Synthetic fixture",
                "permission_verified": True,
            },
        }
        with SessionLocal() as db:
            try:
                service.stage_candidate(
                    db,
                    batch_id,
                    "recipe",
                    payload,
                    source,
                    "Fixture",
                    provenance,
                    lease_token=token,
                    now=now,
                )
                db.commit()
                return True
            except HTTPException as exc:
                db.rollback()
                assert exc.status_code == 409
                return False

    with ThreadPoolExecutor(max_workers=6) as pool:
        assert sum(pool.map(stage, range(1, 7))) == 5
    with SessionLocal() as db:
        ids = list(
            db.scalars(select(ContentCandidate.id).where(ContentCandidate.batch_id == batch_id))
        )
        assert len(ids) == 5

    def approve(_: int) -> None:
        with SessionLocal() as db:
            user = db.get(User, owner)
            assert user
            service.decide(db, user, batch_id, "approve", [ids[0]])
            db.commit()

    with ThreadPoolExecutor(max_workers=2) as pool:
        list(pool.map(approve, range(2)))
    with SessionLocal() as db:
        assert (
            db.scalar(select(func.count()).select_from(Recipe).where(Recipe.owner_user_id == owner))
            == 1
        )
    print(
        "PostgreSQL: six simultaneous stage requests capped at five; "
        "duplicate approvals created one recipe."
    )


if __name__ == "__main__":
    main()
