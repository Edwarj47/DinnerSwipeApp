from __future__ import annotations

import time
from dataclasses import dataclass, field

from fastapi import HTTPException, Request, status


@dataclass
class WindowCounter:
    reset_at: float
    count: int = 0


@dataclass
class InMemoryRateLimiter:
    counters: dict[str, WindowCounter] = field(default_factory=dict)

    def check(self, key: str, limit: int, window_seconds: int) -> None:
        now = time.monotonic()
        counter = self.counters.get(key)
        if not counter or counter.reset_at <= now:
            self.counters[key] = WindowCounter(reset_at=now + window_seconds, count=1)
            self._prune(now)
            return
        counter.count += 1
        if counter.count > limit:
            retry_after = max(1, int(counter.reset_at - now))
            raise HTTPException(
                status_code=status.HTTP_429_TOO_MANY_REQUESTS,
                detail="Too many attempts. Please wait and try again.",
                headers={"Retry-After": str(retry_after)},
            )

    def _prune(self, now: float) -> None:
        if len(self.counters) < 10_000:
            return
        expired = [key for key, counter in self.counters.items() if counter.reset_at <= now]
        for key in expired:
            self.counters.pop(key, None)


auth_rate_limiter = InMemoryRateLimiter()


def client_identifier(request: Request) -> str:
    forwarded_for = request.headers.get("x-forwarded-for", "")
    if forwarded_for:
        return forwarded_for.split(",", maxsplit=1)[0].strip()
    if request.client and request.client.host:
        return request.client.host
    return "unknown"


def check_auth_rate_limit(
    request: Request,
    action: str,
    subject: str,
    *,
    ip_limit: int = 60,
    subject_limit: int = 8,
    window_seconds: int = 60,
) -> None:
    ip = client_identifier(request)
    normalized_subject = subject.lower().strip() or "anonymous"
    auth_rate_limiter.check(f"auth:{action}:ip:{ip}", ip_limit, window_seconds)
    auth_rate_limiter.check(
        f"auth:{action}:subject:{ip}:{normalized_subject}", subject_limit, window_seconds
    )
