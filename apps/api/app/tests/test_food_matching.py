from __future__ import annotations

from collections.abc import Iterator
from copy import deepcopy
from types import SimpleNamespace
from typing import Any
from unittest.mock import AsyncMock, Mock

import pytest

from app.services import meal_assistant


@pytest.fixture(autouse=True)
def reset_rate_limiter(monkeypatch: pytest.MonkeyPatch) -> Iterator[None]:
    """Override the inherited database fixture; these tests exercise only pure matching."""
    request = Mock(side_effect=AssertionError("Pure matching must not call nutrition providers"))
    response = AsyncMock(side_effect=AssertionError("Pure matching must not call AI providers"))
    monkeypatch.setattr(meal_assistant, "nutrition_client", SimpleNamespace(request=request))
    monkeypatch.setattr(meal_assistant, "create_response", response)
    yield
    request.assert_not_called()
    response.assert_not_called()


def food(food_id: Any, name: str | None, brand: str | None = None) -> dict[str, Any]:
    result = {"food_id": food_id, "food_name": name, "food_type": "Brand" if brand else "Generic"}
    if brand:
        result["brand_name"] = brand
    return result


def mention(name: str, search_term: str | None = None) -> meal_assistant.FoodMention:
    return meal_assistant.FoodMention(
        name=name, search_term=search_term or name, quantity=None, unit=None
    )


@pytest.mark.parametrize(
    ("name", "topping"),
    [
        ("cheeseburger with pickles", "Pickles"),
        ("cheeseburger topped with pickles", "Dill Pickles"),
        ("cheeseburger served with pickles", "Pickles"),
        ("waffle fries with ketchup", "Ketchup"),
        ("waffle fries topped with ketchup", "Tomato Ketchup"),
        ("waffle fries served with ketchup", "Ketchup"),
    ],
)
def test_topping_only_results_do_not_replace_the_primary_food(name: str, topping: str) -> None:
    assert meal_assistant.recommended_food_id(mention(name), [food("99", topping)]) is None


@pytest.mark.parametrize(
    ("name", "topping", "primary"),
    [
        ("cheeseburgers with pickles", "Pickles", "Cheeseburger"),
        ("waffle fries with ketchup", "Ketchup", "Waffle Fries"),
        ("large waffle fries served with ketchup", "Ketchup", "Waffle Fries"),
        ("cheeseburger for lunch with pickles", "Pickles", "Cheeseburger"),
    ],
)
def test_primary_food_is_selected_after_a_topping_result(
    name: str, topping: str, primary: str
) -> None:
    found = [food("99", topping), food("42", primary)]
    assert meal_assistant.recommended_food_id(mention(name), found) == "42"


@pytest.mark.parametrize(
    ("name", "candidate"),
    [
        ("cheeseburger with pickles", "Cheese Burger"),
        ("cheeseburgers with pickles", "Cheese Burgers"),
        ("cheeseburger with pickles", "Cheese-Burger"),
        ("cheese burger with pickles", "Cheeseburger"),
        ("fries with ketchup", "French Fried Potatoes"),
        ("waffle fries with ketchup", "Waffle French Fried Potatoes"),
        ("french fried potatoes with ketchup", "Fries"),
    ],
)
def test_compound_food_aliases_preserve_the_primary_identity(name: str, candidate: str) -> None:
    found = [food("99", "Pickles"), food("98", "Ketchup"), food("42", candidate)]
    assert meal_assistant.recommended_food_id(mention(name), found) == "42"


@pytest.mark.parametrize("name", ["pickles", "ketchup", "mustard", "relish"])
def test_explicitly_requested_standalone_condiments_are_allowed(name: str) -> None:
    found = [food("99", "Cheeseburger"), food("42", name)]
    assert meal_assistant.recommended_food_id(mention(name), found) == "42"


