from __future__ import annotations

from fastapi import APIRouter

from app.api.routes import (
    ai_recipes,
    auth,
    brand,
    grocery,
    group_planning,
    groups,
    health,
    imports,
    ingestion,
    media,
    nutrition,
    offline,
    plans,
    premium,
    profile,
    recipes,
)

api_router = APIRouter(prefix="/api/v1")
api_router.include_router(ai_recipes.router)
api_router.include_router(health.router)
api_router.include_router(brand.router)
api_router.include_router(auth.router)
api_router.include_router(profile.router)
api_router.include_router(recipes.router)
api_router.include_router(plans.router)
api_router.include_router(grocery.router)
api_router.include_router(grocery.group_router)
api_router.include_router(imports.router)
api_router.include_router(ingestion.router)
api_router.include_router(groups.router)
api_router.include_router(group_planning.router)
api_router.include_router(group_planning.reminder_router)
api_router.include_router(premium.router)
api_router.include_router(offline.router)
api_router.include_router(nutrition.router)
api_router.include_router(media.router)
