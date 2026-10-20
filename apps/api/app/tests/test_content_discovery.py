from __future__ import annotations

import asyncio
from datetime import UTC, datetime, timedelta
from typing import Any

import pytest
from fastapi import HTTPException
from fastapi.testclient import TestClient
from sqlalchemy import select
from sqlalchemy.orm import Session, sessionmaker

from app.models.content_automation import ContentCampaign, ContentCandidate, ContentDailyBatch
from app.models.entities import Recipe, User
from app.models.workouts import WorkoutTemplate
from app.services import content_automation as automation
from app.services import content_discovery as service
from app.services import content_discovery_sources as sources
from app.workers import content_daily as worker

NOW = datetime(2026, 10, 20, 12, tzinfo=UTC)
ROOT = "/api/v1/content-automation/sources"


def lead(kind: str = "recipe", index: int = 0) -> dict[str, str]:
    url = (
        f"https://medlineplus.gov/recipes/test-meal-{index}/"
        if kind == "recipe"
        else f"https://www.nhs.uk/live-well/exercise/test-routine-{index}/"
    )
    return {
        "id": sources.source_id(kind, url),
        "kind": kind,
        "title": f"Test source {index}",
        "source_url": url,
        "source_name": "Catalog",
        "status": "pending",
    }


@pytest.fixture()
def batch(db_session: Session, auth_headers: dict[str, str]) -> ContentDailyBatch:
    del auth_headers
    user = db_session.scalar(select(User).where(User.email == "owner@example.com"))
    assert user
    campaign = automation.create_campaign(db_session, user.id, NOW.date())
    row = automation.begin_batch(db_session, campaign.id, NOW.date(), NOW)
    assert row and row.lease_token
    automation.finish_batch(db_session, row.id, [], lease_token=row.lease_token, now=NOW)
    db_session.commit()
    return row


def finish(db: Session, batch: ContentDailyBatch, values: list[dict[str, str]]) -> None:
    reservation = service.begin(db, batch.campaign_id, NOW)
    assert reservation
    db.commit()
    service.finish(db, batch.id, reservation[1], values, [], NOW)
    db.commit()


def test_discovery_is_separate_private_and_retry_safe(
    db_session: Session, batch: ContentDailyBatch, client: TestClient, auth_headers: dict[str, str]
) -> None:
    finish(db_session, batch, [lead(), lead("workout")])
    assert not db_session.scalars(select(Recipe)).all()
    assert not db_session.scalars(select(WorkoutTemplate)).all()
    assert not db_session.scalars(select(ContentCandidate)).all()
    assert service.begin(db_session, batch.campaign_id, NOW) is None
    response = client.get(ROOT, headers=auth_headers)
    assert response.status_code == 200
    assert response.headers["cache-control"] == "no-store"
    run = response.json()["runs"][0]
    assert run["id"] == batch.id and len(run["sources"]) == 2
    assert set(run) == {"id", "scheduled_date", "status", "sources", "reasons"}
    assert "lease" not in response.text and "attempts" not in response.text
    exported = client.get("/api/v1/auth/account/export", headers=auth_headers)
    assert exported.status_code == 200
    assert exported.json()["source_discovery"] == response.json()
    response = client.post(
        f"{ROOT}/{batch.id}/dismiss", headers=auth_headers, json={"source_ids": [lead()["id"]]}
    )
    assert response.status_code == 200
    assert response.json()["runs"][0]["sources"][0]["status"] == "dismissed"
    assert (
        client.post(
            f"{ROOT}/{batch.id}/dismiss", headers=auth_headers, json={"source_ids": [lead()["id"]]}
        ).status_code
        == 200
    )
    db_session.expire_all()
    assert batch.status == "partial"  # The discovery does not change compilation status.


