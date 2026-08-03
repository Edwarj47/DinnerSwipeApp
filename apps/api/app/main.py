from __future__ import annotations

from pathlib import Path

import structlog
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles

from app.api.router import api_router
from app.core.config import settings

structlog.configure(processors=[structlog.processors.JSONRenderer()])
logger = structlog.get_logger()
Path(settings.image_storage_path).mkdir(parents=True, exist_ok=True)

app = FastAPI(title="Dinner Swipe API", version="0.1.0")
app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.allowed_origin_list,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)
app.include_router(api_router)
app.mount("/media", StaticFiles(directory=settings.image_storage_path), name="media")


@app.on_event("startup")
def startup() -> None:
    logger.info("api_startup", env=settings.app_env)
