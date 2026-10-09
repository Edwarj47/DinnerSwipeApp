from __future__ import annotations

import secrets
from hmac import compare_digest

from fastapi import HTTPException, Request, Response

from app.core.config import settings
from app.schemas.common import TokenPair

PREFIX = "__Host-ds_" if settings.app_env == "production" else "ds_"
ACCESS_COOKIE = PREFIX + "access"
REFRESH_COOKIE = PREFIX + "refresh"
CSRF_COOKIE = PREFIX + "csrf"


def cookie_mode(request: Request) -> bool:
    return request.headers.get("x-dinner-web-session") == "cookie"


def verify_web_origin(request: Request) -> None:
    if request.headers.get("origin") not in settings.allowed_origin_list:
        raise HTTPException(403, "This browser origin is not allowed.")


def verify_csrf(request: Request) -> None:
    verify_web_origin(request)
    cookie = request.cookies.get(CSRF_COOKIE, "")
    header = request.headers.get("x-csrf-token", "")
    if not cookie or not header or not compare_digest(cookie, header):
        raise HTTPException(403, "Your session needs to refresh. Please try again.")


def session_response(pair: TokenPair, request: Request, response: Response) -> TokenPair:
    response.headers["Cache-Control"] = "no-store"
    if not cookie_mode(request):
        return pair
    verify_web_origin(request)
    csrf = secrets.token_urlsafe(32)
    for name, value, age, httponly in (
        (ACCESS_COOKIE, pair.access_token, settings.access_token_minutes * 60, True),
        (REFRESH_COOKIE, pair.refresh_token, settings.refresh_token_days * 86400, True),
        (CSRF_COOKIE, csrf, settings.refresh_token_days * 86400, False),
    ):
        response.set_cookie(
            name,
            value,
            max_age=age,
            secure=settings.app_env == "production",
            httponly=httponly,
            samesite="lax",
            path="/",
        )
    return TokenPair(access_token="", refresh_token="", web_session=True)


def clear_session_cookies(response: Response) -> None:
    for name in (ACCESS_COOKIE, REFRESH_COOKIE, CSRF_COOKIE):
        response.delete_cookie(
            name,
            path="/",
            secure=settings.app_env == "production",
            httponly=name != CSRF_COOKIE,
            samesite="lax",
        )
    response.headers["Cache-Control"] = "no-store"
