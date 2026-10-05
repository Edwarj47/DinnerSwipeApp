from __future__ import annotations

import logging
import time

from sqlalchemy import select

from app.database.session import SessionLocal
from app.models.entities import User, UserProfile
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
    while True:
        try:
            process_weekly_resets()
        except Exception:
            logger.exception("Weekly planning scan failed")
        time.sleep(60)


if __name__ == "__main__":
    main()
