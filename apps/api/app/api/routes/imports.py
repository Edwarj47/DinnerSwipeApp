from __future__ import annotations

from fastapi import APIRouter, Response, UploadFile

from app.api.deps import CurrentUser, DbDep
from app.schemas.common import ImportMappingRequest
from app.services.imports import (
    confirm_batch,
    error_report_csv,
    preview_batch,
    save_upload,
    validate_batch,
)

router = APIRouter(prefix="/imports", tags=["imports"])


@router.post("/upload")
async def upload(file: UploadFile, db: DbDep, current_user: CurrentUser) -> dict[str, object]:
    return await save_upload(db, current_user, file)


@router.post("/{batch_id}/mapping")
def map_columns(
    batch_id: str, payload: ImportMappingRequest, db: DbDep, current_user: CurrentUser
) -> dict[str, object]:
    return validate_batch(db, current_user, batch_id, payload)


@router.get("/{batch_id}/preview")
def preview(batch_id: str, db: DbDep, current_user: CurrentUser) -> dict[str, object]:
    return preview_batch(db, current_user, batch_id)


@router.post("/{batch_id}/confirm")
def confirm(batch_id: str, db: DbDep, current_user: CurrentUser) -> dict[str, object]:
    return confirm_batch(db, current_user, batch_id)


@router.get("/{batch_id}/errors.csv")
def errors_csv(batch_id: str, db: DbDep, current_user: CurrentUser) -> Response:
    return Response(
        content=error_report_csv(db, current_user, batch_id),
        media_type="text/csv",
        headers={"Content-Disposition": 'attachment; filename="dinner-swipe-import-errors.csv"'},
    )
