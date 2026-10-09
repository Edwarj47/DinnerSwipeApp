from __future__ import annotations

import asyncio
from typing import Any, cast

import httpx
import structlog
from starlette.concurrency import run_in_threadpool

from app.core.actor import current_actor
from app.core.config import settings
from app.core.rate_limit import auth_rate_limiter

logger = structlog.get_logger()
MODEL_UNAVAILABLE_CODES = {
    "model_not_found",
    "model_not_available",
    "model_not_supported",
    "model_deprecated",
    "model_retired",
}


def model_candidates(primary: str) -> list[str]:
    # Explicitly approved models only; never select an arbitrary model from the catalog.
    backups = settings.openai_fallback_models.split(",")
    return list(dict.fromkeys(model.strip() for model in [primary, *backups] if model.strip()))[:4]


def model_unavailable(response: httpx.Response) -> bool:
    if response.status_code not in {400, 403, 404, 410}:
        return False
    try:
        error = response.json().get("error", {})
        return isinstance(error, dict) and (
            error.get("code") in MODEL_UNAVAILABLE_CODES
            or (error.get("param") == "model" and error.get("code") == "unsupported_value")
        )
    except (ValueError, AttributeError, TypeError):
        return False


async def create_response(payload: dict[str, Any], *, timeout: float) -> tuple[dict[str, Any], str]:
    models = model_candidates(str(payload["model"]))
    if not models:
        raise ValueError("No AI models configured")
    # All attempts share one deadline, keeping the ingestion reservation bounded.
    async with asyncio.timeout(timeout), httpx.AsyncClient(timeout=timeout) as client:
        for index, model in enumerate(models):
            actor = current_actor.get()
            if actor is None:
                raise ValueError("AI dispatch requires an authenticated account")
            await run_in_threadpool(auth_rate_limiter.reserve,
                [
                    ("ai:dispatch:global", settings.ai_daily_dispatch_budget, 86400),
                    (
                        f"ai:dispatch:user:{actor.user_id}",
                        settings.ai_premium_daily_attempts
                        if actor.premium
                        else settings.ai_basic_daily_attempts,
                        86400,
                    ),
                ]
            )
            response = await client.post(
                "https://api.openai.com/v1/responses",
                headers={"Authorization": f"Bearer {settings.openai_api_key}"},
                json=payload
                | {
                    "model": model,
                    "max_output_tokens": min(
                        int(payload.get("max_output_tokens", settings.ai_max_output_tokens)),
                        settings.ai_max_output_tokens,
                    ),
                },
            )
            if model_unavailable(response) and index + 1 < len(models):
                logger.warning("ai_model_unavailable", model=model, fallback=models[index + 1])
                continue
            response.raise_for_status()
            data = response.json()
            if not isinstance(data, dict):
                raise ValueError("Invalid AI response")
            if index:
                logger.info("ai_model_fallback_used", requested_model=models[0], model=model)
            return cast(dict[str, Any], data), model
    raise RuntimeError("No AI response")
