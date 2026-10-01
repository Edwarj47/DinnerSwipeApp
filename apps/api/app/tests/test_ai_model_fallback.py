from __future__ import annotations

import asyncio
import json
from typing import Any
from uuid import uuid4

import httpx
import pytest
from fastapi.testclient import TestClient
from sqlalchemy.orm import Session

from app.core.config import settings
from app.ingestion import openai_responses
from app.ingestion.ai_provider import OpenAIResponsesProvider
from app.models.entities import IngestionJob
from app.services.ai_recipes import generate

DRAFT = {
    "name": "Carrot soup",
    "description": "Simple soup",
    "servings": 2,
    "prep_minutes": 5,
    "cook_minutes": 20,
    "total_minutes": 25,
    "difficulty": "easy",
    "meal_type": "dinner",
    "ingredients": ["2 carrots", "2 cups stock"],
    "instructions": ["Simmer carrots in stock."],
    "review_notes": [],
}


def completed(content: dict[str, Any]) -> httpx.Response:
    return httpx.Response(
        200,
        json={
            "status": "completed",
            "output": [
                {"content": [{"type": "output_text", "text": json.dumps(content)}]},
            ],
        },
    )


def install_transport(
    monkeypatch: pytest.MonkeyPatch, responses: list[httpx.Response]
) -> list[dict[str, Any]]:
    calls: list[dict[str, Any]] = []

    def handler(request: httpx.Request) -> httpx.Response:
        calls.append(json.loads(request.content))
        return responses.pop(0)

    original = httpx.AsyncClient
    monkeypatch.setattr(
        httpx,
        "AsyncClient",
        lambda **kwargs: original(
            transport=httpx.MockTransport(handler),
            **kwargs,
        ),
    )
    monkeypatch.setattr(settings, "ai_recipe_enabled", True)
    monkeypatch.setattr(settings, "openai_api_key", "test-only-key")
    monkeypatch.setattr(settings, "ai_recipe_model", "retired-fixture")
    monkeypatch.setattr(settings, "openai_fallback_models", " backup-fixture,backup-fixture ")
    return calls


def unavailable() -> httpx.Response:
    return httpx.Response(404, json={"error": {"code": "model_not_found", "param": "model"}})


def test_retired_primary_preserves_image_schema_and_counts_once(
    monkeypatch: pytest.MonkeyPatch,
    client: TestClient,
    auth_headers: dict[str, str],
    db_session: Session,
) -> None:
    calls = install_transport(monkeypatch, [unavailable(), completed(DRAFT)])
    request_id = str(uuid4())
    for _ in range(2):
        result = client.post(
            "/api/v1/ai-recipes",
            headers=auth_headers,
            data={"request_id": request_id, "description": "Carrot soup"},
            files={"image": ("fixture.png", b"\x89PNG\r\n\x1a\nfixture", "image/png")},
        )
        assert result.status_code == 200, result.text
    assert [call["model"] for call in calls] == ["retired-fixture", "backup-fixture"]
    assert calls[0] | {"model": "backup-fixture"} == calls[1]
    assert calls[1]["store"] is False
    assert calls[1]["text"]["format"]["strict"] is True
    assert "_model_used" not in json.dumps(calls[1]["text"])
    assert calls[1]["input"][1]["content"][1]["image_url"].startswith("data:image/png;base64,")
    assert db_session.query(IngestionJob).one().progress["model"] == "backup-fixture"
    assert client.get("/api/v1/ai-recipes/usage", headers=auth_headers).json()["used"] == 1


@pytest.mark.parametrize(
    "status,code",
    [
        (401, "invalid_api_key"),
        (403, "permission_denied"),
        (429, "insufficient_quota"),
        (429, "rate_limit_exceeded"),
        (400, "invalid_json_schema"),
        (500, "server_error"),
    ],
)
def test_no_model_switch_for_unrelated_errors(
    monkeypatch: pytest.MonkeyPatch, status: int, code: str
) -> None:
    calls = install_transport(monkeypatch, [httpx.Response(status, json={"error": {"code": code}})])
    with pytest.raises(httpx.HTTPStatusError):
        asyncio.run(generate("Carrots", None, None))
    assert len(calls) == 1


