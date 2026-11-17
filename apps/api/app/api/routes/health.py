from __future__ import annotations

from pathlib import Path

from alembic.script import ScriptDirectory
from alembic.util.exc import CommandError
from fastapi import APIRouter
from fastapi.responses import JSONResponse
from sqlalchemy import text
from sqlalchemy.exc import SQLAlchemyError

from app.api.deps import DbDep

router = APIRouter(tags=["health"])


@router.get("/health")
def health() -> dict[str, str]:
    return {"status": "ok", "service": "dinner-swipe-api"}


@router.get("/health/ready")
def readiness(db: DbDep) -> JSONResponse:
    try:
        revision = db.execute(text("SELECT version_num FROM alembic_version")).scalar_one()
        ready = (
            revision
            == ScriptDirectory(
                str(Path(__file__).resolve().parents[3] / "alembic")
            ).get_current_head()
        )
    except (SQLAlchemyError, OSError, CommandError):
        ready = False
    return JSONResponse(
        {"status": "ready" if ready else "not_ready"},
        status_code=200 if ready else 503,
        headers={"Cache-Control": "no-store"},
    )
