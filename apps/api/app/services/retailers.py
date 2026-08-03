from __future__ import annotations

from urllib.parse import quote_plus


class RetailerAdapter:
    retailer_name = "generic"

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

    def build_search_url(self, query: str) -> str:
        return f"https://www.walmart.com/search?q={quote_plus(query)}"