@pytest.mark.parametrize(
    "response",
    [
        {"status": "completed", "output": [{"content": [{"type": "refusal", "refusal": "No"}]}]},
        {"status": "incomplete", "output": []},
        {"status": "completed", "output": [{"content": [{"type": "output_text", "text": "{}"}]}]},
    ],
)
def test_refusal_or_invalid_output_is_not_retried(
    monkeypatch: pytest.MonkeyPatch, response: dict[str, Any]
) -> None:
    calls = install_transport(monkeypatch, [httpx.Response(200, json=response)])
    with pytest.raises(ValueError):
        asyncio.run(generate("Unrelated content", None, None))
    assert len(calls) == 1


def test_exhausted_models_fail_without_using_allowance(
    monkeypatch: pytest.MonkeyPatch,
    client: TestClient,
    auth_headers: dict[str, str],
) -> None:
    calls = install_transport(monkeypatch, [unavailable(), unavailable()])
    result = client.post(
        "/api/v1/ai-recipes",
        headers=auth_headers,
        data={"request_id": str(uuid4()), "description": "Carrots"},
    )
    assert result.status_code == 502
    assert "model_not_found" not in result.text
    assert len(calls) == 2
    assert client.get("/api/v1/ai-recipes/usage", headers=auth_headers).json()["used"] == 0


def test_web_normalization_also_uses_fallback(monkeypatch: pytest.MonkeyPatch) -> None:
    calls = install_transport(
        monkeypatch,
        [
            unavailable(),
            completed(
                {
                    "ingredients": [],
                    "instructions": [],
                    "warnings": [],
                    "confidence": [],
                    "tags": [],
                }
            ),
        ],
    )
    monkeypatch.setattr(settings, "openai_model", "retired-fixture")
    result = asyncio.run(OpenAIResponsesProvider().normalize({"name": "Carrots"}))
    assert result["model"] == "backup-fixture"
    assert len(calls) == 2


def test_chain_deduplicated_bounded_and_can_be_disabled(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(settings, "openai_fallback_models", " a, b,a, ,c,d,e")
    assert openai_responses.model_candidates("a") == ["a", "b", "c", "d"]
    monkeypatch.setattr(settings, "openai_fallback_models", "")
    assert openai_responses.model_candidates("a") == ["a"]


def test_label_nutrition_is_in_strict_schema_and_preserved(monkeypatch: pytest.MonkeyPatch) -> None:
    nutrition = {"calories": 160, "protein_g": 30, "carbs_g": 4, "fat_g": 3, "fiber_g": 2}
    calls = install_transport(
        monkeypatch, [completed(DRAFT | {"nutrition": nutrition, "nutrition_basis": "serving"})]
    )
    result = asyncio.run(generate("", b"image-fixture", "image/jpeg"))
    assert result.nutrition is not None and result.nutrition.model_dump() == nutrition
    assert result.nutrition_basis == "serving"
    schema = calls[0]["text"]["format"]["schema"]
    assert {"nutrition", "nutrition_basis"} <= set(schema["required"])
    nutrients = schema["$defs"]["RecipeNutrition"]
    assert set(nutrients["required"]) == set(nutrition)
    assert nutrients["additionalProperties"] is False
    assert calls[0]["input"][1]["content"][1]["detail"] == "high"
    assert "NOT percent daily values" in calls[0]["input"][0]["content"]


def test_missing_nutrition_stays_unknown_and_explicit_zero_survives(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    install_transport(
        monkeypatch,
        [
            completed(DRAFT),
            completed(
                DRAFT
                | {"nutrition": {"calories": 0, "protein_g": None}, "nutrition_basis": "recipe"}
            ),
        ],
    )
    assert asyncio.run(generate("Carrot soup", None, None)).nutrition is None
    result = asyncio.run(generate("Zero calorie water", None, None))
    assert result.nutrition is not None
    assert result.nutrition.calories == 0 and result.nutrition.protein_g is None
    assert result.nutrition_basis == "recipe"


@pytest.mark.parametrize(
    "nutrition,basis",
    [({"calories": -1}, "serving"), ({"fat_g": 1001}, "serving"), ({}, "unknown")],
)
def test_invalid_nutrition_or_basis_fails_validation(
    monkeypatch: pytest.MonkeyPatch, nutrition: dict[str, int], basis: str
) -> None:
    install_transport(
        monkeypatch, [completed(DRAFT | {"nutrition": nutrition, "nutrition_basis": basis})]
    )
    with pytest.raises(ValueError):
        asyncio.run(generate("Label", None, None))