@pytest.mark.parametrize(
    ("name", "candidate"),
    [
        ("cheeseburger with pickles", "Pickles for Cheeseburgers"),
        ("cheeseburger with pickles", "Pickles served with Cheeseburgers"),
        ("waffle fries with ketchup", "Ketchup for Waffle Fries"),
        ("waffle fries with ketchup", "Ketchup served with Waffle Fries"),
        ("cheeseburger", "Cheeseburger Relish"),
        ("waffle fries", "Waffle Fries Sauce"),
    ],
)
def test_condiment_names_cannot_borrow_the_accompanying_food_identity(
    name: str, candidate: str
) -> None:
    assert meal_assistant.recommended_food_id(mention(name), [food("99", candidate)]) is None


@pytest.mark.parametrize(
    ("name", "search_term", "condiment", "primary"),
    [
        (
            "cheeseburger with pickles",
            "cheeseburger pickles",
            "Cheeseburger Pickles",
            "Cheeseburger",
        ),
        (
            "cheeseburger with sauce",
            "cheeseburger sauce",
            "Cheeseburger Sauce",
            "Cheeseburger",
        ),
        (
            "waffle fries with ketchup",
            "waffle fries ketchup",
            "Waffle Fries Ketchup",
            "Waffle Fries",
        ),
    ],
)
def test_attached_condiment_does_not_allow_a_dish_named_condiment(
    name: str, search_term: str, condiment: str, primary: str
) -> None:
    requested = mention(name, search_term)
    found = [food("99", condiment)]
    assert meal_assistant.recommended_food_id(requested, found) is None
    assert meal_assistant.recommended_food_id(requested, found + [food("42", primary)]) == "42"


@pytest.mark.parametrize(
    ("name", "search_term"),
    [
        ("Example Kitchen cheeseburger with pickles", "cheeseburger"),
        ("cheeseburger with pickles", "Example Kitchen cheeseburger"),
    ],
)
def test_explicit_brand_from_name_or_search_term_is_preserved(
    name: str, search_term: str
) -> None:
    found = [
        food("10", "Cheeseburger"),
        food("11", "Cheeseburger", "Other Kitchen"),
        food("42", "Cheese Burger", "EXAMPLE KITCHEN"),
    ]
    assert meal_assistant.recommended_food_id(mention(name, search_term), found) == "42"


@pytest.mark.parametrize("candidate", ["Waffles", "French Fries", "Fries", "Waffle Cone"])
def test_waffle_fries_require_both_substantive_food_tokens(candidate: str) -> None:
    requested = mention("waffle fries with ketchup")
    found = [food("99", candidate)]
    assert meal_assistant.recommended_food_id(requested, found) is None
    found.append(food("42", "Waffle Fries"))
    assert meal_assistant.recommended_food_id(requested, found) == "42"


def test_fries_noun_is_not_satisfied_by_fried_preparation() -> None:
    requested = mention("fries")
    assert meal_assistant.recommended_food_id(requested, [food("99", "Fried Chicken")]) is None
    found = [food("99", "Fried Chicken"), food("42", "French Fries")]
    assert meal_assistant.recommended_food_id(requested, found) == "42"


@pytest.mark.parametrize(
    ("name", "search_term", "topping", "primary"),
    [
        ("cheeseburger", "pickles", "Pickles", "Cheeseburger"),
        ("cheeseburger with pickles", "pickles", "Pickles", "Cheeseburger"),
        ("waffle fries", "ketchup", "Ketchup", "Waffle Fries"),
        ("waffle fries with ketchup", "ketchup", "Ketchup", "Waffle Fries"),
    ],
)
def test_misleading_search_term_cannot_override_the_mention_name(
    name: str, search_term: str, topping: str, primary: str
) -> None:
    requested = mention(name, search_term)
    found = [food("99", topping)]
    assert meal_assistant.recommended_food_id(requested, found) is None
    assert meal_assistant.recommended_food_id(requested, found + [food("42", primary)]) == "42"


