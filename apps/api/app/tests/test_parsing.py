from __future__ import annotations

from app.services.parsing import parse_ingredients, parse_instructions


def test_ingredient_formats() -> None:
    assert len(parse_ingredients("1 lb chicken breast; 1 tsp salt; 2 cups rice")) == 3
    assert (
        parse_ingredients('["1 lb chicken breast", "1 tsp salt"]')[0]["normalized_name"]
        == "chicken breast"
    )
    structured = parse_ingredients('[{"quantity": 1, "unit": "lb", "name": "chicken breast"}]')
    assert structured[0]["quantity"] == 1.0


def test_instruction_formats() -> None:
    assert len(parse_instructions("Cook rice; Serve bowls")) == 2
    assert parse_instructions('["Cook", "Serve"]')[1]["step_number"] == 2
