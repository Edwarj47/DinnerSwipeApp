from __future__ import annotations

from dataclasses import dataclass
from datetime import UTC, datetime
from pathlib import Path
from typing import Any
from urllib.parse import quote

import httpx
from appstoreserverlibrary.api_client import AppStoreServerAPIClient
from appstoreserverlibrary.models.Environment import Environment
from appstoreserverlibrary.signed_data_verifier import SignedDataVerifier
from cryptography.fernet import Fernet
from fastapi import HTTPException
from google.auth.transport.requests import Request
from google.oauth2 import id_token, service_account

from app.core.config import settings

APP_ID = "dev.dcss.dinnerswipe"
GOOGLE_API = "https://androidpublisher.googleapis.com/androidpublisher/v3/applications"


@dataclass(frozen=True)
class StoreSnapshot:
    provider: str
    environment: str
    product_id: str
    chain: str
    reference: str
    binding: str | None
    state: str
    expires_at: datetime | None
    valid_until: datetime | None
    auto_renew: bool = False
    ack_pending: bool = False
    linked: str | None = None


def token_cipher() -> Fernet:
    try:
        return Fernet(settings.native_token_encryption_key.get_secret_value().encode())
    except (ValueError, TypeError) as exc:
        raise HTTPException(503, "Native billing storage is not configured.") from exc


def configured(provider: str) -> bool:
    try:
        token_cipher()
        if provider == "apple":
            return bool(
                settings.native_apple_enabled
                and settings.native_apple_product_id
                and settings.native_apple_issuer_id
                and settings.native_apple_key_id
                and Path(settings.native_apple_private_key_path).is_file()
                and settings.native_apple_root_certificates
                and all(Path(p).is_file() for p in settings.native_apple_root_certificates)
                and (
                    settings.native_apple_environment != "Production"
                    or settings.native_apple_app_id
                )
                and (
                    settings.native_apple_environment != "Sandbox"
                    or settings.native_allow_test_purchases
                )
            )
        if provider == "google":
            return bool(
                settings.native_google_enabled
                and settings.native_google_product_id
                and settings.native_google_base_plan_id
                and Path(settings.native_google_credentials_path).is_file()
                and settings.native_google_push_audience
                and settings.native_google_push_email
            )
    except (OSError, HTTPException):
        return False
    return False


def require_configured(provider: str) -> None:
    if not configured(provider):
        raise HTTPException(503, "This store's subscription billing is not configured.")


def apple_verifier() -> SignedDataVerifier:
    require_configured("apple")
    return SignedDataVerifier(
        [Path(p).read_bytes() for p in settings.native_apple_root_certificates],
        True,
        Environment(settings.native_apple_environment),
        APP_ID,
        settings.native_apple_app_id,
    )


def _milliseconds(value: int | None) -> datetime | None:
    return datetime.fromtimestamp(value / 1000, UTC).replace(tzinfo=None) if value else None


def _iso(value: str | None) -> datetime | None:
    return (
        datetime.fromisoformat(value.replace("Z", "+00:00")).astimezone(UTC).replace(tzinfo=None)
        if value
        else None
    )


def fetch_apple(reference: str) -> StoreSnapshot:
    require_configured("apple")
    try:
        verifier = apple_verifier()
        client = AppStoreServerAPIClient(
            Path(settings.native_apple_private_key_path).read_bytes(),
            settings.native_apple_key_id,
            settings.native_apple_issuer_id,
            APP_ID,
            Environment(settings.native_apple_environment),
        )
        result = client.get_transaction_info(reference)
        if not result.signedTransactionInfo:
            raise ValueError("Missing signed transaction")
        initial = verifier.verify_and_decode_signed_transaction(result.signedTransactionInfo)
        if not initial.originalTransactionId:
            raise ValueError("Missing purchase chain")
        statuses = client.get_all_subscription_statuses(initial.originalTransactionId)
        candidates = []
        for group in statuses.data or []:
            for item in group.lastTransactions or []:
                if not item.signedTransactionInfo:
                    raise ValueError("Missing current signed transaction")
                transaction = verifier.verify_and_decode_signed_transaction(
                    item.signedTransactionInfo
                )
                if transaction.originalTransactionId == initial.originalTransactionId:
                    candidates.append((transaction, item))
        if not candidates:
            raise HTTPException(400, "No current subscription status was found.")
        tx, current = max(candidates, key=lambda pair: pair[0].signedDate or 0)
        if tx.productId != settings.native_apple_product_id or tx.bundleId != APP_ID:
            raise HTTPException(400, "Unknown subscription product.")
        if not tx.originalTransactionId or not tx.transactionId or not current.signedRenewalInfo:
            raise ValueError("Missing current renewal evidence")
        renewal = verifier.verify_and_decode_renewal_info(current.signedRenewalInfo)
        expires = _milliseconds(tx.expiresDate)
        valid = expires
        state = "active" if current.status == 1 else "grace" if current.status == 4 else "inactive"
        if state == "grace":
            valid = _milliseconds(renewal.gracePeriodExpiresDate)
        if tx.revocationDate:
            state, valid = "revoked", None
        if state == "inactive":
            valid = None
        return StoreSnapshot(
            "apple",
            settings.native_apple_environment,
            tx.productId,
            tx.originalTransactionId,
            tx.transactionId,
            tx.appAccountToken,
            state,
            expires,
            valid,
            renewal.autoRenewStatus == 1,
        )
    except HTTPException:
        raise
    except Exception as exc:
        # Provider exceptions may contain transaction evidence or signed credentials.
        raise HTTPException(503, "Apple verification is temporarily unavailable.") from exc


