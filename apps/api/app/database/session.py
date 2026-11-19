from __future__ import annotations

from collections.abc import Generator

from sqlalchemy import create_engine, event, select
from sqlalchemy.orm import Session, sessionmaker

from app.core.config import settings

engine = create_engine(settings.database_url, pool_pre_ping=True)
SessionLocal = sessionmaker(bind=engine, autoflush=False, autocommit=False)


@event.listens_for(Session, "before_commit")
def reject_revoked_account_writes(db: Session) -> None:
    actor = db.info.get("authenticated_actor")
    if actor is None or db.info.get("account_erasure_write"):
        return
    from fastapi import HTTPException

    from app.models.entities import User

    row = db.execute(
        select(User.is_active, User.session_version).where(User.id == actor[0]).with_for_update()
    ).one_or_none()
    if row is None or not row.is_active or row.session_version != actor[1]:
        raise HTTPException(401, "Account access was revoked. Sign in again before saving.")


def get_db() -> Generator[Session, None, None]:
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()
