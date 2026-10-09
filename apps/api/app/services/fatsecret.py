from __future__ import annotations

import json
import threading
import time
from datetime import UTC, datetime
from email.utils import parsedate_to_datetime
from typing import Any

import httpx

from app.core.actor import current_actor
from app.core.config import Settings
from app.services.nutrition_budget import NutritionBudget, NutritionError
from app.services.nutrition_cache import TemporaryNutritionCache

TOKEN_URL = "https://oauth.fatsecret.com/connect/token"
API_URL = "https://platform.fatsecret.com/rest/server.api"
ATTRIBUTION = {"name": "Powered by fatsecret", "url": "https://www.fatsecret.com"}


class FatSecretClient:
    def __init__(self, config: Settings, budget: NutritionBudget) -> None:
        self.config = config
        self.budget = budget
        self.cache = TemporaryNutritionCache()
        self.lock = threading.RLock()
        self.token = ""
        self.token_until = 0.0
        self.http = httpx.Client(timeout=10, follow_redirects=False)

    def _reserve(self, kind: str, background: bool) -> str:
        for _ in range(3):
            try:
                actor = current_actor.get()
                if not background and (
                    actor is None or not actor.premium or not actor.nutrition_consent
                ):
                    raise NutritionError("account_not_authorized")
                return self.budget.reserve(
                    kind, background, user_id=actor.user_id if actor and not background else None
                )
            except NutritionError as error:
                if error.code != "paced":
                    raise
                time.sleep(min(error.retry_seconds, 2))
        raise NutritionError("busy", 3)

    def _send(
        self, kind: str, data: dict[str, str], background: bool, *, token: bool = False
    ) -> dict[str, Any]:
        call_id = self._reserve(kind, background)
        try:
            auth = (
                httpx.BasicAuth(
                    self.config.fatsecret_client_id.get_secret_value(),
                    self.config.fatsecret_client_secret.get_secret_value(),
                )
                if token
                else None
            )
            headers = {} if token else {"Authorization": f"Bearer {self.token}"}
            with self.http.stream(
                "POST", TOKEN_URL if token else API_URL, data=data, auth=auth, headers=headers
            ) as response:
                status = response.status_code
                if status == 429:
                    delay = 86400
                    retry = response.headers.get("Retry-After", "")
                    try:
                        delay = max(delay, int(retry))
                    except ValueError:
                        try:
                            date = parsedate_to_datetime(retry)
                            delay = max(delay, int((date - datetime.now(UTC)).total_seconds()))
                        except (ValueError, TypeError, OverflowError):
                            pass
                    self.budget.pause("rate_limited", delay)
                    raise NutritionError("rate_limited", delay)
                if status in (401, 403):
                    self.token = ""
                    self.budget.pause("credentials_or_scope", 3600)
                    raise NutritionError("credentials_or_scope", 3600)
                if status >= 500:
                    self.budget.pause("provider_unavailable", 300)
                    raise NutritionError("provider_unavailable", 300)
                if token and status != 200:
                    self.budget.pause("credentials_or_scope", 3600)
                    raise NutritionError("credentials_or_scope", 3600)
                if status != 200:
                    raise NutritionError("request_rejected")
                body = bytearray()
                for chunk in response.iter_bytes():
                    body.extend(chunk)
                    if len(body) > 2_097_152:
                        raise NutritionError("response_too_large")
                payload = json.loads(body)
                if not isinstance(payload, dict):
                    raise NutritionError("invalid_response")
                error = payload.get("error")
                if isinstance(error, dict):
                    code = str(error.get("code", ""))
                    failures = {
                        "11": ("rate_limited", 86400),
                        "12": ("rate_limited", 86400),
                        "14": ("missing_scope", 3600),
                        "20": ("provider_unavailable", 300),
                        "21": ("ip_not_authorized", 3600),
                    }
                    if code in failures:
                        reason, delay = failures[code]
                        self.budget.pause(reason, delay)
                        raise NutritionError(reason, delay)
                    if code in ("4", "5", "8", "9", "10", "13"):
                        self.budget.pause("credentials_or_scope", 3600)
                        raise NutritionError("credentials_or_scope", 3600)
                    raise NutritionError("food_not_found" if code == "106" else "request_rejected")
            self.budget.finish(call_id, "success")
            return payload
        except NutritionError as error:
            self.budget.finish(call_id, error.code)
            raise
        except (httpx.HTTPError, ValueError):
            self.budget.finish(call_id, "network_or_response")
            self.budget.pause("network_or_response", 60)
            raise NutritionError("network_or_response") from None

    def _authenticate(self, background: bool) -> None:
        if not self.config.fatsecret_configured:
            raise NutritionError("not_configured")
        if self.token and self.token_until > time.monotonic():
            return
        payload = self._send(
            "oauth", {"grant_type": "client_credentials", "scope": "basic"}, background, token=True
        )
        value = payload.get("access_token")
        try:
            lifetime = int(payload.get("expires_in", 0))
        except (TypeError, ValueError):
            lifetime = 0
        if not isinstance(value, str) or not value or lifetime <= 60:
            raise NutritionError("invalid_authentication")
        self.token = value
        self.token_until = time.monotonic() + min(lifetime - 60, 82800)

    def request(
        self,
        method: str,
        parameters: dict[str, str],
        *,
        background: bool = False,
        refresh: bool = False,
    ) -> dict[str, Any]:
        actor = current_actor.get()
        if not background and (actor is None or not actor.premium or not actor.nutrition_consent):
            raise NutritionError("account_not_authorized")
        if not self.config.fatsecret_configured:
            raise NutritionError("not_configured")
        if method not in ("foods.search", "food.get.v5"):
            raise NutritionError("unsupported_method")
        key = method + repr(sorted(parameters.items()))
        with self.lock:
            cached = self.cache.get(key)
            if cached is not None and not refresh:
                return cached
            started = time.monotonic()
            self._authenticate(background)
            payload = self._send(
                method, {"method": method, "format": "json", **parameters}, background
            )
            if method == "food.get.v5" and (
                not isinstance(payload.get("food"), dict)
                or str(payload["food"].get("food_id")) != parameters.get("food_id")
            ):
                raise NutritionError("invalid_response")
            self.cache.put(
                key, payload, self.config.fatsecret_cache_seconds - (time.monotonic() - started)
            )
            return payload
