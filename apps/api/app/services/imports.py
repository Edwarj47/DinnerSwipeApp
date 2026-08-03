from __future__ import annotations

import csv
import io
import json
import tempfile
from pathlib import Path
from typing import Any

import pandas as pd
from fastapi import HTTPException, UploadFile
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.core.config import settings
from app.models.entities import (
    ImportBatch,
    ImportFile,
    ImportMappingTemplate,
    ImportRow,
    ImportRowError,
    Recipe,
    User,
)
from app.schemas.common import ImportMappingRequest, RecipeCreate
from app.services.parsing import parse_ingredients, parse_instructions, recipe_hash
from app.services.recipes import create_recipe
from app.services.validation import validate_recipe_payload

CANONICAL_FIELDS = [
    "name",
    "ingredients",
    "instructions",
    "photo",
    "description",
    "servings",
    "prep_minutes",
    "cook_minutes",
    "total_minutes",
    "difficulty",
    "tags",
    "cuisine",
    "meal_type",
    "source_url",
    "source_name",
]
REQUIRED_FIELDS = {"name", "ingredients", "instructions", "photo"}
HEADER_ALIASES = {
    "recipe": "name",
    "title": "name",
    "ingredient list": "ingredients",
    "directions": "instructions",
    "steps": "instructions",
    "image": "photo",
    "image url": "photo",
    "url": "source_url",
    "source": "source_name",
}


def sanitize_export_cell(value: object) -> str:
    text = "" if value is None else str(value)
    return "'" + text if text.startswith(("=", "+", "-", "@")) else text


async def save_upload(db: Session, user: User, file: UploadFile) -> dict[str, Any]:
    suffix = Path(file.filename or "").suffix.lower()
    if suffix not in {".csv", ".xlsx"}:
        raise HTTPException(status_code=400, detail="Unsupported extension")
    content = await file.read(settings.max_upload_size_bytes + 1)
    if len(content) > settings.max_upload_size_bytes:
        raise HTTPException(status_code=413, detail="File too large")
    if suffix == ".xlsx" and not content.startswith(b"PK"):
        raise HTTPException(status_code=400, detail="Invalid XLSX file")
    with tempfile.NamedTemporaryFile(delete=False, suffix=suffix, prefix="dinner-swipe-") as tmp:
        tmp.write(content)
        path = tmp.name
    rows, headers = read_rows(Path(path), suffix)
    batch = ImportBatch(
        user_id=user.id, status="file_scanned", source_type=suffix.removeprefix(".")
    )
    db.add(batch)
    db.flush()
    db.add(
        ImportFile(
            import_batch_id=batch.id,
            original_filename=file.filename or "upload",
            content_type=file.content_type or "application/octet-stream",
            size_bytes=len(content),
            stored_path=path,
            headers=headers,
        )
    )
    for index, row in enumerate(rows[: settings.max_import_rows], start=2):
        db.add(ImportRow(import_batch_id=batch.id, row_number=index, raw_data=row))
    batch.summary = {"total": min(len(rows), settings.max_import_rows), "headers": headers}
    db.commit()
    return {
        "batch_id": batch.id,
        "headers": headers,
        "rows": rows[:5],
        "suggested_mapping": suggest_mapping(headers),
    }


def read_rows(path: Path, suffix: str) -> tuple[list[dict[str, Any]], list[str]]:
    try:
        if suffix == ".csv":
            frame = pd.read_csv(path, dtype=str, keep_default_na=False)
        else:
            workbook = pd.ExcelFile(path, engine="openpyxl")
            if len(workbook.sheet_names) > 1:
                raise HTTPException(
                    status_code=400, detail="Multiple worksheets require splitting for MVP"
                )
            frame = pd.read_excel(path, dtype=str, keep_default_na=False, engine="openpyxl")
    except HTTPException:
        raise
    except Exception as exc:
        raise HTTPException(status_code=400, detail="Unreadable spreadsheet") from exc
    if len(frame) > settings.max_import_rows:
        frame = frame.head(settings.max_import_rows)
    headers = [str(column).strip() for column in frame.columns]
    for header in headers:
        if len(header) > settings.max_cell_length:
            raise HTTPException(status_code=400, detail="Oversized cell")
    rows = frame.fillna("").to_dict(orient="records")
    for row in rows:
        for value in row.values():
            if len(str(value)) > settings.max_cell_length:
                raise HTTPException(status_code=400, detail="Oversized cell")
    return rows, headers


def suggest_mapping(headers: list[str]) -> dict[str, str | None]:
    mapping: dict[str, str | None] = {field: None for field in CANONICAL_FIELDS}
    for header in headers:
        normalized = header.strip().lower().replace("_", " ")
        canonical = normalized.replace(" ", "_")
        if canonical in CANONICAL_FIELDS:
            mapping[canonical] = header
        elif normalized in HEADER_ALIASES:
            mapping[HEADER_ALIASES[normalized]] = header
    return mapping


def normalize_row(
    row: ImportRow, mapping: dict[str, str | None], accept_missing_photo: bool
) -> dict[str, Any]:
    raw = row.raw_data
    data: dict[str, Any] = {}
    for field in CANONICAL_FIELDS:
        source = mapping.get(field)
        data[field] = raw.get(source, "") if source else ""
    data["ingredients"] = parse_ingredients(data.get("ingredients"))
    data["instructions"] = parse_instructions(data.get("instructions"))
    data["photo_url"] = data.pop("photo") or None
    data["source_title"] = data.pop("source_name") or None
    tags_value = data.get("tags") or ""
    data["tags"] = [
        tag.strip() for tag in str(tags_value).replace(";", ",").split(",") if tag.strip()
    ]
    for number_field in ["servings", "prep_minutes", "cook_minutes", "total_minutes"]:
        try:
            data[number_field] = int(float(data[number_field])) if data.get(number_field) else None
        except ValueError:
            data[number_field] = None
    data["servings"] = data["servings"] or 4
    data["difficulty"] = data.get("difficulty") or "easy"
    data["meal_type"] = data.get("meal_type") or "dinner"
    data["source_type"] = "csv"
    validation = validate_recipe_payload(data, accept_missing_photo)
    data["_validation"] = validation
    data["_content_hash"] = recipe_hash(
        data.get("name", ""), data["ingredients"], data["instructions"]
    )
    return data


