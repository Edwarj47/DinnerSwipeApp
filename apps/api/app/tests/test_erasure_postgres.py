"""Erasure verification may run only against the named disposable local database."""

import os
import time
from concurrent.futures import ThreadPoolExecutor
from threading import Event
from typing import Any
from uuid import uuid4

import pytest
from fastapi import HTTPException
from fastapi.testclient import TestClient
from sqlalchemy import create_engine, select, text
from sqlalchemy.engine import make_url
from sqlalchemy.orm import sessionmaker

from app.database.session import get_db
from app.main import app
from app.models.base import Base
from app.models.entities import Household, HouseholdMember, Recipe, User
from app.services.account_erasure import erasure_transaction
from app.services.billing import handle_stripe_event
from app.services.groups import transfer_household_owner
from app.tests.test_account_erasure import account, erase, recipe
from app.tests.test_account_erasure import (
    test_independent_workout_performance_survives_template_erasure as verify_workout_erasure,
)
from app.tests.test_account_erasure import (
    test_shared_originals_are_deleted_and_independent_records_survive as verify_shared_erasure,
)

pytestmark = pytest.mark.skipif(
    not os.environ.get("ERASURE_TEST_DATABASE_URL"), reason="Disposable PostgreSQL only"
)


@pytest.fixture()
def postgres(tmp_path: Any, monkeypatch: Any) -> Any:
    from app.core.config import settings

    monkeypatch.setattr(settings, "image_storage_path", str(tmp_path))
    monkeypatch.setattr(settings, "media_storage_backend", "local")
    monkeypatch.setattr(settings, "account_erasure_enabled", True)
    raw = os.environ["ERASURE_TEST_DATABASE_URL"]
    url = make_url(raw)
    if url.host != "127.0.0.1" or url.port != 55439 or url.database != "erasure_test":
        raise RuntimeError("Refusing erasure testing outside the disposable local fixture")
    schema = "erasure_" + uuid4().hex
    admin = create_engine(raw)
    with admin.begin() as connection:
        connection.execute(text(f"CREATE SCHEMA {schema}"))
    engine = create_engine(raw, connect_args={"options": f"-csearch_path={schema}"})
    Base.metadata.create_all(engine)
    sessions = sessionmaker(engine, autoflush=False)
    with sessions() as db:

        def override() -> Any:
            yield db

        app.dependency_overrides[get_db] = override
        try:
            with TestClient(app) as client:
                yield client, db, sessions
        finally:
            app.dependency_overrides.clear()
    engine.dispose()
    with admin.begin() as connection:
        connection.execute(text(f"DROP SCHEMA {schema} CASCADE"))
    admin.dispose()


def test_shared_original_erasure_obeys_postgresql_constraints(postgres: Any) -> None:
    client, db, _ = postgres
    _, headers = account(client, db, "owner@example.com")
    verify_shared_erasure(client, db, headers)


def test_native_ownership_tombstone_survives_real_account_erasure(postgres: Any) -> None:
    from datetime import datetime, timedelta

    from app.models.native_billing import NativeBillingAccount, NativePurchase
    from app.services.account_erasure import deletion_preflight

    client, db, _ = postgres
    owner, headers = account(client, db, "pg-native-owner@example.com")
    native = NativeBillingAccount(user_id=owner.id)
    db.add(native)
    db.flush()
    account_id = native.id
    db.add(
        NativePurchase(
            account_id=native.id,
            provider="google",
            environment="Test",
            chain_hash="a" * 64,
            reference_encrypted="synthetic-not-real-evidence",
            product_id="premium",
            state="SUBSCRIPTION_STATE_ACTIVE",
            expires_at=datetime.utcnow() + timedelta(days=1),
            valid_until=datetime.utcnow() + timedelta(days=1),
            verified_at=datetime.utcnow(),
            ack_pending=True,
            next_check_at=datetime.utcnow(),
        )
    )
    db.commit()
    assert deletion_preflight(db, owner)["billing_acknowledgement_required"]
    assert erase(client, headers, billing_acknowledged=True).json()["status"] == "complete"
    db.expire_all()
    assert db.get(NativeBillingAccount, account_id).user_id is None
    purchase = db.scalar(select(NativePurchase))
    assert purchase.state == "account_deleted" and purchase.valid_until is None
    assert not purchase.ack_pending and purchase.reference_encrypted == ""


