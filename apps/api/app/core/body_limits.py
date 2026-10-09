from __future__ import annotations

import asyncio
import tempfile

from starlette.responses import JSONResponse
from starlette.types import ASGIApp, Message, Receive, Scope, Send


class RequestBodyLimitMiddleware:
    """Bound streamed bytes before Starlette's body/multipart parsers run."""

    def __init__(self, app: ASGIApp) -> None:
        self.app = app

    async def __call__(self, scope: Scope, receive: Receive, send: Send) -> None:
        if scope["type"] != "http":
            await self.app(scope, receive, send)
            return
        headers = dict(scope.get("headers", []))
        limit = (
            262144
            if scope["path"].rstrip("/") == "/api/v1/premium/stripe/webhook"
            else (
                16777216
                if headers.get(b"content-type", b"").lower().startswith(b"multipart/form-data")
                else 1048576
            )
        )
        try:
            length = int(headers.get(b"content-length", b"0"))
        except ValueError:
            await JSONResponse({"detail": "Invalid Content-Length"}, 400)(scope, receive, send)
            return
        if length < 0 or length > limit:
            await JSONResponse({"detail": "Request body too large"}, 413)(scope, receive, send)
            return
        with tempfile.SpooledTemporaryFile(max_size=262144) as body:
            total = 0
            try:
                async with asyncio.timeout(120):
                    while True:
                        message = await receive()
                        if message["type"] == "http.disconnect":
                            return
                        chunk = message.get("body", b"")
                        total += len(chunk)
                        if total > limit:
                            await JSONResponse({"detail": "Request body too large"}, 413)(
                                scope, receive, send
                            )
                            return
                        body.write(chunk)
                        if not message.get("more_body", False):
                            break
            except TimeoutError:
                await JSONResponse({"detail": "Upload timed out"}, 408)(scope, receive, send)
                return
            body.seek(0)
            delivered = False

            async def bounded_receive() -> Message:
                nonlocal delivered
                if delivered:
                    return await receive()
                chunk = body.read(65536)
                delivered = body.tell() >= total
                return {"type": "http.request", "body": chunk, "more_body": not delivered}

            await self.app(scope, bounded_receive, send)
