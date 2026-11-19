from dataclasses import replace
from datetime import UTC, datetime, timedelta
from pathlib import Path
from types import SimpleNamespace
from typing import Any
from unittest.mock import Mock

import pytest
from appstoreserverlibrary.models.Environment import Environment
from appstoreserverlibrary.signed_data_verifier import SignedDataVerifier
from cryptography.fernet import Fernet
from fastapi import HTTPException
from sqlalchemy import select

from app.core.config import settings
from app.models.entities import User
from app.models.native_billing import (
    NativeBillingAccount,
    NativeBillingNotification,
    NativePurchase,
)
from app.services import billing
from app.services import native_billing as native
from app.services import native_stores as stores


@pytest.fixture
def store(monkeypatch: Any, auth_headers: Any, db_session: Any) -> Any:
    user = db_session.scalar(select(User))
    account = native.account_for_user(db_session, user)
    db_session.commit()
    monkeypatch.setattr(
        settings,
        "native_token_encryption_key",
        settings.native_token_encryption_key.__class__(Fernet.generate_key().decode()),
    )
    monkeypatch.setattr(stores, "configured", lambda provider: True)
    now = datetime.utcnow()
    snapshot = stores.StoreSnapshot(
        "google",
        "Production",
        "premium",
        "token-one",
        "token-one",
        account.google_token,
        "SUBSCRIPTION_STATE_ACTIVE",
        now + timedelta(days=30),
        now + timedelta(days=30),
        True,
        True,
    )
    fetch = Mock(return_value=snapshot)
    ack = Mock()
    monkeypatch.setattr(stores, "fetch_store", fetch)
    monkeypatch.setattr(stores, "acknowledge_google", ack)
    return user, account, snapshot, fetch, ack


def test_disabled_configuration_never_grants_or_contacts_provider(
    client: Any, auth_headers: Any, monkeypatch: Any
) -> None:
    fetch = Mock()
    monkeypatch.setattr(stores, "fetch_store", fetch)
    response = client.post(
        "/api/v1/subscription/native/verify",
        headers=auth_headers,
        json={"provider": "google", "reference": "not-a-purchase", "premium_active": True},
    )
    assert response.status_code in {422, 503}
    assert not client.get("/api/v1/subscription/status", headers=auth_headers).json()[
        "premium_active"
    ]
    fetch.assert_not_called()
    assert client.get("/api/v1/subscription/native/context").status_code == 401


def test_idempotent_verification_acknowledges_only_a_committed_grant(
    store: Any, db_session: Any
) -> None:
    user, account, snapshot, fetch, ack = store

    def acknowledge(*args: Any) -> Any:
        assert db_session.scalar(select(NativePurchase)).ack_pending
        assert billing.is_premium_access_active(db_session, user)

    ack.side_effect = acknowledge
    result = native.verify_purchase(db_session, user, "google", snapshot.reference)
    assert result["verified"] and result["subscription"]["premium_active"]
    assert not result["finish_transaction"]
    fetch.return_value = replace(snapshot, ack_pending=False)
    native.verify_purchase(db_session, user, "google", snapshot.reference)
    assert db_session.query(NativePurchase).count() == 1
    assert ack.call_count == 1
    row = db_session.scalar(select(NativePurchase))
    assert snapshot.reference not in row.reference_encrypted
    assert row.account_id == account.id


@pytest.mark.parametrize("binding", [None, "some-other-account"])
def test_unbound_or_foreign_first_purchase_is_rejected(
    store: Any, db_session: Any, binding: Any
) -> None:
    user, _, snapshot, fetch, ack = store
    fetch.return_value = replace(snapshot, binding=binding)
    with pytest.raises(HTTPException) as error:
        native.verify_purchase(db_session, user, "google", snapshot.reference)
    assert error.value.status_code == 409
    assert db_session.query(NativePurchase).count() == 0
    ack.assert_not_called()