@pytest.mark.parametrize(
    ("name", "search_term", "conflicting", "compatible"),
    [
        ("raw almonds", "almonds", "Roasted Almonds", "Raw Almonds"),
        ("uncooked rice", "rice", "Cooked Rice", "Raw Rice"),
        ("cooked rice", "rice", "Raw Rice", "Cooked Rice"),
        ("rice", "cooked rice", "Raw Rice", "Cooked Rice"),
        (
            "grilled chicken breast",
            "chicken breast",
            "Fried Chicken Breast",
            "Grilled Chicken Breast",
        ),
        (
            "fried chicken breast",
            "chicken breast",
            "Grilled Chicken Breast",
            "Fried Chicken Breast",
        ),
        ("steamed rice", "cooked rice", "Fried Rice", "Steamed Rice"),
    ],
)
def test_explicit_preparation_conflicts_abstain_even_without_an_alternative(
    name: str, search_term: str, conflicting: str, compatible: str
) -> None:
    requested = mention(name, search_term)
    found = [food("99", conflicting)]
    assert meal_assistant.recommended_food_id(requested, found) is None
    assert meal_assistant.recommended_food_id(requested, found + [food("42", compatible)]) == "42"


@pytest.mark.parametrize(
    ("name", "search_term"),
    [
        ("grilled chicken breast with raw onions", "grilled chicken breast"),
        ("grilled chicken breast with raw onions", "grilled chicken breast raw onions"),
        ("grilled chicken breast with roasted peppers", "grilled chicken breast"),
        ("grilled chicken breast with roasted peppers", "grilled chicken breast roasted peppers"),
    ],
)
def test_topping_preparation_does_not_override_the_main_food_method(
    name: str, search_term: str
) -> None:
    requested = mention(name, search_term)
    found = [food("99", "Roasted Chicken Breast"), food("98", "Raw Chicken Breast")]
    assert meal_assistant.recommended_food_id(requested, found) is None
    found.append(food("42", "Grilled Chicken Breast"))
    assert meal_assistant.recommended_food_id(requested, found) == "42"


@pytest.mark.parametrize(
    ("name", "candidate", "expected"),
    [
        ("grilled chicken breast", "Grilled Chicken Breast with Raw Onions", "42"),
        ("raw almonds", "Raw Almonds served with Roasted Peppers", "42"),
        ("grilled chicken breast", "Roasted Chicken Breast served with Grilled Peppers", None),
    ],
)
def test_candidate_preparation_is_scoped_to_its_main_food(
    name: str, candidate: str, expected: str | None
) -> None:
    assert meal_assistant.recommended_food_id(mention(name), [food("42", candidate)]) == expected


@pytest.mark.parametrize(
    ("name", "condiment", "primary"),
    [
        ("Example Kitchen cheeseburger with pickles", "Pickles for Cheeseburgers", "Cheeseburger"),
        ("Example Kitchen waffle fries with ketchup", "Ketchup for Waffle Fries", "Waffle Fries"),
    ],
)
def test_matching_brand_cannot_make_a_condiment_eligible(
    name: str, condiment: str, primary: str
) -> None:
    requested = mention(name)
    found = [food("99", condiment, "Example Kitchen")]
    assert meal_assistant.recommended_food_id(requested, found) is None
    found.append(food("42", primary, "Example Kitchen"))
    assert meal_assistant.recommended_food_id(requested, found) == "42"


@pytest.mark.parametrize("other_brand", [None, "Other Kitchen"])
@pytest.mark.parametrize(
    ("name", "condiment", "primary"),
    [
        ("Example Kitchen cheeseburger with pickles", "Pickles for Cheeseburgers", "Cheeseburger"),
        ("Example Kitchen waffle fries with ketchup", "Ketchup for Waffle Fries", "Waffle Fries"),
    ],
)
def test_brand_known_only_on_a_condiment_does_not_allow_a_different_brand_main_food(
    name: str, condiment: str, primary: str, other_brand: str | None
) -> None:
    found = [food("99", condiment, "Example Kitchen"), food("42", primary, other_brand)]
    assert meal_assistant.recommended_food_id(mention(name), found) is None


