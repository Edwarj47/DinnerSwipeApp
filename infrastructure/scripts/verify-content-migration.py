"""Test content migration and PostgreSQL races in a disposable backup clone only."""

from __future__ import annotations

import json
import os
import secrets
import subprocess
import time
from pathlib import Path
from uuid import uuid4

import psycopg


def run(*args: str, check: bool = True, **kwargs: object) -> subprocess.CompletedProcess[str]:
    # Executables/arguments are fixed by this operator script; no shell is used.
    return subprocess.run(args, check=check, text=True, **kwargs)  # noqa: S603


def fingerprints(db: psycopg.Connection) -> dict[str, object]:
    tables = db.execute(
        "SELECT tablename FROM pg_tables "
        "WHERE schemaname='public' AND tablename <> 'alembic_version'"
    ).fetchall()
    return {
        table: db.execute(
            psycopg.sql.SQL(
                "SELECT count(*),md5(coalesce(jsonb_agg(to_jsonb(t) ORDER BY "
                "to_jsonb(t)::text)::text,'[]')) FROM {} t"
            ).format(psycopg.sql.Identifier(table))
        ).fetchone()
        for (table,) in tables
    }


def main() -> None:
    import argparse

    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("backup", type=Path)
    args = parser.parse_args()
    root = Path(__file__).resolve().parents[2]
    name = f"dinner-swipe-content-check-{uuid4().hex[:8]}"
    password = secrets.token_hex(32)
    started = False
    try:
        run(
            "docker",
            "run",
            "--rm",
            "-d",
            "--name",
            name,
            "--memory",
            "384m",
            "--cpus",
            "0.5",
            "--tmpfs",
            "/var/lib/postgresql/data:rw,size=256m",
            "-p",
            "127.0.0.1::5432",
            "-e",
            "POSTGRES_USER=verify_owner",
            "-e",
            "POSTGRES_DB=content_test",
            "-e",
            "POSTGRES_PASSWORD",
            "postgres:16",
            env={**os.environ, "POSTGRES_PASSWORD": password},
            capture_output=True,
        )
        started = True
        for _ in range(60):
            ready = run(
                "/usr/bin/docker",
                "exec",
                name,
                "pg_isready",
                "-U",
                "verify_owner",
                capture_output=True,
                check=False,
            )
            if ready.returncode == 0:
                break
            time.sleep(1)
        else:
            raise RuntimeError("Disposable database did not start")
        with args.backup.open("rb") as stream:
            subprocess.run(  # noqa: S603 - generated container name; no shell or untrusted command
                [
                    "/usr/bin/docker",
                    "exec",
                    "-i",
                    name,
                    "pg_restore",
                    "--exit-on-error",
                    "--no-owner",
                    "--no-privileges",
                    "-U",
                    "verify_owner",
                    "-d",
                    "content_test",
                ],
                stdin=stream,
                check=True,
                capture_output=True,
            )
        port = int(
            run("docker", "port", name, "5432/tcp", capture_output=True).stdout.rsplit(":", 1)[1]
        )
        connection = {
            "host": "127.0.0.1",
            "port": port,
            "dbname": "content_test",
            "user": "verify_owner",
            "password": password,
        }
        url = f"postgresql+psycopg://verify_owner:{password}@127.0.0.1:{port}/content_test"
        env = {**os.environ, "DATABASE_URL": url, "MIGRATION_DATABASE_URL": url}
        python = str(root / "apps/api/.venv/bin/python")
        cwd = str(root / "apps/api")
        with psycopg.connect(**connection) as db:
            before = fingerprints(db)
        run(python, "-m", "alembic", "upgrade", "head", cwd=cwd, env=env)
        with psycopg.connect(**connection) as db:
            after = fingerprints(db)
            assert all(after.get(key) == value for key, value in before.items())
            assert set(after) - set(before) == {
                "content_automation_campaigns",
                "content_automation_batches",
                "content_automation_candidates",
            }
        run(python, "-m", "alembic", "downgrade", "c7e40b9d2a61", cwd=cwd, env=env)
        with psycopg.connect(**connection) as db:
            assert fingerprints(db) == before
        run(python, "-m", "alembic", "upgrade", "head", cwd=cwd, env=env)
        run(python, str(root / "infrastructure/scripts/verify-content-races.py"), cwd=cwd, env=env)
        print(
            json.dumps(
                {
                    "migration": "passed",
                    "rollback": "passed",
                    "unchanged_existing_tables": len(before),
                    "postgres_races": "passed",
                }
            )
        )
    finally:
        if started:
            run("/usr/bin/docker", "rm", "-f", name, capture_output=True)


if __name__ == "__main__":
    main()