def test_existing_purchase_cannot_move_between_accounts_or_survive_deleted_owner(
    store: Any, db_session: Any
) -> None:
    user, account, snapshot, fetch, ack = store
    native.verify_purchase(db_session, user, "google", snapshot.reference)
    other = User(email="other@test.invalid", password_hash="!", email_verified=True)  # noqa: S106 - unusable test login.
    db_session.add(other)
    db_session.commit()
    with pytest.raises(HTTPException):
        native.verify_purchase(db_session, other, "google", snapshot.reference)
    db_session.rollback()
    account.user_id, account.deleted_at = None, datetime.utcnow()
    db_session.commit()
    assert not billing.is_premium_access_active(db_session, user)
    with pytest.raises(HTTPException):
        native.verify_purchase(db_session, other, "google", snapshot.reference)
    assert db_session.scalar(select(NativePurchase)).account_id == account.id


def test_provider_failure_does_not_finish_grant_or_ack(store: Any, db_session: Any) -> None:
    user, _, snapshot, fetch, ack = store
    fetch.side_effect = HTTPException(503, "Provider unavailable")
    with pytest.raises(HTTPException) as error:
        native.verify_purchase(db_session, user, "google", snapshot.reference)
    assert error.value.status_code == 503
    assert not billing.is_premium_access_active(db_session, user)
    ack.assert_not_called()


def test_ack_failure_is_durable_and_retried_after_authoritative_refresh(
    store: Any, db_session: Any
) -> None:
    user, _, snapshot, fetch, ack = store
    ack.side_effect = HTTPException(503, "Unavailable")
    native.verify_purchase(db_session, user, "google", snapshot.reference)
    row = db_session.scalar(select(NativePurchase))
    assert row.ack_pending and row.attempts == 1
    assert billing.is_premium_access_active(db_session, user)
    row.next_check_at = datetime.utcnow() - timedelta(seconds=1)
    db_session.commit()
    ack.side_effect = None
    native.process_native_billing(db_session)
    assert not row.ack_pending and ack.call_count == 2


def test_repeated_ack_failures_increase_durable_backoff(store: Any, db_session: Any) -> None:
    user, _, snapshot, _, ack = store
    ack.side_effect = HTTPException(503, "Unavailable")
    native.verify_purchase(db_session, user, "google", snapshot.reference)
    row = db_session.scalar(select(NativePurchase))
    assert row.attempts == 1
    first_delay = row.next_check_at - datetime.utcnow()
    row.next_check_at = datetime.utcnow() - timedelta(seconds=1)
    db_session.commit()
    native.process_native_billing(db_session)
    assert row.attempts == 2 and row.ack_pending
    assert row.next_check_at - datetime.utcnow() > first_delay


def test_account_erasure_warns_detaches_and_blocks_restore_and_late_notifications(
    store: Any, db_session: Any, client: Any, auth_headers: Any, monkeypatch: Any
) -> None:
    from app.tests.test_account_erasure import erase

    user, account, snapshot, _, ack = store
    native.verify_purchase(db_session, user, "google", snapshot.reference)
    account_id = account.id
    monkeypatch.setattr(settings, "account_erasure_enabled", True)
    status = client.get("/api/v1/auth/account/deletion", headers=auth_headers).json()
    assert status["billing_providers"] == ["google"]
    assert status["billing_acknowledgement_required"]
    assert erase(client, auth_headers).status_code == 409
    result = erase(client, auth_headers, billing_acknowledged=True)
    assert result.status_code == 200 and result.json()["status"] == "complete"
    db_session.expire_all()
    detached = db_session.get(NativeBillingAccount, account_id)
    purchase = db_session.scalar(select(NativePurchase))
    assert detached.user_id is None and detached.deleted_at
    assert purchase.valid_until is None and not purchase.ack_pending
    assert purchase.reference_encrypted == "" and purchase.state == "account_deleted"
    assert (
        native.enqueue_notification(db_session, "google", "late-after-erasure", snapshot.reference)
        == "received"
    )
    native.process_native_billing(db_session)
    assert db_session.scalar(select(NativeBillingNotification)).status == "rejected"
    ack.assert_called_once()
    other = User(email="new-account@test.invalid", password_hash="!")  # noqa: S106 - unusable fixture login.
    db_session.add(other)
    db_session.commit()
    with pytest.raises(HTTPException) as rejected:
        native.verify_purchase(db_session, other, "google", snapshot.reference)
    assert rejected.value.status_code == 409


