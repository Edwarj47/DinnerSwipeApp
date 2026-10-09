"""Run explicitly with a migration-owner URL after taking a database backup."""

import os

import psycopg
from psycopg import sql
from sqlalchemy.engine import make_url


def main() -> None:
    url = make_url(os.environ["MIGRATION_DATABASE_URL"])
    if url.database not in {"dinner_swipe", "security_test"}:
        raise ValueError(
            "This script is restricted to the Dinner Swipe database or its disposable test"
        )
    password = os.environ["DINNER_SWIPE_RUNTIME_DB_PASSWORD"]
    if len(password) < 32:
        raise ValueError("Use a random runtime password of at least 32 characters")
    role = sql.Identifier("dinner_swipe_runtime")
    with psycopg.connect(
        host=url.host,
        port=url.port or 5432,
        dbname=url.database,
        user=url.username,
        password=url.password,
    ) as db:
        owner, database = db.execute(
            "SELECT current_user, current_database()"
        ).fetchone()
        if not db.execute(
            "SELECT 1 FROM pg_roles WHERE rolname = 'dinner_swipe_runtime'"
        ).fetchone():
            db.execute(
                sql.SQL(
                    "CREATE ROLE {} LOGIN PASSWORD {} NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS"
                ).format(role, sql.Literal(password))
            )
        else:
            if db.execute(
                "SELECT 1 FROM pg_auth_members WHERE member = (SELECT oid FROM pg_roles WHERE rolname = 'dinner_swipe_runtime')"
            ).fetchone():
                raise RuntimeError(
                    "Unexpected runtime role memberships require manual review"
                )
            db.execute(
                sql.SQL(
                    "ALTER ROLE {} LOGIN PASSWORD {} NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS"
                ).format(role, sql.Literal(password))
            )
        db.execute(
            sql.SQL("GRANT CONNECT ON DATABASE {} TO {}").format(
                sql.Identifier(database), role
            )
        )
        db.execute(
            sql.SQL("REVOKE CREATE, TEMP ON DATABASE {} FROM PUBLIC").format(
                sql.Identifier(database)
            )
        )
        db.execute("REVOKE CREATE ON SCHEMA public FROM PUBLIC")
        db.execute(sql.SQL("GRANT USAGE ON SCHEMA public TO {}").format(role))
        db.execute(
            sql.SQL(
                "GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO {}"
            ).format(role)
        )
        db.execute(
            sql.SQL(
                "GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO {}"
            ).format(role)
        )
        for kind, permissions in (
            ("TABLES", "SELECT, INSERT, UPDATE, DELETE"),
            ("SEQUENCES", "USAGE, SELECT"),
        ):
            db.execute(
                sql.SQL(
                    "ALTER DEFAULT PRIVILEGES FOR ROLE {} IN SCHEMA public GRANT {} ON {} TO {}"
                ).format(
                    sql.Identifier(owner), sql.SQL(permissions), sql.SQL(kind), role
                )
            )
    print("Runtime role configured; migration ownership unchanged.")


if __name__ == "__main__":
    main()
