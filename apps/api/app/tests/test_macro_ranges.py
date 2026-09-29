from datetime import date, timedelta

from fastapi.testclient import TestClient
from sqlalchemy.orm import Session

from app.models.entities import MealMacroConfirmation, User, UserSubscription
from app.services.billing import PREMIUM_PLAN_KEY


def enable_premium(db: Session) -> None:
    subscription = db.query(UserSubscription).one()
    subscription.plan_key = PREMIUM_PLAN_KEY
    db.commit()


def test_exact_date_and_all_time_export_are_complete_and_user_scoped(
    client: TestClient, auth_headers: dict[str, str], db_session: Session
) -> None:
    enable_premium(db_session)
    old_date = date.today() - timedelta(days=500)
    old = client.post(
        "/api/v1/macros/entries",
        headers=auth_headers,
        json={
            "entry_name": "Old breakfast",
            "meal_label": "breakfast",
            "meal_date": str(old_date),
            "calories": 250,
            "protein_g": 15,
        },
    )
    assert old.status_code == 200
    current = client.post(
        "/api/v1/macros/entries",
        headers=auth_headers,
        json={
            "entry_name": "Today's lunch",
            "meal_date": str(date.today()),
            "calories": 500,
        },
    )
    assert current.status_code == 200
    owner = db_session.query(User).filter_by(email="owner@example.com").one()
    other = User(email="other-macro@example.com", password_hash=owner.password_hash)
    db_session.add(other)
    db_session.flush()
    db_session.add(
        MealMacroConfirmation(
            user_id=other.id,
            meal_date=date(1901, 1, 1),
            entry_name="Private other entry",
            calories=999,
            status="ate",
            servings_consumed=1,
            macro_source="manual",
        )
    )
    db_session.commit()

    exact = client.get(
        f"/api/v1/macros/entries?start_date={old_date}&end_date={old_date}", headers=auth_headers
    )
    assert exact.status_code == 200
    assert [item["entry_name"] for item in exact.json()] == ["Old breakfast"]
    recent = client.get("/api/v1/macros/analytics?days=365", headers=auth_headers).json()
    assert recent["totals"]["calories"] == 500
    assert recent["days"] == 365
    assert len(recent["daily_totals"]) == 365

    analytics = client.get("/api/v1/macros/analytics?all_time=true", headers=auth_headers)
    assert analytics.status_code == 200
    body = analytics.json()
    assert body["totals"]["calories"] == 750
    assert body["start_date"] == str(old_date)
    assert body["days"] == 501
    assert body["days_logged"] == 2
    assert len(body["daily_totals"]) == 2
    assert body["includes_empty_days"] is False
    exported = client.get("/api/v1/macros/export?all_time=true", headers=auth_headers).json()
    assert exported["analytics"] == body
    assert {row["id"] for row in exported["entries"]} == {old.json()["id"], current.json()["id"]}


def test_macro_ranges_reject_invalid_ranges_and_stay_premium_only(
    client: TestClient, auth_headers: dict[str, str], db_session: Session
) -> None:
    assert (
        client.get("/api/v1/macros/analytics?all_time=true", headers=auth_headers).status_code
        == 402
    )
    assert (
        client.get("/api/v1/macros/export?all_time=true", headers=auth_headers).status_code == 402
    )
    enable_premium(db_session)
    for query in (
        "start_date=2026-01-03&end_date=2026-01-01",
        "start_date=bad",
        "days=0",
        "days=367",
        "start_date=1900-01-01&end_date=2026-01-01",
        "all_time=true&start_date=2026-01-01",
        "days=365&end_date=0001-01-01",
    ):
        response = client.get(f"/api/v1/macros/analytics?{query}", headers=auth_headers)
        assert response.status_code == 422, query
    empty = client.get("/api/v1/macros/export?all_time=true", headers=auth_headers).json()
    assert empty["entries"] == []
    assert empty["analytics"]["daily_totals"] == []
    assert empty["analytics"]["totals"]["calories"] == 0


def test_custom_range_is_inclusive_and_export_matches_analysis(
    client: TestClient, auth_headers: dict[str, str], db_session: Session
) -> None:
    enable_premium(db_session)
    for day in ["2024-02-28", "2024-02-29", "2024-03-01"]:
        response = client.post(
            "/api/v1/macros/entries",
            headers=auth_headers,
            json={
                "entry_name": "Leap year meal",
                "meal_date": day,
                "calories": 100,
            },
        )
        assert response.status_code == 200
    query = "start_date=2024-02-28&end_date=2024-02-29"
    body = client.get(f"/api/v1/macros/export?{query}", headers=auth_headers).json()
    assert body["days"] == 2
    assert len(body["entries"]) == 2
    assert body["analytics"]["totals"]["calories"] == 200
    assert body["analytics"]["end_date"] == "2024-02-29"
