from __future__ import annotations

import asyncio

import httpx
import pytest
from fastapi import HTTPException

from app.ingestion import url_fetcher


@pytest.mark.parametrize(
    "target",
    [
        "https://other.example/asset",
        "http://allowed.example/asset",
        "https://allowed.example:8443/asset",
    ],
)
def test_provider_redirect_policy_rejects_before_dns_or_connection(
    monkeypatch: pytest.MonkeyPatch, target: str
) -> None:
    resolved: list[str] = []
    requests: list[httpx.Request] = []

    def resolve(url: str) -> str:
        resolved.append(url)
        return "93.184.216.34"

    def handler(request: httpx.Request) -> httpx.Response:
        requests.append(request)
        return httpx.Response(302, headers={"Location": target})

    original = httpx.AsyncClient
    monkeypatch.setattr(url_fetcher, "validate_public_url", resolve)
    monkeypatch.setattr(
        httpx, "AsyncClient", lambda **kw: original(transport=httpx.MockTransport(handler), **kw)
    )
    with pytest.raises(HTTPException):
        asyncio.run(
            url_fetcher.fetch_public_html(
                "https://allowed.example/start", allowed_hosts={"allowed.example"}, https_only=True
            )
        )
    assert resolved == ["https://allowed.example/start"]
    assert len(requests) == 1
    assert requests[0].url.host == "93.184.216.34"
    assert requests[0].extensions["sni_hostname"] == "allowed.example"


def test_provider_redirect_policy_allows_same_host_https(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(url_fetcher, "validate_public_url", lambda _: "93.184.216.34")

    def handler(request: httpx.Request) -> httpx.Response:
        if request.url.path == "/start":
            return httpx.Response(302, headers={"Location": "/recipe"})
        return httpx.Response(
            200, headers={"Content-Type": "text/html"}, stream=httpx.ByteStream(b"recipe")
        )

    original = httpx.AsyncClient
    monkeypatch.setattr(
        httpx, "AsyncClient", lambda **kw: original(transport=httpx.MockTransport(handler), **kw)
    )
    assert asyncio.run(
        url_fetcher.fetch_public_html(
            "https://allowed.example/start", allowed_hosts={"allowed.example"}, https_only=True
        )
    ) == ("recipe", "https://allowed.example/recipe")


def test_catalog_redirect_is_rejected_before_following(monkeypatch: pytest.MonkeyPatch) -> None:
    requests: list[httpx.Request] = []
    monkeypatch.setattr(url_fetcher, "validate_public_url", lambda _: "93.184.216.34")

    def handler(request: httpx.Request) -> httpx.Response:
        requests.append(request)
        return httpx.Response(302, headers={"Location": "/robots-disallowed"})

    original = httpx.AsyncClient
    monkeypatch.setattr(
        httpx,
        "AsyncClient",
        lambda **kw: original(
            transport=httpx.MockTransport(handler),
            **kw,
        ),
    )
    with pytest.raises(HTTPException):
        asyncio.run(
            url_fetcher.fetch_public_bytes(
                "https://allowed.example/catalog",
                maximum=1000,
                kind="html",
                allowed_hosts={"allowed.example"},
                https_only=True,
                follow_redirects=False,
            )
        )
    assert len(requests) == 1 and requests[0].url.path == "/catalog"