@pytest.mark.parametrize("value", [[], ["invalid"], ["a" * 64] * 2, ["a" * 64] * 11])
def test_bad_dismissal_ids(
    client: TestClient, auth_headers: dict[str, str], batch: ContentDailyBatch, value: list[str]
) -> None:
    response = client.post(
        f"{ROOT}/{batch.id}/dismiss", headers=auth_headers, json={"source_ids": value}
    )
    assert response.status_code == 422
    assert response.headers["cache-control"] == "no-store"


def test_unowned_sources_not_visible(
    db_session: Session, batch: ContentDailyBatch, client: TestClient, auth_headers: dict[str, str]
) -> None:
    finish(db_session, batch, [lead()])
    response = client.post(
        "/api/v1/auth/register",
        json={
            "email": "other@example.com",
            "password": "another-password-123",
            "terms_accepted": True,
            "privacy_accepted": True,
        },
    )
    other = db_session.scalar(select(User).where(User.email == "other@example.com"))
    assert other
    # No need to grant another account a subscription to prove service ownership checks.
    assert service.overview(db_session, other) == {"runs": []}
    with pytest.raises(HTTPException) as exc:
        service.dismiss(db_session, other, batch.id, [lead()["id"]])
    assert exc.value.status_code == 404
    assert response.status_code == 200
    assert client.get(ROOT).status_code == 401
    assert client.get(ROOT).headers["cache-control"] == "no-store"
    assert client.post(f"{ROOT}/{batch.id}/approve", headers=auth_headers).status_code == 404


@pytest.mark.parametrize("change", ["paused", "unverified", "early", "ended"])
def test_discovery_obeys_campaign_window(
    db_session: Session, batch: ContentDailyBatch, change: str
) -> None:
    now = NOW
    campaign = db_session.get(ContentCampaign, batch.campaign_id)
    assert campaign
    if change == "paused":
        campaign.status = "paused"
    elif change == "unverified":
        user = db_session.get(User, batch.user_id)
        assert user
        user.email_verified = False
    elif change == "early":
        now = NOW.replace(hour=9)
    else:
        now = NOW + timedelta(days=35)
    db_session.commit()
    assert service.begin(db_session, campaign.id, now) is None


def test_leases_cap_recovery_and_reject_stale_writer(
    db_session: Session, batch: ContentDailyBatch
) -> None:
    first = service.begin(db_session, batch.campaign_id, NOW)
    assert first
    db_session.commit()
    assert service.begin(db_session, batch.campaign_id, NOW) is None
    later = NOW + timedelta(minutes=4)
    second = service.begin(db_session, batch.campaign_id, later)
    assert second and first[1] != second[1]
    db_session.commit()
    with pytest.raises(HTTPException) as exc:
        service.finish(db_session, batch.id, first[1], [lead()], [], later)
    assert exc.value.status_code == 409
    db_session.rollback()
    assert service.begin(db_session, batch.campaign_id, later + timedelta(minutes=4)) is None
    db_session.commit()
    assert batch.report[service.KEY]["status"] == "partial"


def test_dismissed_sources_never_reappear(db_session: Session, batch: ContentDailyBatch) -> None:
    finish(db_session, batch, [lead()])
    user = db_session.get(User, batch.user_id)
    assert user
    service.dismiss(db_session, user, batch.id, [lead()["id"]])
    db_session.commit()
    tomorrow = NOW + timedelta(days=1)
    next_batch = automation.begin_batch(db_session, batch.campaign_id, tomorrow.date(), tomorrow)
    assert next_batch
    db_session.commit()
    reservation = service.begin(db_session, batch.campaign_id, tomorrow)
    assert reservation and lead()["id"] in reservation[3]


@pytest.mark.parametrize(
    "values",
    [
        [lead()] * 2,
        [lead(index=n) for n in range(6)],
        [{**lead(), "source_url": "https://127.0.0.1/private"}],
        [{**lead(), "id": "a" * 64}],
        [{**lead(), "status": "dismissed"}],
    ],
)
def test_untrusted_and_over_cap_results_rejected(
    db_session: Session, batch: ContentDailyBatch, values: list[dict[str, str]]
) -> None:
    reservation = service.begin(db_session, batch.campaign_id, NOW)
    assert reservation
    db_session.commit()
    with pytest.raises(HTTPException):
        service.finish(db_session, batch.id, reservation[1], values, [], NOW)


