from __future__ import annotations

from datetime import UTC, datetime
from typing import Any

import httpx
import structlog
from pydantic import BaseModel, Field

from app.core.config import settings

logger = structlog.get_logger()


class AiIngredient(BaseModel):
    original_text: str
    normalized_name: str
    quantity: float | None = None
    unit: str | None = None
    preparation_note: str | None = None
    is_optional: bool = False


class AiInstruction(BaseModel):
    step_number: int
    text: str
    timer_minutes: int | None = None


class AiConfidence(BaseModel):
    field: str
    score: float = Field(ge=0, le=1)


class AiRecipeNormalization(BaseModel):
    ingredients: list[AiIngredient] = Field(default_factory=list)
    instructions: list[AiInstruction] = Field(default_factory=list)
    warnings: list[str] = Field(default_factory=list)
    confidence: list[AiConfidence] = Field(default_factory=list)
    tags: list[str] = Field(default_factory=list)


class AiNormalizationProvider:
    async def normalize(self, candidate: dict[str, Any]) -> dict[str, Any]:
        raise NotImplementedError


class DisabledAiProvider(AiNormalizationProvider):
    async def normalize(self, candidate: dict[str, Any]) -> dict[str, Any]:
        return {
            "enabled": False,
            "warnings": ["AI ingestion is disabled or OPENAI_API_KEY is not configured"],
            "confidence": {},
        }


class OpenAIResponsesProvider(AiNormalizationProvider):
    prompt_version = "url-recipe-normalizer-v1"

    async def normalize(self, candidate: dict[str, Any]) -> dict[str, Any]:
        schema = _strict_json_schema(AiRecipeNormalization.model_json_schema())
        payload = {
            "model": settings.openai_model,
            "store": False,
            "input": [
                {
                    "role": "system",
                    "content": (
                        "Normalize only recipe content present in the supplied candidate. "
                        "Do not invent missing ingredients, instructions, timing, "
                        "source, or images. Return warnings only for missing or contradictory "
                        "user-facing recipe fields that still need manual review. Do not warn "
                        "about optional internal fields such as timer_minutes, null timers, "
                        "or cooking-time ranges that are preserved in the instruction text."
                    ),
                },
                {"role": "user", "content": str(candidate)[:12000]},
            ],
            "text": {
                "format": {
                    "type": "json_schema",
                    "name": "recipe_normalization",
                    "schema": schema,
                    "strict": True,
                }
            },
        }
        try:
            async with httpx.AsyncClient(timeout=60) as client:
                response = await client.post(
                    "https://api.openai.com/v1/responses",
                    headers={"Authorization": f"Bearer {settings.openai_api_key}"},
                    json=payload,
                )
                response.raise_for_status()
            data = response.json()
        except Exception as exc:
            logger.warning("ai_normalization_failed", error_type=type(exc).__name__)
            return {
                "enabled": True,
                "model": settings.openai_model,
                "prompt_version": self.prompt_version,
                "warnings": ["AI normalization failed; deterministic extraction was retained"],
                "confidence": {},
            }
        content = data.get("output_text")
        if not content:
            for item in data.get("output", []):
                for part in item.get("content", []):
                    if part.get("type") == "output_text":
                        content = part.get("text")
                        break
        try:
            parsed = AiRecipeNormalization.model_validate_json(content or "{}")
        except Exception as exc:
            logger.warning("ai_normalization_parse_failed", error_type=type(exc).__name__)
            return {
                "enabled": True,
                "model": settings.openai_model,
                "prompt_version": self.prompt_version,
                "warnings": [
                    "AI normalization returned invalid structure; "
                    "deterministic extraction was retained"
                ],
                "confidence": {},
            }
        parsed_data = parsed.model_dump()
        confidence = {item["field"]: item["score"] for item in parsed_data.pop("confidence", [])}
        return {
            "enabled": True,
            "model": settings.openai_model,
            "prompt_version": self.prompt_version,
            "extraction_timestamp": datetime.now(UTC).isoformat(),
            **parsed_data,
            "confidence": confidence,
        }


def get_ai_provider() -> AiNormalizationProvider:
    if settings.ai_ingestion_enabled and settings.openai_api_key:
        return OpenAIResponsesProvider()
    return DisabledAiProvider()


def _strict_json_schema(schema: dict[str, Any]) -> dict[str, Any]:
    def visit(node: Any) -> None:
        if isinstance(node, dict):
            if node.get("type") == "object" or "properties" in node:
                node["additionalProperties"] = False
                properties = node.get("properties")
                if isinstance(properties, dict):
                    node["required"] = list(properties.keys())
            for value in node.values():
                visit(value)
        elif isinstance(node, list):
            for item in node:
                visit(item)

    visit(schema)
    return schema
