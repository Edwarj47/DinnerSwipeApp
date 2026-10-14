from typing import Any
from uuid import uuid4

from fastapi.testclient import TestClient
from sqlalchemy.orm import Session

from app.models.entities import HouseholdMember
from app.models.workouts import WorkoutLog
from app.services.workouts import account_export
from app.tests.test_workouts import BASE, TEMPLATE, WEEK, account, group, share, template
from app.tests.test_workouts import workout_client as workout_client


def test_title_only_and_structured_exercise_notes(
    workout_client: TestClient, db_session: Session
) -> None:
    _, headers = account(db_session, "minimum")
    minimal = workout_client.post(
        f"{BASE}/templates", headers=headers, json={"title": "Quick walk"}
    )
    assert minimal.status_code == 200
    assert minimal.json()["exercises"] == []
    routine = template(workout_client, headers)
    payload: dict[str, Any] = {
        "template_id": routine["id"],
        "performed_on": WEEK,
        "completed": True,
        "expected_revision": routine["revision"],
        "sets": [],
        "notes": "Session notes",
        "exercise_details": [
            {
                "exercise_index": 0,
                "completed": True,
                "notes": "Row: incomplete\n[Exercise details]\nNot metadata",
            }
        ],
    }
    saved = workout_client.put(f"{BASE}/logs/{uuid4()}", headers=headers, json=payload)
    assert saved.status_code == 200, saved.text
    assert saved.json()["exercise_details"] == payload["exercise_details"]
    assert saved.json()["notes"] == "Session notes"


def test_live_edits_reject_stale_logs_but_scheduled_snapshot_is_preserved(
    workout_client: TestClient, db_session: Session
) -> None:
    user, headers = account(db_session, "revision")
    routine = template(workout_client, headers)
    slot = workout_client.post(
        f"{BASE}/plans/slots",
        headers=headers,
        json={"template_id": routine["id"], "slot_date": WEEK},
    ).json()
    changed = workout_client.put(
        f"{BASE}/templates/{routine['id']}",
        headers=headers,
        json=TEMPLATE | {"exercises": [{"name": "Different exercise"}]},
    ).json()
    assert routine["revision"] != changed["revision"]
    values = {
        "template_id": routine["id"],
        "expected_revision": routine["revision"],
        "performed_on": WEEK,
        "completed": True,
        "sets": [{"exercise_index": 0, "set_number": 1, "reps": 8, "weight_kg": 40}],
    }
    assert (
        workout_client.put(f"{BASE}/logs/{uuid4()}", headers=headers, json=values).status_code
        == 409
    )
    request = uuid4()
    result = workout_client.put(
        f"{BASE}/logs/{request}", headers=headers, json=values | {"plan_slot_id": slot["id"]}
    )
    assert result.status_code == 200, result.text
    assert result.json()["snapshot"]["exercises"][0]["name"] == "Bench press"
    corrected = workout_client.put(
        f"{BASE}/logs/{request}", headers=headers, json=values | {"completed": False}
    )
    assert (
        corrected.status_code == 200
        and corrected.json()["snapshot"]["revision"] == routine["revision"]
    )
    assert (
        account_export(db_session, user)["performance_logs"][0]["routine"]["exercises"][0]["name"]
        == "Bench press"
    )


def test_slot_reference_and_export_do_not_grant_another_users_log_access(
    workout_client: TestClient, db_session: Session
) -> None:
    owner, owner_headers = account(db_session, "scope-owner")
    stranger, headers = account(db_session, "scope-stranger")
    routine = template(workout_client, owner_headers)
    slot = workout_client.post(
        f"{BASE}/plans/slots", headers=owner_headers, json={"template_id": routine["id"]}
    ).json()
    response = workout_client.put(
        f"{BASE}/logs/{uuid4()}",
        headers=headers,
        json={
            "template_id": routine["id"],
            "plan_slot_id": slot["id"],
            "performed_on": WEEK,
            "completed": True,
            "sets": [],
        },
    )
    assert response.status_code == 404
    assert account_export(db_session, stranger)["personal_weeks"] == []
    assert account_export(db_session, stranger)["templates"] == []
    assert account_export(db_session, owner)["templates"][0]["id"] == routine["id"]
    assert db_session.query(WorkoutLog).count() == 0