@pytest.mark.parametrize(
    "url",
    [
        "http://medlineplus.gov/recipes/beans/",
        "https://medlineplus.gov.evil/recipes/beans/",
        "https://medlineplus.gov:443/recipes/beans/",
        "https://user@medlineplus.gov/recipes/beans/",
        "https://medlineplus.gov/recipes/beans/?redirect=evil",
        "https://medlineplus.gov/recipes/beans/#foo",
        "https://medlineplus.gov/recipes/../private/",
        "https://medlineplus.gov/recipes/dinner/",
    ],
)
def test_catalog_urls_fail_closed(url: str) -> None:
    assert not sources.allowed_source(url, "recipe")


def test_parser_collects_only_card_links_and_skips_existing_nhlbi() -> None:
    html = """<a href="/recipes/footer/">Footer</a>
    <div class="recipe-card-block-with-height"><p><strong>
    <a href="/recipes/beans/">Beans</a></strong>
    <span class="recipe-nhlbi">FoodHero.org</span></p></div>
    <div class="recipe-card-block-with-height"><p><a href="/recipes/old/">Old</a>
    <span class="recipe-nhlbi">NHLBI</span></p></div>
    <div class="recipe-card-block-with-height"><p><a href="https://evil.test/recipes/egg/">Egg</a></p></div>"""
    result = sources.parse_catalog(html, sources.catalogs(0)[0])
    assert len(result) == 1 and result[0]["title"] == "Beans"
    assert set(result[0]) == set(lead())  # No photos, nutrition or copied instructions.
    assert sources.parse_catalog("<h1>Changed layout</h1>", sources.catalogs(0)[0]) == []


def test_catalog_discovery_checks_robots_bounds_and_seen(monkeypatch: pytest.MonkeyPatch) -> None:
    calls: list[str] = []

    async def fetch(url: str, *, robots: bool = False) -> tuple[str, str]:
        calls.append(url)
        if robots:
            return "User-agent: *\nDisallow: /private/", url
        if "medline" in url:
            body = "".join(
                f'<div class="recipe-card-block-with-height"><p>'
                f'<a href="/recipes/meal-{n}/">Meal {n}</a></p></div>'
                for n in range(20)
            )
        else:
            body = (
                "<main>"
                + "".join(
                    f'<a href="/live-well/exercise/routine-{n}/">Routine {n}</a>' for n in range(20)
                )
                + "</main>"
            )
        return body, url

    async def sleep(_: float) -> None:
        pass

    monkeypatch.setattr(sources, "fetch", fetch)
    monkeypatch.setattr(asyncio, "sleep", sleep)
    first, reasons = asyncio.run(sources.discover(0, set()))
    assert len(first) == 10 and not reasons and len(calls) <= 6
    again, _ = asyncio.run(sources.discover(1, {item["id"] for item in first}))
    assert len(again) == 10 and not {item["id"] for item in first} & {item["id"] for item in again}


def test_robots_denial_prevents_index_request(monkeypatch: pytest.MonkeyPatch) -> None:
    calls: list[str] = []

    async def fetch(url: str, *, robots: bool = False) -> tuple[str, str]:
        calls.append(url)
        assert robots
        return "User-agent: *\nDisallow: /", url

    async def sleep(_: float) -> None:
        pass

    monkeypatch.setattr(sources, "fetch", fetch)
    monkeypatch.setattr(asyncio, "sleep", sleep)
    result, reasons = asyncio.run(sources.discover(0, set()))
    assert result == [] and reasons and len(calls) == 2


