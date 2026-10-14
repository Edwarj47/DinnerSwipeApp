"""Verify additive migrations using synthetic data in a disposable PostgreSQL container."""

from __future__ import annotations

import os
import secrets
import subprocess
import time
from pathlib import Path
from uuid import uuid4

import psycopg


def run(*args: str, **kwargs: object) -> subprocess.CompletedProcess[str]:
    return subprocess.run(args, check=True, text=True, **kwargs)


def main() -> None:
    root = Path(__file__).resolve().parents[2]
    python = str(root / "apps/api/.venv/bin/python")
    name = f"codex-dinner-expansion-pg-{uuid4().hex[:8]}"
    password = secrets.token_urlsafe(48)
    container_env = {**os.environ, "POSTGRES_PASSWORD": password}
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
            "256m",
            "--cpus",
            "0.5",
            "--tmpfs",
            "/var/lib/postgresql/data:rw,size=256m",
            "-p",
            "127.0.0.1::5432",
            "-e",
            "POSTGRES_USER=verify_owner",
            "-e",
            "POSTGRES_DB=expansion_test",
            "-e",
            "POSTGRES_PASSWORD",
            "postgres:16",
            env=container_env,
            capture_output=True,
        )
        started = True
        for _ in range(60):
            ready = subprocess.run(
                ["docker", "exec", name, "pg_isready", "-U", "verify_owner"], capture_output=True
            )
            if ready.returncode == 0:
                break
            time.sleep(1)
        else:
            raise RuntimeError("Disposable database did not start")
        port = (
            run("docker", "port", name, "5432/tcp", capture_output=True)
            .stdout.strip()
            .rsplit(":", 1)[1]
        )
        url = f"postgresql+psycopg://verify_owner:{password}@127.0.0.1:{port}/expansion_test"
        env = {**os.environ, "DATABASE_URL": url, "MIGRATION_DATABASE_URL": url}
        cwd = str(root / "apps/api")
        run(python, "-m", "alembic", "upgrade", "e43b2d801a9c", cwd=cwd, env=env)
        with psycopg.connect(
            host="127.0.0.1",
            port=int(port),
            dbname="expansion_test",
            user="verify_owner",
            password=password,
        ) as db:
            user, recipe, plan, slot = [str(uuid4()) for _ in range(4)]
            db.execute(
                "INSERT INTO users (id,email,password_hash,is_active,email_verified,created_at,updated_at) VALUES (%s,%s,%s,true,true,now(),now())",
                (user, "migration-fixture@example.com", "synthetic-not-a-password"),
            )
            db.execute(
                "INSERT INTO recipes (id,name,owner_user_id,servings,validation_status,source_type,prep_minutes,cook_minutes,difficulty,meal_type,created_by,content_hash,image_status,duplicate_status,validation_warnings,created_at,updated_at) VALUES (%s,'Original meal',%s,2,'approved','manual',10,20,'easy','dinner','manual','synthetic','pending','new','[]',now(),now())",
                (recipe, user),
            )
            db.execute(
                "INSERT INTO weekly_plans (id,user_id,week_start,meal_target,created_at,updated_at) VALUES (%s,%s,'2026-01-05',1,now(),now())",
                (plan, user),
            )
            db.execute(
                "INSERT INTO weekly_plan_slots (id,weekly_plan_id,recipe_id,slot_date,slot_type,servings,sort_order,is_locked,created_at,updated_at) VALUES (%s,%s,%s,'2026-01-06','meal',2,0,false,now(),now())",
                (slot, plan, recipe),
            )
        run(python, "-m", "alembic", "upgrade", "head", cwd=cwd, env=env)
        with psycopg.connect(
            host="127.0.0.1",
            port=int(port),
            dbname="expansion_test",
            user="verify_owner",
            password=password,
        ) as db:
            row = db.execute(
                "SELECT servings,slot_date,history_snapshot FROM weekly_plan_slots WHERE id=%s",
                (slot,),
            ).fetchone()
            assert row and row[0] == 2 and str(row[1]) == "2026-01-06"
            assert row[2]["recipe_name"] == "Original meal" and row[2]["recipe_total_minutes"] == 30
            before = db.execute("SELECT count(*) FROM recipes").fetchone()
        run(python, "-m", "alembic", "downgrade", "e43b2d801a9c", cwd=cwd, env=env)
        with psycopg.connect(
            host="127.0.0.1",
            port=int(port),
            dbname="expansion_test",
            user="verify_owner",
            password=password,
        ) as db:
            assert db.execute("SELECT count(*) FROM recipes").fetchone() == before
            assert db.execute(
                "SELECT servings FROM weekly_plan_slots WHERE id=%s", (slot,)
            ).fetchone() == (2,)
        print("Migration upgrade, snapshot backfill and disposable rollback passed.")
    finally:
        if started:
            subprocess.run(["docker", "rm", "-f", name], check=True, capture_output=True)


if __name__ == "__main__":
    main()
