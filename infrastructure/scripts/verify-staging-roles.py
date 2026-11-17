"""Run the actual staging initializer only inside a disposable CI PostgreSQL service."""

import json
import os
import re
import secrets
import subprocess
from pathlib import Path

import psycopg
from alembic.config import Config
from psycopg import sql
from sqlalchemy.engine import make_url

from alembic import command


def main() -> None:
    url = make_url(os.environ["CI_STAGING_ADMIN_URL"])
    container = os.environ["CI_STAGING_POSTGRES_CONTAINER"]
    if (url.host, url.port, url.database, url.username) != (
        "127.0.0.1",
        15413,
        "postgres",
        "ci_owner",
    ) or not re.fullmatch(r"[a-f0-9]{12,64}", container):
        raise ValueError("An explicitly disposable loopback CI PostgreSQL service is required")
    # The container ID is hex-only and its disposable port/image are checked below.
    inspection = json.loads(
        subprocess.check_output(["/usr/bin/docker", "inspect", container])  # noqa: S603
    )[0]
    bindings = inspection["NetworkSettings"]["Ports"].get("5432/tcp") or []
    assert inspection["Config"]["Image"] == "postgres:16"
    assert any(value["HostPort"] == "15413" for value in bindings)
    owner_password, runtime_password = secrets.token_hex(24), secrets.token_hex(24)
    connect = dict(
        host=url.host, port=url.port, user=url.username, password=url.password, dbname="postgres"
    )
    with psycopg.connect(**connect, autocommit=True) as db:
        db.execute(
            sql.SQL(
                "CREATE ROLE dinner_swipe_staging_owner LOGIN SUPERUSER PASSWORD {}"
            ).format(sql.Literal(owner_password))
        )
        db.execute("CREATE DATABASE dinner_swipe_staging OWNER dinner_swipe_staging_owner")
    initializer = Path(__file__).resolve().parents[1] / "docker/staging-init.sh"
    subprocess.run(  # noqa: S603 - fixed initializer and validated disposable container only
        [
            "/usr/bin/docker",
            "exec",
            "-i",
            "-e",
            "POSTGRES_USER=dinner_swipe_staging_owner",
            "-e",
            "POSTGRES_DB=dinner_swipe_staging",
            "-e",
            f"DINNER_STAGING_RUNTIME_PASSWORD={runtime_password}",
            container,
            "sh",
        ],
        input=initializer.read_bytes(),
        check=True,
        stdout=subprocess.DEVNULL,
    )
    migration = url.set(
        database="dinner_swipe_staging",
        username="dinner_swipe_staging_owner",
        password=owner_password,
    )
    os.environ["MIGRATION_DATABASE_URL"] = migration.render_as_string(hide_password=False)
    command.upgrade(Config("alembic.ini"), "head")
    with psycopg.connect(
        **{
            **connect,
            "dbname": "dinner_swipe_staging",
            "user": "dinner_swipe_staging_owner",
            "password": owner_password,
        },
        autocommit=True,
    ) as db:
        db.execute("CREATE TABLE permission_probe (id SERIAL PRIMARY KEY, value TEXT)")
    with psycopg.connect(
        **{
            **connect,
            "dbname": "dinner_swipe_staging",
            "user": "dinner_swipe_staging_runtime",
            "password": runtime_password,
        },
        autocommit=True,
    ) as db:
        db.execute("SELECT count(*) FROM complimentary_premium_access")
        db.execute("INSERT INTO permission_probe(value) VALUES ('synthetic')")
        db.execute("UPDATE permission_probe SET value='updated'")
        assert db.execute("SELECT value FROM permission_probe").fetchone() == ("updated",)
        db.execute("DELETE FROM permission_probe")
        for statement in (
            "CREATE TABLE forbidden(id INT)",
            "CREATE TEMP TABLE forbidden(id INT)",
            "ALTER TABLE permission_probe ADD COLUMN forbidden INT",
            "CREATE ROLE forbidden",
        ):
            try:
                db.execute(statement)
            except psycopg.errors.InsufficientPrivilege:
                continue
            raise AssertionError(
                "Runtime role unexpectedly has a schema or role-management privilege"
            )
    print("Staging initializer, real migrations, runtime DML and denied DDL/role creation passed.")


if __name__ == "__main__":
    main()