def test_reorder_validates_entire_scope_and_updates_atomically(
    workout_client: TestClient, db_session: Session
) -> None:
    _, headers = account(db_session, "reorder")
    routine = template(workout_client, headers)
    slots = [
        workout_client.post(
            f"{BASE}/plans/slots", headers=headers, json={"template_id": routine["id"]}
        ).json()["id"]
        for _ in range(2)
    ]
    assert (
        workout_client.patch(
            f"{BASE}/plans/reorder", headers=headers, json={"slot_ids": [slots[0], slots[0]]}
        ).status_code
        == 409
    )
    before = workout_client.get(f"{BASE}/plans/current", headers=headers).json()
    assert [row["id"] for row in before["slots"]] == slots
    result = workout_client.patch(
        f"{BASE}/plans/reorder", headers=headers, json={"slot_ids": slots[::-1]}
    )
    assert (
        result.status_code == 200 and [row["id"] for row in result.json()["slots"]] == slots[::-1]
    )


def test_logging_uses_selected_groups_snapshot_and_remains_private(
    workout_client: TestClient, db_session: Session
) -> None:
    owner, owner_headers = account(db_session, "multi-owner")
    member, member_headers = account(db_session, "multi-member")
    stranger, stranger_headers = account(db_session, "multi-stranger")
    first_group = group(db_session, owner, member, "First group")
    second_group = group(db_session, owner, member, "Second group")
    unrelated_group = group(db_session, stranger, member, "Unrelated group")
    first = template(workout_client, owner_headers)
    share(workout_client, owner_headers, first_group, first)
    second = workout_client.put(
        f"{BASE}/templates/{first['id']}",
        headers=owner_headers,
        json=TEMPLATE | {"exercises": [{"name": "Squat"}]},
    ).json()
    share(workout_client, owner_headers, second_group, second)
    workout_client.put(
        f"{BASE}/templates/{first['id']}",
        headers=owner_headers,
        json=TEMPLATE | {"exercises": [{"name": "Deadlift"}]},
    )
    for headers in (owner_headers, member_headers):
        for household, routine in ((first_group, first), (second_group, second)):
            result = workout_client.put(
                f"{BASE}/logs/{uuid4()}",
                headers=headers,
                json={
                    "template_id": routine["id"],
                    "household_id": household.id,
                    "expected_revision": routine["revision"],
                    "performed_on": WEEK,
                    "completed": True,
                    "sets": [{"exercise_index": 0, "set_number": 1, "reps": 8}],
                },
            )
            assert result.status_code == 200, result.text
            assert result.json()["snapshot"]["revision"] == routine["revision"]
            assert result.json()["snapshot"]["exercises"] == routine["exercises"]
    rejected = workout_client.put(
        f"{BASE}/logs/{uuid4()}",
        headers=stranger_headers,
        json={
            "template_id": first["id"],
            "household_id": first_group.id,
            "performed_on": WEEK,
            "completed": True,
            "sets": [],
        },
    )
    assert rejected.status_code == 404
    unshared = workout_client.put(
        f"{BASE}/logs/{uuid4()}",
        headers=member_headers,
        json={
            "template_id": first["id"],
            "household_id": unrelated_group.id,
            "performed_on": WEEK,
            "completed": True,
            "sets": [],
        },
    )
    assert unshared.status_code == 404
    assert db_session.query(WorkoutLog).count() == 4
    for headers in (owner_headers, member_headers):
        assert len(workout_client.get(f"{BASE}/logs", headers=headers).json()["items"]) == 2
    assert workout_client.get(f"{BASE}/logs", headers=stranger_headers).json()["items"] == []


def test_workout_reminders_include_only_current_memberships(
    workout_client: TestClient, db_session: Session
) -> None:
    owner, owner_headers = account(db_session, "reminders-owner")
    member, member_headers = account(db_session, "reminders-member")
    stranger, stranger_headers = account(db_session, "reminders-stranger")
    household = group(db_session, owner, member)
    group(db_session, owner, stranger, "Other training")
    settings = {"mode": "automatic", "reset_day": 4, "notify": True, "time_zone": "UTC"}
    assert (
        workout_client.put(
            f"{BASE}/planning-settings?household_id={household.id}",
            headers=owner_headers,
            json=settings,
        ).status_code
        == 200
    )
    result = workout_client.get(f"{BASE}/planning-reminders", headers=member_headers)
    assert result.status_code == 200
    assert result.headers["Cache-Control"] == "no-store"
    assert result.json()["personal"]["mode"] == "manual"
    assert len(result.json()["groups"]) == 1
    assert result.json()["groups"][0]["id"] == household.id
    assert result.json()["groups"][0]["settings"]["reset_day"] == 4
    assert all(
        row["id"] != household.id
        for row in workout_client.get(
            f"{BASE}/planning-reminders", headers=stranger_headers
        ).json()["groups"]
    )
    membership = (
        db_session.query(HouseholdMember)
        .filter_by(household_id=household.id, user_id=member.id)
        .one()
    )
    db_session.delete(membership)
    db_session.commit()
    assert (
        workout_client.get(f"{BASE}/planning-reminders", headers=member_headers).json()["groups"]
        == []
    )
