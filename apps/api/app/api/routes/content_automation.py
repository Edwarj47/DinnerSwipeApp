from __future__ import annotations

from collections.abc import Callable, Coroutine
from typing import Annotated, Any
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, Request, Response
from fastapi.encoders import jsonable_encoder
from fastapi.exceptions import RequestValidationError
from fastapi.routing import APIRoute
from starlette.responses import JSONResponse

from app.api.deps import BasicUser, DbDep
from app.core.rate_limit import auth_rate_limiter
from app.models.entities import User
from app.schemas.content_automation import (
    AutomationOverview,
    BatchDetail,
    CampaignPatch,
    DecisionsInput,
    DismissSourcesInput,
    SourcesOverview,
)
from app.services import content_automation as service
from app.services import content_discovery
from app.services.content_automation_access import require_owner


class PrivateRoute(APIRoute):
    def get_route_handler(self) -> Callable[[Request], Coroutine[Any, Any, Response]]:
        handler = super().get_route_handler()

        async def private_handler(request: Request) -> Response:
            try:
                response = await handler(request)
            except HTTPException as exc:
                response = JSONResponse(
                    {"detail": exc.detail}, status_code=exc.status_code, headers=exc.headers
                )
            except RequestValidationError as exc:
                response = JSONResponse({"detail": jsonable_encoder(exc.errors())}, status_code=422)
            response.headers["Cache-Control"] = "no-store"
            return response

        return private_handler


router = APIRouter(
    prefix="/content-automation", tags=["content-automation"], route_class=PrivateRoute
)


def get_automation_user(current_user: BasicUser) -> User:
    require_owner(current_user.id)
    if not current_user.email_verified:
        raise HTTPException(403, "Verify your email before reviewing automated content.")
    auth_rate_limiter.check(f"content-automation:access:{current_user.id}", 120, 60)
    return current_user


AutomationUser = Annotated[User, Depends(get_automation_user)]


@router.get("", response_model=AutomationOverview)
def overview(db: DbDep, current_user: AutomationUser) -> dict[str, Any]:
    return service.overview(db, current_user)


@router.get("/sources", response_model=SourcesOverview)
def sources(db: DbDep, current_user: AutomationUser) -> dict[str, Any]:
    return content_discovery.overview(db, current_user)


@router.post("/sources/{run_id}/dismiss", response_model=SourcesOverview)
def dismiss_sources(
    run_id: UUID, payload: DismissSourcesInput, db: DbDep, current_user: AutomationUser
) -> dict[str, Any]:
    auth_rate_limiter.check(f"content-automation:decisions:{current_user.id}", 30, 60)
    try:
        result = content_discovery.dismiss(db, current_user, str(run_id), payload.source_ids)
        db.commit()
        return result
    except Exception:
        db.rollback()
        raise


@router.get("/batches/{batch_id}", response_model=BatchDetail)
def batch(batch_id: UUID, db: DbDep, current_user: AutomationUser) -> dict[str, Any]:
    return service.batch_detail(db, current_user, str(batch_id))


@router.post("/batches/{batch_id}/decisions", response_model=BatchDetail)
def decisions(
    batch_id: UUID, payload: DecisionsInput, db: DbDep, current_user: AutomationUser
) -> dict[str, Any]:
    auth_rate_limiter.check(f"content-automation:decisions:{current_user.id}", 30, 60)
    try:
        result = service.decide(
            db,
            current_user,
            str(batch_id),
            payload.action,
            [str(value) for value in payload.candidate_ids],
        )
        db.commit()
        return result
    except Exception:
        db.rollback()
        raise


@router.patch("/campaign", response_model=AutomationOverview)
def campaign(payload: CampaignPatch, db: DbDep, current_user: AutomationUser) -> dict[str, Any]:
    auth_rate_limiter.check(f"content-automation:campaign:{current_user.id}", 30, 60)
    try:
        result = service.set_paused(db, current_user, payload.paused)
        db.commit()
        return result
    except Exception:
        db.rollback()
        raise
