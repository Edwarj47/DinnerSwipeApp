def normalize_beverage_category(value: str) -> str:
    if value.strip().casefold() in {"beverage", "beverages", "drink", "drinks"}:
        return "beverage"
    return value
