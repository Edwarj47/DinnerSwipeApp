from datetime import UTC, datetime, timedelta
from uuid import uuid4

from fastapi.testclient import TestClient
from sqlalchemy.orm import Session

from app.core.security import create_access_token
from app.models.entities import MealMacroConfirmation, OfflineReceipt, User, UserSubscription


def premium(db: Session) -> None:
    row = db.query(UserSubscription).one()
    row.plan_key = "macro_tracker_monthly"
    db.commit()


def operation(**kwargs: object) -> dict[str, object]:
    return {"operation_id": str(uuid4()), **kwargs}


def test_macro_retry_is_atomic_and_versions_detect_conflict(
    client: TestClient,
    auth_headers: dict[str, str],
    db_session: Session,
) -> None:
    premium(db_session)
    edit = operation(
        kind="macro_create",
        values={
            "entry_name": "Shake",
            "meal_date": "2026-10-03",
            "calories": 160,
            "protein_g": 30,
            "carbs_g": 4,
            "fat_g": 3,
            "fiber_g": 2,
        },
    )
    first = client.post("/api/v1/offline/sync", json=edit, headers=auth_headers)
    assert first.status_code == 200, first.text
    row = first.json()["result"]
    assert row["id"] == edit["operation_id"]
    assert (
        client.post("/api/v1/offline/sync", json=edit, headers=auth_headers).json() == first.json()
    )
    assert db_session.query(MealMacroConfirmation).count() == 1
    assert db_session.query(OfflineReceipt).count() == 1
    changed = {**edit, "values": {"entry_name": "Other"}}
    assert (
        client.post("/api/v1/offline/sync", json=changed, headers=auth_headers).status_code == 409
    )
    update = operation(
        kind="macro_update", target_id=row["id"], revision=row["revision"], values={"protein_g": 40}
    )
    updated = client.post("/api/v1/offline/sync", json=update, headers=auth_headers)
    assert updated.status_code == 200, updated.text
    saved = db_session.get(MealMacroConfirmation, row["id"])
    assert saved is not None and saved.protein_g == 40
    assert set(updated.json()["result"]) == {"id", "revision", "status"}
    stale = operation(kind="macro_delete", target_id=row["id"], revision=row["revision"])
    assert client.post("/api/v1/offline/sync", json=stale, headers=auth_headers).status_code == 409
    stale["revision"] = updated.json()["result"]["revision"]
    assert client.post("/api/v1/offline/sync", json=stale, headers=auth_headers).status_code == 200
    assert client.post("/api/v1/offline/sync", json=stale, headers=auth_headers).status_code == 200
    # Replaying an acknowledged create after deletion must not resurrect the entry.
    assert client.post("/api/v1/offline/sync", json=edit, headers=auth_headers).status_code == 200
    assert db_session.query(MealMacroConfirmation).count() == 0
    for receipt in db_session.query(OfflineReceipt):
        result = receipt.result["result"]
        assert isinstance(result, dict) and "protein_g" not in result


def test_grocery_sync_rejects_stale_missing_and_invalid_updates(
    client: TestClient,
    auth_headers: dict[str, str],
    db_session: Session,
) -> None:
    client.post(
        "/api/v1/grocery-lists/current/items", headers=auth_headers, json={"display_name": "Milk"}
    )
    row = client.get("/api/v1/grocery-lists/current", headers=auth_headers).json()["items"][0]
    edit = operation(
        kind="grocery_update",
        target_id=row["id"],
        revision=row["revision"],
        values={"is_checked": True},
    )
    assert client.post("/api/v1/offline/sync", json=edit, headers=auth_headers).status_code == 200
    assert client.post("/api/v1/offline/sync", json=edit, headers=auth_headers).status_code == 200
    edit["operation_id"] = str(uuid4())
    assert client.post("/api/v1/offline/sync", json=edit, headers=auth_headers).status_code == 409
    edit["target_id"] = str(uuid4())
    assert client.post("/api/v1/offline/sync", json=edit, headers=auth_headers).status_code == 404
    assert db_session.query(OfflineReceipt).count() == 1
    row = client.get("/api/v1/grocery-lists/current", headers=auth_headers).json()["items"][0]
    edit.update(target_id=row["id"], revision=row["revision"], values={"quantity": -2})
    assert client.post("/api/v1/offline/sync", json=edit, headers=auth_headers).status_code == 422