@pytest.mark.parametrize("other_brand", [None, "Other Kitchen"])
@pytest.mark.parametrize(
    ("name", "search_term"),
    [
        ("chicken breast", "Example Kitchen grilled chicken breast"),
        ("chicken breast with sauce", "Example Kitchen grilled chicken breast with sauce"),
    ],
)
def test_search_only_brand_is_required_even_when_missing_from_results(
    name: str, search_term: str, other_brand: str | None
) -> None:
    requested = mention(name, search_term)
    found = [food("99", "Grilled Chicken Breast", other_brand)]
    assert meal_assistant.recommended_food_id(requested, found) is None
    found.append(food("42", "Grilled Chicken Breast", "Example Kitchen"))
    assert meal_assistant.recommended_food_id(requested, found) == "42"


@pytest.mark.parametrize(
    "search_term",
    [
        "Example Kitchen chicken breast",
        "grilled chicken breast",
        "Example Kitchen grilled chicken breast",
    ],
)
def test_already_clean_search_qualifiers_are_not_broadened_for_fallback(search_term: str) -> None:
    requested = mention("chicken breast", search_term)
    original = requested.model_dump()
    assert meal_assistant._fallback_search(requested) == search_term
    assert requested.model_dump() == original


@pytest.mark.parametrize(
    ("name", "search_term", "expected"),
    [
        (
            "chicken breast with sauce",
            "Example Kitchen grilled chicken breast with sauce",
            "Example Kitchen grilled chicken breast",
        ),
        (
            "Example Kitchen grilled chicken breast with sauce",
            "chicken breast sauce",
            "Example Kitchen grilled chicken breast",
        ),
        (
            "grilled chicken breast with roasted peppers",
            "chicken breast roasted peppers",
            "grilled chicken breast",
        ),
        ("cheeseburger with pickles", "pickles", "cheeseburger"),
        ("waffle fries with ketchup", "waffle fries ketchup", "waffle fries"),
    ],
)
def test_fallback_cleans_toppings_without_discarding_meaningful_qualifiers(
    name: str, search_term: str, expected: str
) -> None:
    requested = mention(name, search_term)
    original = requested.model_dump()
    assert meal_assistant._fallback_search(requested) == expected
    assert requested.model_dump() == original


def test_matching_does_not_mutate_the_mention_or_candidates() -> None:
    requested = meal_assistant.FoodMention(
        name="Example Kitchen cheeseburger with pickles",
        search_term="Example Kitchen cheeseburger",
        quantity=2,
        unit="each",
    )
    found = [
        food("99", "Pickles for Cheeseburgers", "Example Kitchen"),
        food(42, "Cheese Burger", "Example Kitchen"),
    ]
    found[1]["metadata"] = {"tags": ["synthetic", "unchanged"]}
    original_mention = requested.model_dump()
    original_found = deepcopy(found)

    assert meal_assistant.recommended_food_id(requested, found) == "42"
    assert meal_assistant.recommended_food_id(requested, found) == "42"
    assert requested.model_dump() == original_mention
    assert found == original_found


@pytest.mark.parametrize(
    "invalid_id", [None, "", "abc", "-1", "1.5", 1.5, True, " 42", "1" * 21, "\u0664\u0662"]
)
def test_invalid_identifiers_are_rejected_even_for_exact_food_matches(invalid_id: Any) -> None:
    requested = mention("cheeseburger")
    found = [food(invalid_id, "Cheeseburger")]
    assert meal_assistant.recommended_food_id(requested, found) is None
    found.append(food("42", "Cheese Burger"))
    assert meal_assistant.recommended_food_id(requested, found) == "42"


@pytest.mark.parametrize("found", [[], [{"food_id": "42"}], [food("42", None)]])
def test_empty_results_and_missing_food_names_have_no_recommendation(
    found: list[dict[str, Any]],
) -> None:
    assert meal_assistant.recommended_food_id(mention("cheeseburger"), found) is None
