from __future__ import annotations

from app.ingestion.extractors import extract_json_ld_recipe


def test_json_ld_recipe_extraction() -> None:
    html = """
    <html><head><script type="application/ld+json">
    {
      "@context": "https://schema.org",
      "@type": "Recipe",
      "name": "Bean Tacos",
      "image": "https://example.com/tacos.jpg",
      "recipeIngredient": ["1 cup black beans", "4 tortillas"],
      "recipeInstructions": [
        {"@type":"HowToStep","text":"Warm beans."},
        {"text":"Fill tortillas."}
      ],
      "prepTime": "PT10M",
      "cookTime": "PT5M",
      "recipeYield": "4 servings"
    }
    </script></head><body></body></html>
    """
    recipe = extract_json_ld_recipe(html)
    assert recipe["name"] == "Bean Tacos"
    assert recipe["photo_url"] == "https://example.com/tacos.jpg"
    assert len(recipe["ingredients"]) == 2
    assert len(recipe["instructions"]) == 2
    assert recipe["total_minutes"] is None
