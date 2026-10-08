from __future__ import annotations

import argparse
import json

from app.services.nutrition import nutrition_budget, nutrition_client, refresh_used_foods
from app.services.nutrition_budget import NutritionError


def main() -> None:
    parser = argparse.ArgumentParser(description="Dinner Swipe usage-driven nutrition maintenance")
    parser.add_argument("--status", action="store_true")
    parser.add_argument("--verify-auth", action="store_true")
    args = parser.parse_args()
    if args.verify_auth:
        try:
            nutrition_client._authenticate(background=True)
            print(json.dumps({"authentication": "success"}))
        except NutritionError as error:
            print(json.dumps({"authentication": "failed", "code": error.code}))
            raise SystemExit(1) from None
    elif not args.status:
        result = refresh_used_foods()
        print(json.dumps(result))
        if result["status"] == "stopped":
            print(json.dumps(nutrition_budget.status()))
            raise SystemExit(1)
    print(json.dumps(nutrition_budget.status()))


if __name__ == "__main__":
    main()
