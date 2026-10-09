from __future__ import annotations

import logging
import time

from sqlalchemy import select

from app.core.rate_limit import auth_rate_limiter
from app.database.session import SessionLocal
from app.models.entities import User, UserProfile
from app.services.media_maintenance import cleanup_media
from app.services.planning import SETTINGS_KEY, reconcile_current_plan

logger = logging.getLogger(__name__)


def process_weekly_resets() -> None:
    with SessionLocal() as db:
        users = list(
            db.scalars(
                select(UserProfile.user_id).where(
                    UserProfile.notification_preferences[SETTINGS_KEY]["mode"].as_string()
                    == "automatic"
                )
            )
        )
    for user_id in users:
        try:
            with SessionLocal() as db:
                user = db.get(User, user_id)
                if user:
                    reconcile_current_plan(db, user)
        except Exception:
            logger.exception("Weekly planning reconciliation failed for account %s", user_id)


def main() -> None:
    logging.basicConfig(level=logging.INFO)
    maintenance_at = 0.0
    while True:
        try:
            process_weekly_resets()
            if time.monotonic() >= maintenance_at:
                auth_rate_limiter.prune()
                with SessionLocal() as db:
                    cleanup_media(db)
                maintenance_at = time.monotonic() + 3600
        except Exception:
            logger.exception("Weekly planning scan failed")
        time.sleep(60)


if __name__ == "__main__":
    main()