def test_sync_requires_current_access_and_limits_lease(
    client: TestClient,
    auth_headers: dict[str, str],
    db_session: Session,
) -> None:
    edit = operation(kind="macro_create", values={})
    assert client.post("/api/v1/offline/sync", json=edit).status_code == 401
    assert client.post("/api/v1/offline/sync", json=edit, headers=auth_headers).status_code == 402
    status = client.get("/api/v1/subscription/status", headers=auth_headers).json()
    until = datetime.fromisoformat(status["offline_until"].replace("Z", "+00:00"))
    assert 71 <= (until - datetime.now(UTC)).total_seconds() / 3600 <= 72
    assert status["offline_sync_version"] == 1
    row = db_session.query(UserSubscription).one()
    row.current_period_end = datetime.now(UTC).replace(tzinfo=None) + timedelta(hours=2)
    db_session.commit()
    status = client.get("/api/v1/subscription/status", headers=auth_headers).json()
    assert (
        datetime.fromisoformat(status["offline_until"].replace("Z", "+00:00")).replace(tzinfo=None)
        == row.current_period_end
    )
    row.status = "inactive"
    db_session.commit()
    assert (
        client.get("/api/v1/subscription/status", headers=auth_headers).json()["offline_until"]
        is None
    )


def test_invalid_macro_does_not_leave_a_receipt(
    client: TestClient,
    auth_headers: dict[str, str],
    db_session: Session,
) -> None:
    premium(db_session)
    edit = operation(kind="macro_create", values={"meal_date": "2026-10-03", "calories": -1})
    assert client.post("/api/v1/offline/sync", json=edit, headers=auth_headers).status_code == 422
    assert db_session.query(MealMacroConfirmation).count() == 0
    assert db_session.query(OfflineReceipt).count() == 0


def test_sync_enforces_ownership_and_rechecks_premium_on_retry(
    client: TestClient,
    auth_headers: dict[str, str],
    db_session: Session,
) -> None:
    premium(db_session)
    edit = operation(
        kind="macro_create",
        values={
            "meal_date": "2026-10-03",
            "entry_name": "Private meal",
            "calories": 160,
            "protein_g": 30,
            "carbs_g": None,
            "fat_g": 0,
            "fiber_g": None,
        },
    )
    row = client.post("/api/v1/offline/sync", json=edit, headers=auth_headers).json()["result"]
    client.post(
        "/api/v1/grocery-lists/current/items", headers=auth_headers, json={"display_name": "Milk"}
    )
    grocery = client.get("/api/v1/grocery-lists/current", headers=auth_headers).json()["items"][0]
    other = User(email="other@example.com", password_hash=str(uuid4()), email_verified=True)
    db_session.add(other)
    db_session.flush()
    db_session.add(
        UserSubscription(
            user_id=other.id,
            plan_key="macro_tracker_monthly",
            status="active",
            source="waiver_code",
        )
    )
    db_session.commit()
    other_headers = {"Authorization": f"Bearer {create_access_token(other.id)}"}
    for kind, target, revision, expected in [
        ("macro_update", row["id"], row["revision"], 409),
        ("grocery_update", grocery["id"], grocery["revision"], 404),
    ]:
        attack = operation(kind=kind, target_id=target, revision=revision, values={})
        assert (
            client.post("/api/v1/offline/sync", headers=other_headers, json=attack).status_code
            == expected
        )
    assert (
        client.get("/api/v1/auth/account/export", headers=other_headers).json()[
            "offline_sync_receipts"
        ]
        == []
    )
    assert (
        len(
            client.get("/api/v1/auth/account/export", headers=auth_headers).json()[
                "offline_sync_receipts"
            ]
        )
        == 1
    )
    subscription = (
        db_session.query(UserSubscription).filter(UserSubscription.user_id != other.id).one()
    )
    subscription.plan_key = "basic_monthly"
    db_session.commit()
    assert client.post("/api/v1/offline/sync", json=edit, headers=auth_headers).status_code == 402
