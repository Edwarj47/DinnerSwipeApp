from __future__ import annotations

import asyncio
from typing import Literal

import httpx
from fastapi import APIRouter, HTTPException, Query, Response
from starlette.concurrency import run_in_threadpool

from app.api.deps import CurrentUser, DbDep
from app.core.config import settings
from app.core.rate_limit import auth_rate_limiter
from app.ingestion.url_fetcher import fetch_public_bytes
from app.services.private_media import (
    authorize_photo,
    image_bytes,
    normalize_image,
    photo_url,
    source_for,
)

router = APIRouter(prefix="/media", tags=["media"])
proxy_slots = asyncio.Semaphore(4)


@router.get("/{kind}/{resource_id}/link")
def renew_photo_link(
    kind: Literal["recipes", "drafts", "objects"],
    resource_id: str,
    user: CurrentUser,
    db: DbDep,
    response: Response,
) -> dict[str, str | None]:
    source = source_for(db, user, kind, resource_id)
    response.headers["Cache-Control"] = "no-store"
    return {"photo_url": photo_url(db, user, kind, resource_id, source)}


@router.get("/{kind}/{resource_id}")
async def read_photo(
    kind: Literal["recipes", "drafts", "objects"],
    resource_id: str,
    db: DbDep,
    token: str = Query(max_length=2000),
) -> Response:
    user, source = await run_in_threadpool(authorize_photo, db, token, kind, resource_id)
    data = await run_in_threadpool(image_bytes, db, source)
    if data is None:
        await run_in_threadpool(auth_rate_limiter.reserve, [(f"photo-proxy:{user.id}", 60, 60)])
        try:
            async with asyncio.timeout(20):
                async with proxy_slots:
                    raw, _, _ = await fetch_public_bytes(
                        source, maximum=settings.max_image_upload_size_bytes, kind="image"
                    )
                    data = await run_in_threadpool(normalize_image, raw)
        except (httpx.HTTPError, TimeoutError):
            raise HTTPException(502, "Recipe photo is temporarily unavailable") from None
    return Response(
        data,
        media_type="image/jpeg",
        headers={
            "Cache-Control": "private, max-age=240",
            "X-Content-Type-Options": "nosniff",
            "Referrer-Policy": "no-referrer",
        },
    )
