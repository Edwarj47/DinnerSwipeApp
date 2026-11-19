from typing import Annotated

from fastapi import APIRouter, Depends, Header, HTTPException, Request

from app.api.deps import DbDep, VerifiedUser
from app.api.routes.premium import private_response
from app.core.config import settings
from app.core.rate_limit import auth_rate_limiter, client_identifier
from app.schemas.native_billing import AppleNotificationIn, NativeVerificationIn
from app.services import native_billing

router = APIRouter(
    prefix="/subscription/native", tags=["native billing"], dependencies=[Depends(private_response)]
)


@router.get("/context")
def context(db: DbDep, user: VerifiedUser) -> dict[str, object]:
    auth_rate_limiter.check(f"native-context:{user.id}", 30, 60)
    return native_billing.native_context(db, user)


@router.post("/verify")
def verify(
    payload: NativeVerificationIn, request: Request, db: DbDep, user: VerifiedUser
) -> dict[str, object]:
    auth_rate_limiter.reserve(
        [
            (f"native-verify:user:{user.id}", 6, 60),
            (f"native-verify:ip:{client_identifier(request)}", 20, 60),
            ("native-verify:global", 60, 60),
            ("native-verify:global-hour", 600, 3600),
        ]
    )
    return native_billing.verify_purchase(db, user, payload.provider, payload.reference)


@router.post("/apple/notifications")
def apple_notifications(
    payload: AppleNotificationIn, request: Request, db: DbDep
) -> dict[str, str]:
    notification_budget(request, "apple")
    return {"status": native_billing.apple_notification(db, payload.signedPayload)}


def notification_budget(request: Request, provider: str) -> None:
    limit = settings.native_notification_requests_per_minute
    auth_rate_limiter.reserve(
        [
            (f"native-notification:{provider}:global", limit, 60),
            (f"native-notification:{provider}:ip:{client_identifier(request)}", limit, 60),
        ]
    )


@router.post("/google/notifications")
async def google_notifications(
    request: Request,
    db: DbDep,
    authorization: Annotated[str | None, Header()] = None,
) -> dict[str, str]:
    notification_budget(request, "google")
    body = bytearray()
    async for part in request.stream():
        body.extend(part)
        if len(body) > 131072:
            raise HTTPException(413, "Notification is too large.")
    return {"status": native_billing.google_notification(db, authorization, bytes(body))}
