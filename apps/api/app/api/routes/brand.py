from __future__ import annotations

from pathlib import Path

from fastapi import APIRouter
from fastapi.responses import FileResponse

router = APIRouter(prefix="/brand", tags=["brand"])

STATIC_DIR = Path(__file__).resolve().parents[2] / "static"


@router.get("/logo.png", response_class=FileResponse)
def logo() -> FileResponse:
    return FileResponse(
        STATIC_DIR / "dinner-swipe-logo.png",
        media_type="image/png",
        headers={"Cache-Control": "public, max-age=86400"},
    )
