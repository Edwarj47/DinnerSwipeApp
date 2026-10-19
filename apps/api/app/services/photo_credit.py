"""Read-only public photo credits, indexed once per owner/kind in the request session."""

from __future__ import annotations

import re
import unicodedata
from typing import Any, Literal
from urllib.parse import unquote, urlsplit

from bs4 import BeautifulSoup
from pydantic import ValidationError
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.models.content_automation import ContentCandidate
from app.models.entities import Recipe
from app.schemas.photo_credit import PhotoCredit
from app.services.content_media import LICENSE_URLS

Kind = Literal["recipe", "workout"]
CACHE_KEY = "approved_photo_credit_by_owner_kind"
MODIFICATIONS = "Resized and camera metadata removed for Dinner Swipe."
SHARE_ALIKE = "This image copy remains available under CC BY-SA 4.0."
MAX_APPROVED = 175


def _text(value: Any) -> str:
    if not isinstance(value, str) or len(value) > 20_000:
        return ""
    plain = BeautifulSoup(value, "html.parser").get_text(" ", strip=True)
    return " ".join(
        "".join(char for char in plain if not unicodedata.category(char).startswith("C")).split()
    )


def _public_source(value: str) -> bool:
    try:
        parts = urlsplit(value)
        host = parts.hostname or ""
        path = unquote(parts.path)
        if (
            parts.scheme != "https"
            or parts.username is not None
            or parts.password is not None
            or parts.port not in (None, 443)
            or parts.query
            or parts.fragment
            or not path.strip("/")
            or any(char.isspace() or unicodedata.category(char).startswith("C") for char in value)
            or re.search(r"/(?:api|media|uploads)(?:/|$)", path, re.IGNORECASE)
        ):
            return False
        if host == "commons.wikimedia.org":
            return path.startswith("/wiki/File:") and path.lower().endswith(
                (".jpg", ".jpeg", ".png", ".webp")
            )
        return host in {"nhlbi.nih.gov", "www.nhlbi.nih.gov", "myplate.gov", "www.myplate.gov"} or (
            host == "usda.gov" or host.endswith(".usda.gov")
        )
    except ValueError:
        return False


def sanitized_photo_credit(value: Any) -> dict[str, str] | None:
    """Validate an already-derived snapshot credit without consulting private provenance."""
    try:
        credit = PhotoCredit.model_validate(value)
    except ValidationError:
        return None
    text = _text(credit.text)
    if (
        not text
        or not _public_source(credit.source_url)
        or LICENSE_URLS.get(credit.license) != credit.license_url
        or re.search(r"/api/v1/|/media/uploads/|[?&]token=", text, re.IGNORECASE)
    ):
        return None
    return {
        "text": text,
        "source_url": credit.source_url,
        "license_url": credit.license_url,
        "license": credit.license,
    }


def credit_from_evidence(image: Any) -> dict[str, str] | None:
    if not isinstance(image, dict) or image.get("permission_verified") is not True:
        return None
    creator = _text(image.get("creator"))
    text = _text(image.get("credit"))
    if not creator or not text or creator.casefold() not in text.casefold():
        return None
    if MODIFICATIONS not in text:
        text += " " + MODIFICATIONS
    if image.get("license") == "CC BY-SA 4.0" and SHARE_ALIKE not in text:
        text += " " + SHARE_ALIKE
    return sanitized_photo_credit(
        {
            "text": text,
            "source_url": image.get("source_url"),
            "license_url": image.get("license_url"),
            "license": image.get("license"),
        }
    )


def _canonical_reference(value: Any) -> str | None:
    # Do not call canonical_photo: it claims media and can mutate existing records.
    from app.services.private_media import object_url
    from app.services.workout_media import object_id

    if not isinstance(value, str) or not value or len(value) > 8000:
        return None
    try:
        media_id = object_id(value)
    except ValueError:
        return None
    return object_url(media_id) if media_id else None


def photo_credit_for(
    db: Session | None,
    *,
    owner_id: str | None,
    kind: Kind,
    target_id: str,
    photo_url: str | None,
) -> dict[str, str] | None:
    reference = _canonical_reference(photo_url)
    if db is None or not owner_id or not reference:
        return None
    cache = db.info.setdefault(CACHE_KEY, {})
    key = (owner_id, kind)
    if key not in cache:
        target = (
            ContentCandidate.recipe_id if kind == "recipe" else ContentCandidate.workout_template_id
        )
        query = (
            select(
                target,
                ContentCandidate.payload["photo_url"].as_string(),
                ContentCandidate.provenance["image"],
            )
            .where(
                ContentCandidate.user_id == owner_id,
                ContentCandidate.kind == kind,
                ContentCandidate.status == "approved",
                target.is_not(None),
            )
            .order_by(ContentCandidate.decided_at.desc(), ContentCandidate.id)
            .limit(MAX_APPROVED)
        )
        index: dict[tuple[str, str], dict[str, str]] = {}
        with db.no_autoflush:
            for identity, photo, image in db.execute(query):
                original = _canonical_reference(photo)
                credit = credit_from_evidence(image)
                if original and credit:
                    index.setdefault((identity, original), credit)
        cache[key] = index
    found = cache[key].get((target_id, reference))
    return dict(found) if found else None


def recipe_photo_credit(db: Session | None, recipe: Recipe) -> dict[str, str] | None:
    # Existing/manual recipes cannot trigger a lookup just by having an owner or photo.
    if not recipe.photo_attribution:
        return None
    return photo_credit_for(
        db,
        owner_id=recipe.owner_user_id,
        kind="recipe",
        target_id=recipe.id,
        photo_url=recipe.photo_url,
    )