@pytest.mark.parametrize(
    "state",
    [
        "SUBSCRIPTION_STATE_PENDING",
        "SUBSCRIPTION_STATE_PAUSED",
        "SUBSCRIPTION_STATE_ON_HOLD",
        "SUBSCRIPTION_STATE_EXPIRED",
    ],
)
def test_ineligible_state_never_grants_or_acknowledges(
    store: Any, db_session: Any, state: Any
) -> None:
    user, _, snapshot, fetch, ack = store
    fetch.return_value = replace(snapshot, state=state, valid_until=None, ack_pending=False)
    result = native.verify_purchase(db_session, user, "google", snapshot.reference)
    assert not result["subscription"]["premium_active"]
    assert result["subscription"]["basic_active"]
    ack.assert_not_called()


def test_expiry_and_verification_lease_are_both_enforced(store: Any, db_session: Any) -> None:
    user, _, snapshot, _, _ = store
    native.verify_purchase(db_session, user, "google", snapshot.reference)
    row = db_session.scalar(select(NativePurchase))
    row.verified_at = datetime.utcnow() - timedelta(hours=73)
    db_session.commit()
    assert not billing.is_premium_access_active(db_session, user)
    row.verified_at = datetime.utcnow()
    row.valid_until = datetime.utcnow() - timedelta(seconds=1)
    db_session.commit()
    assert not billing.is_premium_access_active(db_session, user)


def test_refund_reconciliation_and_duplicate_notifications(store: Any, db_session: Any) -> None:
    user, _, snapshot, fetch, _ = store
    native.verify_purchase(db_session, user, "google", snapshot.reference)
    fetch.return_value = replace(
        snapshot, state="SUBSCRIPTION_STATE_EXPIRED", valid_until=None, ack_pending=False
    )
    assert (
        native.enqueue_notification(db_session, "google", "message-1", snapshot.reference)
        == "received"
    )
    assert (
        native.enqueue_notification(db_session, "google", "message-1", snapshot.reference)
        == "duplicate"
    )
    native.process_native_billing(db_session)
    assert db_session.scalar(select(NativeBillingNotification)).status == "done"
    assert not billing.is_premium_access_active(db_session, user)


def test_notification_provider_failure_remains_retryable(store: Any, db_session: Any) -> None:
    _, _, snapshot, fetch, _ = store
    native.enqueue_notification(db_session, "google", "message-failure", snapshot.reference)
    fetch.side_effect = HTTPException(503, "Unavailable")
    native.process_native_billing(db_session)
    row = db_session.scalar(select(NativeBillingNotification))
    assert row.status == "pending" and row.attempts == 1


def test_linked_google_token_cannot_cross_account_and_old_token_stays_superseded(
    store: Any, db_session: Any
) -> None:
    user, account, snapshot, fetch, _ = store
    native.verify_purchase(db_session, user, "google", snapshot.reference)
    replacement = replace(snapshot, chain="token-two", reference="token-two", linked="token-one")
    fetch.return_value = replacement
    native.verify_purchase(db_session, user, "google", replacement.reference)
    old = db_session.scalar(
        select(NativePurchase).where(NativePurchase.chain_hash == native.digest("token-one"))
    )
    assert old.superseded
    fetch.return_value = snapshot
    native.verify_purchase(db_session, user, "google", snapshot.reference)
    assert old.superseded and not old.ack_pending
    other = User(email="foreign@test.invalid", password_hash="!")  # noqa: S106 - unusable test login.
    db_session.add(other)
    db_session.commit()
    foreign = native.account_for_user(db_session, other)
    db_session.commit()
    fetch.return_value = replace(
        replacement, chain="token-three", reference="token-three", binding=foreign.google_token
    )
    with pytest.raises(HTTPException):
        native.verify_purchase(db_session, other, "google", "token-three")
    db_session.rollback()
    assert db_session.query(NativePurchase).count() == 2


