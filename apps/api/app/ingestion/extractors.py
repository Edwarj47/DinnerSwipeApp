from __future__ import annotations

import json
import re
from typing import Any

from bs4 import BeautifulSoup

from app.services.parsing import parse_ingredients, parse_instructions


def _as_list(value: Any) -> list[Any]:
    if value is None:
        return []
    return value if isinstance(value, list) else [value]


def _instruction_texts(value: Any) -> list[str]:
    texts: list[str] = []
    for step in _as_list(value):
        if isinstance(step, str):
            if step.strip():
                texts.append(step)
            continue
        if not isinstance(step, dict):
            continue
        children = step.get("itemListElement")
        if children:
            texts.extend(_instruction_texts(children))
            continue
        text = step.get("text") or step.get("name")
        if isinstance(text, str) and text.strip():
            texts.append(text)
    return texts


def extract_json_ld_recipe(html: str) -> dict[str, Any]:
    soup = BeautifulSoup(html, "html.parser")
    for script in soup.find_all("script", type=lambda t: t and "ld+json" in t):
        try:
            data = json.loads(script.string or "{}")
        except json.JSONDecodeError:
            continue
        candidates = data if isinstance(data, list) else [data]
        for candidate in candidates:
            graph = candidate.get("@graph") if isinstance(candidate, dict) else None
            items = graph if isinstance(graph, list) else [candidate]
            for item in items:
                types = _as_list(item.get("@type")) if isinstance(item, dict) else []
                if "Recipe" not in types:
                    continue
                image = item.get("image")
                if isinstance(image, list):
                    image = image[0] if image else None
                if isinstance(image, dict):
                    image = image.get("url")
                return {
                    "name": item.get("name"),
                    "description": item.get("description"),
                    "ingredients": parse_ingredients(item.get("recipeIngredient")),
                    "instructions": parse_instructions(
                        _instruction_texts(item.get("recipeInstructions"))
                    ),
                    "photo_url": image,
                    "servings": _parse_servings(item.get("recipeYield")),
                    "prep_minutes": _parse_duration_minutes(item.get("prepTime")),
                    "cook_minutes": _parse_duration_minutes(item.get("cookTime")),
                    "total_minutes": _parse_duration_minutes(item.get("totalTime")),
                    "cuisine": item.get("recipeCuisine"),
                    "meal_type": item.get("recipeCategory") or "dinner",
                    "field_sources": {
                        "name": "structured_data",
                        "ingredients": "structured_data",
                        "instructions": "structured_data",
                        "photo_url": "structured_data",
                    },
                }
    return {}


def extract_metadata(html: str) -> dict[str, Any]:
    soup = BeautifulSoup(html, "html.parser")
    title = soup.find("meta", property="og:title")
    image = soup.find("meta", property="og:image")
    description = soup.find("meta", attrs={"name": "description"})
    return {
        "source_title": title.get("content")
        if title
        else (soup.title.string.strip() if soup.title and soup.title.string else None),
        "photo_url": image.get("content") if image else None,
        "description": description.get("content") if description else None,
    }


def extract_visible_recipe_hints(html: str) -> dict[str, Any]:
    soup = BeautifulSoup(html, "html.parser")
    for tag in soup(["script", "style", "noscript"]):
        tag.decompose()
    lines = [line.strip() for line in soup.get_text("\n").splitlines() if line.strip()]
    ingredient_lines = [line for line in lines if re.match(r"^\d|^(\d+/\d+)", line.lower())][:30]
    instruction_lines = [
        line
        for line in lines
        if any(word in line.lower() for word in ["bake", "cook", "stir", "mix", "serve"])
    ][:20]
    return {
        "ingredients": parse_ingredients(ingredient_lines),
        "instructions": parse_instructions(instruction_lines),
        "field_sources": {"ingredients": "visible_html", "instructions": "visible_html"},
    }


def _parse_servings(value: Any) -> int | None:
    if value is None:
        return None
    match = re.search(r"\d+", str(value))
    return int(match.group()) if match else None


def _parse_duration_minutes(value: Any) -> int | None:
    if not value:
        return None
    text = str(value)
    hours = re.search(r"(\d+)H", text)
    minutes = re.search(r"(\d+)M", text)
    total = 0
    if hours:
        total += int(hours.group(1)) * 60
    if minutes:
        total += int(minutes.group(1))
    return total or None
