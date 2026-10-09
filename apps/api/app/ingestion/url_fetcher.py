from __future__ import annotations

import ipaddress
import socket
import zlib
from urllib.parse import urlparse

import httpx
from fastapi import HTTPException
from starlette.concurrency import run_in_threadpool

from app.core.config import settings

BLOCKED_HOSTS = {"localhost", "metadata.google.internal"}
BLOCKED_IPS = {"169.254.169.254"}


def validate_public_url(url: str) -> str:
    parsed = urlparse(url)
    if parsed.scheme not in {"http", "https"}:
        raise HTTPException(status_code=400, detail="Only HTTP and HTTPS URLs are supported")
    if not parsed.hostname:
        raise HTTPException(status_code=400, detail="URL host is required")
    hostname = parsed.hostname.lower()
    if parsed.username is not None or parsed.password is not None:
        raise HTTPException(400, "Source URLs cannot contain credentials")
    if hostname in BLOCKED_HOSTS:
        raise HTTPException(status_code=400, detail="Blocked source URL")
    try:
        resolved = socket.getaddrinfo(
            hostname,
            parsed.port or (443 if parsed.scheme == "https" else 80),
            type=socket.SOCK_STREAM,
        )
    except (socket.gaierror, ValueError) as exc:
        raise HTTPException(status_code=400, detail="URL host could not be resolved") from exc
    for result in resolved:
        ip = ipaddress.ip_address(result[4][0])
        if (
            str(ip) in BLOCKED_IPS
            or not ip.is_global
            or ip.is_private
            or ip.is_loopback
            or ip.is_link_local
            or ip.is_multicast
            or ip.is_reserved
        ):
            raise HTTPException(status_code=400, detail="Blocked source URL")
    if not resolved:
        raise HTTPException(400, "URL host could not be resolved")
    return str(ipaddress.ip_address(resolved[0][4][0]))


async def fetch_public_html(url: str) -> tuple[str, str]:
    content, final_url, encoding = await fetch_public_bytes(
        url, maximum=settings.max_url_response_size_bytes, kind="html"
    )
    return content.decode(encoding or "utf-8", errors="replace"), final_url


async def fetch_public_bytes(url: str, *, maximum: int, kind: str) -> tuple[bytes, str, str | None]:
    limits = httpx.Limits(max_connections=4, max_keepalive_connections=0)
    async with httpx.AsyncClient(
        follow_redirects=False,
        timeout=httpx.Timeout(8.0, connect=4.0),
        headers={"User-Agent": "DinnerSwipeRecipeIngestion/0.1 (+https://dinner.dcss.dev)"},
        limits=limits,
        trust_env=False,
    ) as client:
        current = url
        for _ in range(4):
            address = await run_in_threadpool(validate_public_url, current)
            original = httpx.URL(current)
            # Connect to the validated address, but verify TLS against the original
            # hostname. Redirects must pass this same boundary before connecting.
            pinned = original.copy_with(host=address)
            async with client.stream(
                "GET",
                pinned,
                headers={"Host": original.netloc.decode("ascii"), "Accept-Encoding": "identity"},
                extensions={"sni_hostname": original.host},
            ) as response:
                if response.status_code in {301, 302, 303, 307, 308}:
                    location = response.headers.get("location")
                    if not location:
                        raise HTTPException(status_code=400, detail="Redirect missing location")
                    current = str(original.join(location))
                    continue
                response.raise_for_status()
                content_type = response.headers.get("content-type", "").lower()
                supported = (
                    ("text/html" in content_type or "application/xhtml" in content_type)
                    if kind == "html"
                    else content_type.split(";")[0] in {"image/jpeg", "image/png", "image/webp"}
                )
                encoding = response.headers.get("content-encoding", "identity").lower().strip()
                if not supported or encoding not in {"identity", "gzip", "deflate"}:
                    raise HTTPException(
                        status_code=400, detail="Unsupported content type or encoding"
                    )
                total = 0
                compressed_total = 0
                decoder = (
                    None
                    if encoding == "identity"
                    else zlib.decompressobj(
                        zlib.MAX_WBITS + 16 if encoding == "gzip" else zlib.MAX_WBITS
                    )
                )
                chunks: list[bytes] = []
                async for chunk in response.aiter_raw():
                    compressed_total += len(chunk)
                    if compressed_total > maximum:
                        raise HTTPException(status_code=413, detail="URL response too large")
                    if decoder:
                        try:
                            chunk = decoder.decompress(chunk, maximum - total + 1)
                        except zlib.error:
                            raise HTTPException(400, "Invalid compressed response") from None
                    total += len(chunk)
                    if total > maximum:
                        raise HTTPException(status_code=413, detail="URL response too large")
                    chunks.append(chunk)
                if decoder and not decoder.eof:
                    raise HTTPException(400, "Incomplete compressed response")
                return b"".join(chunks), current, response.encoding
    raise HTTPException(status_code=400, detail="Excessive redirect chain")