def validate_batch(
    db: Session, user: User, batch_id: str, request: ImportMappingRequest
) -> dict[str, Any]:
    missing = [field for field in REQUIRED_FIELDS if not request.mapping.get(field)]
    if missing and not (missing == ["photo"] and request.accept_missing_photo):
        raise HTTPException(
            status_code=400, detail=f"Missing required mappings: {', '.join(missing)}"
        )
    batch = db.get(ImportBatch, batch_id)
    if not batch or batch.user_id != user.id:
        raise HTTPException(status_code=404, detail="Import batch not found")
    if request.save_template_name:
        db.add(
            ImportMappingTemplate(
                user_id=user.id, name=request.save_template_name, mapping=request.mapping
            )
        )
    rows = db.scalars(
        select(ImportRow)
        .where(ImportRow.import_batch_id == batch_id)
        .order_by(ImportRow.row_number)
    ).all()
    seen_hashes: set[str] = set()
    counts = {"total": len(rows), "valid": 0, "invalid": 0, "duplicate": 0, "warning": 0}
    for row in rows:
        db.query(ImportRowError).filter(ImportRowError.import_row_id == row.id).delete()
        normalized = normalize_row(row, request.mapping, request.accept_missing_photo)
        duplicate = db.scalar(
            select(Recipe).where(Recipe.content_hash == normalized["_content_hash"])
        )
        if normalized["_content_hash"] in seen_hashes:
            row.duplicate_status = "likely_duplicate"
        elif duplicate:
            row.duplicate_status = "exact_duplicate"
        else:
            row.duplicate_status = "new"
        seen_hashes.add(normalized["_content_hash"])
        errors = normalized["_validation"]["errors"]
        warnings = normalized["_validation"]["warnings"]
        if row.duplicate_status != "new":
            warnings.append(row.duplicate_status.replace("_", " ").title())
            counts["duplicate"] += 1
        row.normalized_data = {k: v for k, v in normalized.items() if not k.startswith("_")}
        row.warnings = warnings
        row.status = "valid" if not errors else "invalid"
        counts["valid" if not errors else "invalid"] += 1
        if warnings:
            counts["warning"] += 1
        for message in errors:
            db.add(
                ImportRowError(import_row_id=row.id, field="row", message=message, severity="error")
            )
    batch.status = "preview_generated"
    batch.summary = dict(counts)
    db.commit()
    return counts


def preview_batch(db: Session, user: User, batch_id: str) -> dict[str, Any]:
    batch = db.get(ImportBatch, batch_id)
    if not batch or batch.user_id != user.id:
        raise HTTPException(status_code=404, detail="Import batch not found")
    rows = db.scalars(
        select(ImportRow)
        .where(ImportRow.import_batch_id == batch_id)
        .order_by(ImportRow.row_number)
    ).all()
    return {
        "batch_id": batch.id,
        "status": batch.status,
        "summary": batch.summary,
        "rows": [
            {
                "id": row.id,
                "row_number": row.row_number,
                "status": row.status,
                "duplicate_status": row.duplicate_status,
                "warnings": row.warnings,
                "normalized_data": row.normalized_data,
            }
            for row in rows[:50]
        ],
    }


def confirm_batch(db: Session, user: User, batch_id: str) -> dict[str, Any]:
    batch = db.get(ImportBatch, batch_id)
    if not batch or batch.user_id != user.id:
        raise HTTPException(status_code=404, detail="Import batch not found")
    rows = db.scalars(
        select(ImportRow).where(ImportRow.import_batch_id == batch_id, ImportRow.status == "valid")
    ).all()
    committed = 0
    for row in rows:
        if row.committed_recipe_id or not row.normalized_data:
            continue
        payload = RecipeCreate(
            **row.normalized_data,
            accept_placeholder_photo=not bool(row.normalized_data.get("photo_url")),
        )
        recipe = create_recipe(db, payload, user)
        recipe.source_type = batch.source_type
        recipe.import_batch_id = batch.id
        recipe.original_imported_row = row.raw_data
        row.committed_recipe_id = recipe.id
        row.status = "committed"
        committed += 1
    batch.status = "import_summary_generated"
    batch.summary = dict(batch.summary or {}) | {"committed": committed}
    db.commit()
    return {"committed": committed, "summary": batch.summary}


def error_report_csv(db: Session, user: User, batch_id: str) -> str:
    batch = db.get(ImportBatch, batch_id)
    if not batch or batch.user_id != user.id:
        raise HTTPException(status_code=404, detail="Import batch not found")
    rows = db.scalars(
        select(ImportRow)
        .where(ImportRow.import_batch_id == batch_id)
        .order_by(ImportRow.row_number)
    ).all()
    output = io.StringIO()
    writer = csv.writer(output)
    writer.writerow(["row_number", "status", "duplicate_status", "warnings", "data"])
    for row in rows:
        writer.writerow(
            [
                row.row_number,
                row.status,
                row.duplicate_status,
                "; ".join(row.warnings or []),
                sanitize_export_cell(json.dumps(row.raw_data)),
            ]
        )
    return output.getvalue()