def test_worker_discovery_does_not_rerun_compilation(
    db_session: Session, batch: ContentDailyBatch, monkeypatch: pytest.MonkeyPatch
) -> None:
    monkeypatch.setattr(worker, "SessionLocal", sessionmaker(bind=db_session.get_bind()))
    monkeypatch.setattr(worker, "utcnow", lambda: NOW)

    async def discover(
        index: int, seen: set[str], *, collected: list[dict[str, str]]
    ) -> tuple[list[dict[str, str]], list[str]]:
        assert index == 0 and not seen
        collected.append(lead())
        return collected, []

    monkeypatch.setattr(sources, "discover", discover)
    result = asyncio.run(worker.discover_campaign(batch.campaign_id))
    assert result["recipe_sources"] == 1 and result["workout_sources"] == 0
    assert asyncio.run(worker.discover_campaign(batch.campaign_id))["discovery"] == "not_due"
    assert not db_session.scalars(select(ContentCandidate)).all()
    db_session.expire_all()
    assert batch.report[service.KEY]["sources"] == [lead()]


def test_fetch_uses_pinned_host_and_byte_limits(monkeypatch: pytest.MonkeyPatch) -> None:
    calls: list[dict[str, Any]] = []

    async def fetch(url: str, **kwargs: Any) -> tuple[bytes, str, str]:
        calls.append(kwargs)
        return b"index", url, "utf-8"

    monkeypatch.setattr(sources, "fetch_public_bytes", fetch)
    asyncio.run(sources.fetch("https://medlineplus.gov/robots.txt", robots=True))
    asyncio.run(sources.fetch("https://medlineplus.gov/recipes/dinner/"))
    assert [item["maximum"] for item in calls] == [64_000, 1_000_000]
    assert [item["kind"] for item in calls] == ["robots", "html"]
    assert all(
        item["https_only"] is True
        and item["allowed_hosts"] == sources.HOSTS
        and item["follow_redirects"] is False
        for item in calls
    )


def test_worker_preserves_earlier_sources_after_later_timeout(
    db_session: Session,
    batch: ContentDailyBatch,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setattr(worker, "SessionLocal", sessionmaker(bind=db_session.get_bind()))
    monkeypatch.setattr(worker, "utcnow", lambda: NOW)

    async def discover(
        index: int, seen: set[str], *, collected: list[dict[str, str]]
    ) -> tuple[list[dict[str, str]], list[str]]:
        collected.extend(lead(index=n) for n in range(5))
        raise TimeoutError("Later catalog stalled")

    monkeypatch.setattr(sources, "discover", discover)
    result = asyncio.run(worker.discover_campaign(batch.campaign_id))
    assert result["recipe_sources"] == 5 and result["workout_sources"] == 0
    db_session.expire_all()
    state = batch.report[service.KEY]
    assert state["status"] == "partial" and len(state["sources"]) == 5 and state["reasons"]


def test_publisher_identity_ignores_workout_fragment() -> None:
    base = "https://www.nhs.uk/live-well/exercise/strength-exercises/"
    assert sources.source_id("workout", base) == sources.source_id("workout", base + "#routine")


def test_final_date_retry_still_runs_discovery_after_compilation_completed(
    db_session: Session,
    batch: ContentDailyBatch,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    campaign = db_session.get(ContentCampaign, batch.campaign_id)
    assert campaign
    campaign.status = "completed"
    db_session.commit()
    final_day = NOW + timedelta(days=34)
    calls: list[str] = []

    async def prepare(identifier: str) -> dict[str, str]:
        return {"status": "not_due"}

    async def discover(identifier: str) -> dict[str, str]:
        calls.append(identifier)
        return {"discovery": "checked"}

    monkeypatch.setattr(worker, "SessionLocal", sessionmaker(bind=db_session.get_bind()))
    monkeypatch.setattr(worker, "utcnow", lambda: final_day)
    monkeypatch.setattr(worker, "prepare_campaign", prepare)
    monkeypatch.setattr(worker, "discover_campaign", discover)
    monkeypatch.setattr("sys.argv", ["content_daily"])
    worker.main()
    assert calls == [campaign.id]
    calls.clear()
    monkeypatch.setattr(worker, "utcnow", lambda: final_day + timedelta(days=1))
    worker.main()
    assert calls == []