class BoundedGoogleRequest(Request):
    def __call__(self, *args: Any, **kwargs: Any) -> Any:
        kwargs["timeout"] = 10
        return super().__call__(*args, **kwargs)  # type: ignore[no-untyped-call]


def google_access_token() -> str:
    credentials = service_account.Credentials.from_service_account_file(  # type: ignore[no-untyped-call]
        settings.native_google_credentials_path,
        scopes=["https://www.googleapis.com/auth/androidpublisher"],
    )
    credentials.refresh(BoundedGoogleRequest())
    if not credentials.token:
        raise HTTPException(503, "Google authentication is unavailable.")
    return str(credentials.token)


def google_request(method: str, suffix: str, body: dict[str, object] | None = None) -> Any:
    require_configured("google")
    try:
        response = httpx.request(
            method,
            f"{GOOGLE_API}/{APP_ID}/{suffix}",
            headers={"Authorization": f"Bearer {google_access_token()}"},
            json=body,
            timeout=10,
        )
        response.raise_for_status()
        return response.json() if response.content else None
    except Exception as exc:
        raise HTTPException(503, "Google verification is temporarily unavailable.") from exc


def fetch_google(reference: str) -> StoreSnapshot:
    payload = google_request("GET", f"purchases/subscriptionsv2/tokens/{quote(reference, safe='')}")
    try:
        if payload.get("testPurchase") is not None and not settings.native_allow_test_purchases:
            raise HTTPException(400, "Test purchases are not enabled on this server.")
        items = [
            item
            for item in payload.get("lineItems", [])
            if (
                item.get("productId") == settings.native_google_product_id
                and item.get("offerDetails", {}).get("basePlanId")
                == settings.native_google_base_plan_id
            )
        ]
        if not items:
            raise HTTPException(400, "Unknown subscription product or base plan.")
        item = max(items, key=lambda row: row.get("expiryTime", ""))
        state = payload["subscriptionState"]
        valid_states = {
            "SUBSCRIPTION_STATE_ACTIVE",
            "SUBSCRIPTION_STATE_IN_GRACE_PERIOD",
            "SUBSCRIPTION_STATE_CANCELED",
        }
        expires = _iso(item.get("expiryTime"))
        return StoreSnapshot(
            "google",
            "Test" if payload.get("testPurchase") is not None else "Production",
            item["productId"],
            reference,
            reference,
            payload.get("externalAccountIdentifiers", {}).get("obfuscatedExternalAccountId"),
            state,
            expires,
            expires if state in valid_states else None,
            item.get("autoRenewingPlan", {}).get("autoRenewEnabled") is True,
            payload.get("acknowledgementState") == "ACKNOWLEDGEMENT_STATE_PENDING"
            and state in valid_states,
            payload.get("linkedPurchaseToken"),
        )
    except HTTPException:
        raise
    except (KeyError, TypeError, ValueError) as exc:
        raise HTTPException(503, "Google returned an incomplete subscription status.") from exc


def acknowledge_google(reference: str, product: str) -> None:
    google_request(
        "POST",
        f"purchases/subscriptions/{quote(product, safe='')}/tokens/"
        f"{quote(reference, safe='')}:acknowledge",
        {},
    )


def fetch_store(provider: str, reference: str) -> StoreSnapshot:
    if provider == "apple":
        return fetch_apple(reference)
    if provider == "google":
        return fetch_google(reference)
    raise HTTPException(400, "Unknown store.")


def verify_google_push(authorization: str | None) -> None:
    require_configured("google")
    if not authorization or not authorization.startswith("Bearer "):
        raise HTTPException(401, "Missing notification authentication.")
    try:
        claims = id_token.verify_oauth2_token(  # type: ignore[no-untyped-call]
            authorization[7:], BoundedGoogleRequest(), settings.native_google_push_audience
        )
        if (
            claims.get("iss") not in {"accounts.google.com", "https://accounts.google.com"}
            or claims.get("email") != settings.native_google_push_email
            or claims.get("email_verified") is not True
            or float(claims.get("exp", 0)) <= datetime.now(UTC).timestamp()
        ):
            raise ValueError("Invalid notification identity")
    except Exception as exc:
        raise HTTPException(401, "Invalid notification authentication.") from exc
