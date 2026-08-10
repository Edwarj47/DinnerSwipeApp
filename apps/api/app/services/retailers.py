from __future__ import annotations

from urllib.parse import quote_plus

GroceryRetailerKey = str


class RetailerAdapter:
    retailer_name = "generic"
    display_name = "Retailer"

    def build_search_url(self, query: str) -> str:
        raise NotImplementedError

    def search_products(self, query: str) -> list[dict[str, str]]:
        return []

    def match_product(self, query: str) -> dict[str, str] | None:
        return None

    def prepare_cart(self, items: list[dict[str, str]]) -> dict[str, str]:
        return {"status": "unsupported", "message": "Cart preparation is not implemented for MVP"}


class WalmartSearchLinkAdapter(RetailerAdapter):
    retailer_name = "walmart"
    display_name = "Walmart"

    def build_search_url(self, query: str) -> str:
        return f"https://www.walmart.com/search?q={quote_plus(query)}"


class PublixSearchLinkAdapter(RetailerAdapter):
    retailer_name = "publix"
    display_name = "Publix"

    def build_search_url(self, query: str) -> str:
        return f"https://www.publix.com/search/products?searchTerm={quote_plus(query)}"


class KrogerSearchLinkAdapter(RetailerAdapter):
    retailer_name = "kroger"
    display_name = "Kroger"

    def build_search_url(self, query: str) -> str:
        return f"https://www.kroger.com/q/{quote_plus(query)}"


class InstacartSearchLinkAdapter(RetailerAdapter):
    retailer_name = "instacart"
    display_name = "Instacart"

    def build_search_url(self, query: str) -> str:
        return f"https://www.instacart.com/store/s?k={quote_plus(query)}"


RETAILER_ADAPTERS: dict[GroceryRetailerKey, type[RetailerAdapter]] = {
    "walmart": WalmartSearchLinkAdapter,
    "publix": PublixSearchLinkAdapter,
    "kroger": KrogerSearchLinkAdapter,
    "instacart": InstacartSearchLinkAdapter,
}


def get_retailer_adapter(retailer: str | None) -> RetailerAdapter:
    adapter = RETAILER_ADAPTERS.get((retailer or "").strip().lower(), WalmartSearchLinkAdapter)
    return adapter()
