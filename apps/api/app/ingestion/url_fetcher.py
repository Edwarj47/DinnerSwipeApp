from __future__ import annotations

import ipaddress
import socket
from urllib.parse import urlparse

import httpx
from fastapi import HTTPException

from app.core.config import settings

BLOCKED_HOSTS = {"localhost", "metadata.google.internal"}
BLOCKED_IPS = {"169.254.169.254"}


def validate_public_url(url: str) -> None:
    parsed = urlparse(url)
    if parsed.scheme not in {"http", "https"}:
        raise HTTPException(status_code=400, detail="Only HTTP and HTTPS URLs are supported")
    if not parsed.hostname:
        raise HTTPException(status_code=400, detail="URL host is required")
    hostname = parsed.hostname.lower()
    if hostname in BLOCKED_HOSTS:
        raise HTTPException(status_code=400, detail="Blocked source URL")
    try:
        resolved = socket.getaddrinfo(hostname, None)
    except socket.gaierror as exc:
        raise HTTPException(status_code=400, detail="URL host could not be resolved") from exc
    for result in resolved:
        ip = ipaddress.ip_address(result[4][0])
        if (
            str(ip) in BLOCKED_IPS
            or ip.is_private
            or ip.is_loopback
            or ip.is_link_local
            or ip.is_multicast
            or ip.is_reserved
        ):
            raise HTTPException(status_code=400, detail="Blocked source URL")


async def fetch_public_html(url: str) -> tuple[str, str]:
    validate_public_url(url)
    limits = httpx.Limits(max_connections=4, max_keepalive_connections=0)
    async with httpx.AsyncClient(
        follow_redirects=False,
        timeout=httpx.Timeout(8.0, connect=4.0),
        headers={"User-Agent": "DinnerSwipeRecipeIngestion/0.1 (+https://dinner.dcss.dev)"},
        limits=limits,
    ) as client:
        current = url
        for _ in range(4):
            validate_public_url(current)
            response = await client.get(current)
            if response.status_code in {301, 302, 303, 307, 308}:
                location = response.headers.get("location")
                if not location:
                    raise HTTPException(status_code=400, detail="Redirect missing location")
                current = str(response.url.join(location))
                continue
            response.raise_for_status()
            content_type = response.headers.get("content-type", "")
            if "text/html" not in content_type and "application/xhtml" not in content_type:
                raise HTTPException(status_code=400, detail="Unsupported content type")
            total = 0
            chunks: list[bytes] = []
            async for chunk in response.aiter_bytes():
                total += len(chunk)
                if total > settings.max_url_response_size_bytes:
                    raise HTTPException(status_code=413, detail="URL response too large")
                chunks.append(chunk)
            return b"".join(chunks).decode(response.encoding or "utf-8", errors="replace"), str(
                response.url
            )
    raise HTTPException(status_code=400, detail="Excessive redirect chain")