def test_google_normalization_uses_authoritative_product_plan_state_and_test_environment(
    monkeypatch: Any,
) -> None:
    monkeypatch.setattr(settings, "native_google_product_id", "premium")
    monkeypatch.setattr(settings, "native_google_base_plan_id", "monthly")
    payload: dict[str, Any] = {
        "subscriptionState": "SUBSCRIPTION_STATE_CANCELED",
        "acknowledgementState": "ACKNOWLEDGEMENT_STATE_PENDING",
        "externalAccountIdentifiers": {"obfuscatedExternalAccountId": "opaque"},
        "lineItems": [
            {
                "productId": "premium",
                "expiryTime": (datetime.now(UTC) + timedelta(days=3)).isoformat(),
                "offerDetails": {"basePlanId": "monthly"},
                "autoRenewingPlan": {"autoRenewEnabled": False},
            }
        ],
    }
    monkeypatch.setattr(stores, "google_request", lambda *args: payload)
    result = stores.fetch_google("token")
    assert result.valid_until and not result.auto_renew and result.binding == "opaque"
    payload["subscriptionState"] = "SUBSCRIPTION_STATE_ON_HOLD"
    assert stores.fetch_google("token").valid_until is None
    payload["testPurchase"] = {}
    with pytest.raises(HTTPException):
        stores.fetch_google("token")
    payload.pop("testPurchase")
    payload["lineItems"][0]["offerDetails"]["basePlanId"] = "annual"
    with pytest.raises(HTTPException):
        stores.fetch_google("token")


@pytest.mark.parametrize(
    "claim,value",
    [("aud", "wrong"), ("iss", "evil"), ("email", "wrong"), ("email_verified", False), ("exp", 0)],
)
def test_google_oidc_claims_reject_spoofing(
    monkeypatch: Any, store: Any, claim: Any, value: Any
) -> None:
    monkeypatch.setattr(
        settings, "native_google_push_audience", "https://expected.invalid/notifications"
    )
    monkeypatch.setattr(settings, "native_google_push_email", "push@test.invalid")
    claims = {
        "aud": settings.native_google_push_audience,
        "iss": "https://accounts.google.com",
        "email": settings.native_google_push_email,
        "email_verified": True,
        "exp": datetime.now(UTC).timestamp() + 300,
    }
    claims[claim] = value

    def verify(token: Any, request: Any, audience: Any) -> Any:
        if claims["aud"] != audience:
            raise ValueError("Wrong audience")
        return claims

    monkeypatch.setattr("google.oauth2.id_token.verify_oauth2_token", verify)
    with pytest.raises(HTTPException) as error:
        stores.verify_google_push("Bearer fixture")
    assert error.value.status_code == 401


def test_apple_official_verifier_rejects_unsigned_payload(
    monkeypatch: Any, store: Any, db_session: Any
) -> None:
    verifier = SignedDataVerifier([], False, Environment.SANDBOX, stores.APP_ID)
    monkeypatch.setattr(stores, "apple_verifier", lambda: verifier)
    with pytest.raises(HTTPException) as error:
        native.apple_notification(db_session, "eyJhbGciOiJub25lIn0.e30.")
    assert error.value.status_code == 400
    assert db_session.query(NativeBillingNotification).count() == 0


def test_verification_requires_verified_email_and_reserves_shared_budgets(
    store: Any, client: Any, auth_headers: Any, db_session: Any, monkeypatch: Any
) -> None:
    user, _, snapshot, _, _ = store
    user.email_verified = False
    db_session.commit()
    payload = {"provider": "google", "reference": snapshot.reference}
    assert (
        client.post(
            "/api/v1/subscription/native/verify", headers=auth_headers, json=payload
        ).status_code
        == 403
    )
    user.email_verified = True
    db_session.commit()
    reserve = Mock()
    monkeypatch.setattr("app.api.routes.native_billing.auth_rate_limiter.reserve", reserve)
    assert (
        client.post(
            "/api/v1/subscription/native/verify", headers=auth_headers, json=payload
        ).status_code
        == 200
    )
    budgets = reserve.call_args.args[0]
    assert any(key.startswith("native-verify:user:") for key, _, _ in budgets)
    assert any(key.startswith("native-verify:ip:") for key, _, _ in budgets)
    assert ("native-verify:global", 60, 60) in budgets
    assert ("native-verify:global-hour", 600, 3600) in budgets