def test_independent_workout_history_obeys_postgresql_constraints(postgres: Any) -> None:
    client, db, _ = postgres
    _, headers = account(client, db, "owner@example.com")
    verify_workout_erasure(client, db, headers)


def test_real_foreign_keys_erase_originals_but_preserve_an_independent_account(
    postgres: Any, monkeypatch: Any
) -> None:
    from app.core.config import settings

    monkeypatch.setattr(settings, "account_erasure_enabled", True)
    client, db, _ = postgres
    deleted, headers = account(client, db, "pg-erased@example.com")
    survivor, survivor_headers = account(client, db, "pg-survivor@example.com")
    deleted_id, survivor_id = deleted.id, survivor.id
    original_id = recipe(db, deleted, "Original PG recipe").id
    independent_id = recipe(db, survivor, "Independent PG recipe").id
    result = erase(client, headers)
    assert result.json()["status"] == "complete"
    db.expire_all()
    assert db.get(User, deleted_id) is None and db.get(Recipe, original_id) is None
    assert db.get(User, survivor_id).is_active and db.get(Recipe, independent_id) is not None
    assert client.get("/api/v1/auth/status", headers=headers).status_code == 401
    assert client.get("/api/v1/auth/status", headers=survivor_headers).status_code == 200
    late = {
        "id": "evt_synthetic_late",
        "type": "customer.subscription.updated",
        "data": {"object": {"id": "sub_synthetic_late", "metadata": {"user_id": deleted_id}}},
    }
    assert handle_stripe_event(db, late) == {"status": "ignored"}


def test_stale_writer_waits_for_revocation_then_cannot_commit(postgres: Any) -> None:
    client, db, sessions = postgres
    owner, _ = account(client, db, "pg-race@example.com")
    owner_id, version = owner.id, owner.session_version
    started, release = Event(), Event()

    def revoke() -> Any:
        with sessions() as transaction, erasure_transaction(transaction):
            user = transaction.scalar(select(User).where(User.id == owner_id).with_for_update())
            user.is_active = False
            user.session_version += 1
            transaction.flush()
            started.set()
            assert release.wait(10)
            transaction.commit()

    def stale_write() -> Any:
        assert started.wait(10)
        with sessions() as transaction:
            transaction.info["authenticated_actor"] = (owner_id, version)
            transaction.add(
                Recipe(owner_user_id=owner_id, name="Must roll back", content_hash="stale")
            )
            try:
                transaction.commit()
            except HTTPException as exc:
                transaction.rollback()
                return exc.status_code
            return 200

    with ThreadPoolExecutor(max_workers=2) as executor:
        revocation = executor.submit(revoke)
        assert started.wait(10)
        stale = executor.submit(stale_write)
        time.sleep(0.1)
        assert not stale.done()
        release.set()
        revocation.result(timeout=10)
        assert stale.result(timeout=10) == 401
    db.expire_all()
    assert not db.scalar(select(Recipe.id).where(Recipe.name == "Must roll back"))


def test_cannot_transfer_group_ownership_to_an_erasing_account(postgres: Any) -> None:
    client, db, _ = postgres
    owner, _ = account(client, db, "pg-group-owner@example.com")
    target, _ = account(client, db, "pg-deleting-target@example.com")
    group = Household(name="PG protected group", is_personal=False)
    db.add(group)
    db.flush()
    db.add_all(
        [
            HouseholdMember(household_id=group.id, user_id=owner.id, role="owner"),
            HouseholdMember(household_id=group.id, user_id=target.id, role="member"),
        ]
    )
    target.is_active = False
    db.commit()
    with pytest.raises(HTTPException) as rejected:
        transfer_household_owner(db, owner, target.id, group.id)
    assert rejected.value.status_code == 409
    assert (
        db.scalar(
            select(HouseholdMember.role).where(
                HouseholdMember.household_id == group.id, HouseholdMember.user_id == owner.id
            )
        )
        == "owner"
    )
