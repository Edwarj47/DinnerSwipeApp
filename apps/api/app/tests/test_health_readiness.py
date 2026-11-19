import pytest
from fastapi.testclient import TestClient
from sqlalchemy import text
from sqlalchemy.orm import Session


@pytest.mark.parametrize(
    "revision",
    [None, "d9b46e13a702", "fa617db329a0", "ac18e1a9b610", "b731f90e2c41", "c419fa3a8210"],
)
def test_readiness_checks_schema_without_authentication_or_database_details(
    client: TestClient, db_session: Session, revision: str | None
) -> None:
    if revision:
        db_session.execute(text("CREATE TABLE alembic_version (version_num VARCHAR(32) NOT NULL)"))
        db_session.execute(
            text("INSERT INTO alembic_version(version_num) VALUES (:revision)"),
            {"revision": revision},
        )
        db_session.commit()
    response = client.get("/api/v1/health/ready")
    ready = revision == "c419fa3a8210"
    assert response.status_code == (200 if ready else 503)
    assert response.json() == {"status": "ready" if ready else "not_ready"}
    assert response.headers["cache-control"] == "no-store"
