from __future__ import annotations

import argparse
import json

from app.core.rate_limit import auth_rate_limiter
from app.database.session import SessionLocal
from app.services.media_maintenance import backfill_local_media, cleanup_media


def main() -> None:
    parser = argparse.ArgumentParser(description="Dinner Swipe security maintenance")
    parser.add_argument("--backfill-media", action="store_true")
    args = parser.parse_args()
    with SessionLocal() as db:
        if args.backfill_media:
            print(json.dumps(backfill_local_media(db)))
        else:
            print(json.dumps({"media_deleted": cleanup_media(db)}))
    auth_rate_limiter.prune()


if __name__ == "__main__":
    main()