def test_native_paid_history_blocks_another_welcome_grant(store: Any, db_session: Any) -> None:
    from app.models.entities import ComplimentaryPremiumAccess
    from app.services.welcome_access import WELCOME_OFFER, start_welcome

    user, _, snapshot, _, _ = store
    native.verify_purchase(db_session, user, "google", snapshot.reference)
    db_session.add(ComplimentaryPremiumAccess(user_id=user.id, offer_key=WELCOME_OFFER))
    db_session.commit()
    with pytest.raises(HTTPException) as error:
        start_welcome(db_session, user)
    assert error.value.status_code == 409


def test_native_offline_access_is_bounded_by_verification_and_paid_expiry(
    store: Any, db_session: Any, client: Any, auth_headers: Any
) -> None:
    user, _, snapshot, _, _ = store
    native.verify_purchase(db_session, user, "google", snapshot.reference)
    result = client.get("/api/v1/subscription/status", headers=auth_headers).json()
    until = datetime.fromisoformat(result["offline_until"].replace("Z", "+00:00"))
    assert 23 <= (until - datetime.now(UTC)).total_seconds() / 3600 <= 24
    row = db_session.scalar(select(NativePurchase))
    row.valid_until = datetime.utcnow() + timedelta(hours=2)
    db_session.commit()
    result = client.get("/api/v1/subscription/status", headers=auth_headers).json()
    assert (
        datetime.fromisoformat(result["offline_until"].replace("Z", "+00:00")).replace(tzinfo=None)
        == row.valid_until
    )


def test_pending_purchase_does_not_consume_unstarted_no_card_welcome(
    store: Any, db_session: Any
) -> None:
    from app.models.entities import ComplimentaryPremiumAccess, UserSubscription
    from app.services.welcome_access import WELCOME_OFFER, start_welcome

    user, _, snapshot, fetch, ack = store
    db_session.query(UserSubscription).filter_by(user_id=user.id).delete()
    db_session.add(ComplimentaryPremiumAccess(user_id=user.id, offer_key=WELCOME_OFFER))
    db_session.commit()
    fetch.return_value = replace(
        snapshot, state="SUBSCRIPTION_STATE_PENDING", valid_until=None, ack_pending=False
    )
    native.verify_purchase(db_session, user, "google", snapshot.reference)
    grant = start_welcome(db_session, user)
    assert grant.started_at is not None and grant.ends_at is not None
    ack.assert_not_called()


def test_apple_current_status_not_client_transaction_expiry_controls_access(
    monkeypatch: Any, store: Any
) -> None:
    _, account, _, _, _ = store
    tx = SimpleNamespace(
        originalTransactionId="original",
        transactionId="current",
        signedDate=1,
        productId="premium",
        bundleId=stores.APP_ID,
        appAccountToken=account.apple_token,
        expiresDate=int((datetime.now(UTC) + timedelta(days=30)).timestamp() * 1000),
        revocationDate=None,
    )
    verifier = Mock()
    verifier.verify_and_decode_signed_transaction.return_value = tx
    verifier.verify_and_decode_renewal_info.return_value = SimpleNamespace(
        autoRenewStatus=0, gracePeriodExpiresDate=None
    )
    api = Mock()
    api.get_transaction_info.return_value.signedTransactionInfo = "signed"
    current = SimpleNamespace(
        signedTransactionInfo="current-signed", signedRenewalInfo="renewal", status=2
    )
    api.get_all_subscription_statuses.return_value.data = [
        SimpleNamespace(lastTransactions=[current])
    ]
    monkeypatch.setattr(settings, "native_apple_product_id", "premium")
    monkeypatch.setattr(stores, "apple_verifier", lambda: verifier)
    monkeypatch.setattr(stores, "AppStoreServerAPIClient", lambda *args: api)
    monkeypatch.setattr(Path, "read_bytes", lambda self: b"fixture")
    assert stores.fetch_apple("old-transaction").valid_until is None
    current.status = 1
    assert stores.fetch_apple("old-transaction").valid_until is not None
    tx.revocationDate = 1
    assert stores.fetch_apple("old-transaction").valid_until is None
