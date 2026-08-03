from __future__ import annotations

from typing import Any
from urllib.parse import urlparse

from app.core.config import settings


def validate_photo_url(
    value: str | None, accept_placeholder: bool = False
) -> tuple[list[str], list[str], str]:
    errors: list[str] = []
    warnings: list[str] = []
    if not value:
        if accept_placeholder:
            warnings.append("Photo missing; placeholder accepted")
            return errors, warnings, "missing"
        errors.append("Missing photo")
        return errors, warnings, "requires_review"
    if value.startswith("/media/") or value.startswith(f"{settings.public_api_url}/media/"):
        return errors, warnings, "validated"
    parsed = urlparse(value)
    if parsed.scheme != "https":
        errors.append("Unsupported photo URL")
        return errors, warnings, "rejected"
    if parsed.hostname in {"localhost", "127.0.0.1", "::1"}:
        errors.append("Blocked photo URL")
        return errors, warnings, "rejected"
    return errors, warnings, "pending"


def validate_recipe_payload(
    payload: dict[str, Any], accept_placeholder: bool = False
) -> dict[str, Any]:
    errors: list[str] = []
    warnings: list[str] = []
    name = str(payload.get("name") or "").strip()
    ingredients = payload.get("ingredients") or []
    instructions = payload.get("instructions") or []
    if len(name) < 2:
        errors.append("Missing name")
    if not ingredients:
        errors.append("Empty ingredients")
    if not instructions:
        errors.append("Empty instructions")
    photo_errors, photo_warnings, image_status = validate_photo_url(
        payload.get("photo_url"), accept_placeholder
    )
    errors.extend(photo_errors)
    warnings.extend(photo_warnings)
    if not payload.get("servings"):
        warnings.append("Missing servings")
    if not payload.get("total_minutes"):
        warnings.append("Missing timing information")
    return {
        "errors": errors,
        "warnings": warnings,
        "can_approve": not errors,
        "image_status": image_status,
    }
