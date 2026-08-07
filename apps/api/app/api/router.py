from __future__ import annotations

from fastapi import APIRouter

from app.api.routes import (
    auth,
    grocery,
    groups,
    health,
    imports,
    ingestion,
    plans,
    premium,
    profile,
    recipes,
)

api_router = APIRouter(prefix="/api/v1")
api_router.include_router(health.router)
api_router.include_router(auth.router)
api_router.include_router(profile.router)
api_router.include_router(recipes.router)
api_router.include_router(plans.router)
api_router.include_router(grocery.router)
api_router.include_router(imports.router)
api_router.include_router(ingestion.router)
api_router.include_router(groups.router)
api_router.include_router(premium.router)
