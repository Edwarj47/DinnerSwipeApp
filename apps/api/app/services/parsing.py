from __future__ import annotations

import hashlib
import json
import re
from collections.abc import Iterable
from typing import Any

QUANTITY_RE = re.compile(
    r"^\s*(?P<qty>\d+(?:\.\d+)?|\d+/\d+)?\s*(?P<unit>[a-zA-Z]+)?\s*(?P<name>.*)$"
)


def normalize_name(value: str) -> str:
    cleaned = re.sub(r"[^a-z0-9\s-]", " ", value.lower())
    return re.sub(r"\s+", " ", cleaned).strip()


def parse_quantity(raw: str | None) -> float | None:
    if not raw:
        return None
    if "/" in raw:
        numerator, denominator = raw.split("/", 1)
        try:
            return float(numerator) / float(denominator)
        except ValueError:
            return None
    try:
        return float(raw)
    except ValueError:
        return None


def split_cell(value: Any) -> list[Any]:
    if value is None:
        return []
    if isinstance(value, list):
        return value
    text = str(value).strip()
    if not text:
        return []
    if text.startswith("["):
        try:
            parsed = json.loads(text)
            return parsed if isinstance(parsed, list) else [text]
        except json.JSONDecodeError:
            return [text]
    if "\n" in text:
        return [part.strip() for part in text.splitlines() if part.strip()]
    if ";" in text:
        return [part.strip() for part in text.split(";") if part.strip()]
    numbered = re.split(r"(?:^|\n|\s)\d+\.\s+", text)
    return [part.strip() for part in numbered if part.strip()] or [text]


def parse_ingredients(value: Any) -> list[dict[str, Any]]:
    items: list[dict[str, Any]] = []
    for index, item in enumerate(split_cell(value)):
        if isinstance(item, dict):
            name = str(item.get("name") or item.get("normalized_name") or "").strip()
            original = str(item.get("original_text") or name).strip()
            quantity = item.get("quantity")
            unit = item.get("unit")
        else:
            original = str(item).strip()
            match = QUANTITY_RE.match(original)
            quantity = parse_quantity(match.group("qty") if match else None)
            unit = match.group("unit") if match and match.group("unit") else None
            name = (match.group("name") if match else original).strip()
            if unit and not name:
                name = unit
                unit = None
        if original and name:
            items.append(
                {
                    "original_text": original,
                    "normalized_name": normalize_name(name),
                    "quantity": float(quantity) if isinstance(quantity, int | float) else quantity,
                    "unit": str(unit).lower() if unit else None,
                    "sort_order": index,
                    "is_optional": bool(isinstance(item, dict) and item.get("is_optional")),
                    "section": item.get("section") if isinstance(item, dict) else None,
                    "preparation_note": item.get("preparation_note")
                    if isinstance(item, dict)
                    else None,
                }
            )
    return items


def parse_instructions(value: Any) -> list[dict[str, Any]]:
    steps: list[dict[str, Any]] = []
    for index, item in enumerate(split_cell(value), start=1):
        if isinstance(item, dict):
            text = str(item.get("text") or item.get("instruction") or "").strip()
            step_number = int(item.get("step_number") or index)
            section = item.get("section")
            timer = item.get("timer_minutes")
        else:
            text = re.sub(r"^\d+\.\s*", "", str(item).strip())
            step_number = index
            section = None
            timer = None
        if text:
            steps.append(
                {
                    "step_number": step_number,
                    "text": text,
                    "section": section,
                    "timer_minutes": int(timer) if isinstance(timer, int | float) else None,
                }
            )
    return steps


def recipe_hash(
    name: str, ingredients: Iterable[dict[str, Any]], instructions: Iterable[dict[str, Any]]
) -> str:
    payload = {
        "name": normalize_name(name),
        "ingredients": sorted(i.get("normalized_name", "") for i in ingredients),
        "instructions": [normalize_name(str(i.get("text", ""))) for i in instructions],
    }
    return hashlib.sha256(json.dumps(payload, sort_keys=True).encode()).hexdigest()
