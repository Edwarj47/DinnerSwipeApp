"""Fingerprint existing columns only, so additive defaults do not obscure row preservation."""

import hashlib
import json
import os
import sys
from pathlib import Path

import psycopg
from psycopg import sql

directory = Path(os.environ["DINNER_MIGRATION_CHECK_DIRECTORY"])
connection = psycopg.connect(os.environ["DATABASE_URL"].replace("postgresql+psycopg:", "postgresql:"))
record = directory / "legacy-fingerprints.json"
before = sys.argv[1] == "before"
expected = {} if before else json.loads(record.read_text())
with connection:
    with connection.cursor() as cursor:
        if before:
            cursor.execute("SELECT table_name FROM information_schema.tables WHERE table_schema = 'public' AND table_type = 'BASE TABLE' AND table_name != 'alembic_version' ORDER BY table_name")
            tables = [row[0] for row in cursor.fetchall()]
        else:
            tables = list(expected)
        observed = {}
        for table in tables:
            if before:
                cursor.execute("SELECT column_name FROM information_schema.columns WHERE table_schema = 'public' AND table_name = %s ORDER BY ordinal_position", (table,))
                columns = [row[0] for row in cursor.fetchall()]
            else:
                columns = expected[table]["columns"]
            cursor.execute(sql.SQL("SELECT {} FROM {}").format(sql.SQL(",").join(map(sql.Identifier, columns)), sql.Identifier(table)))
            rows = sorted(json.dumps(row, default=str, sort_keys=True) for row in cursor.fetchall())
            observed[table] = {"columns": columns, "rows": len(rows), "hash": hashlib.sha256("\n".join(rows).encode()).hexdigest()}
        if before:
            record.write_text(json.dumps(observed, indent=2))
        else:
            if observed != expected:
                raise RuntimeError("Legacy rows changed during migration.")
            for table in ("weekly_plans", "grocery_lists", "pantry_items"):
                cursor.execute(sql.SQL("SELECT count(*) FROM {} WHERE household_id IS NOT NULL OR user_id IS NULL").format(sql.Identifier(table)))
                assert cursor.fetchone()[0] == 0
            for table in ("meal_proposals", "meal_proposal_members", "household_discover_choices"):
                cursor.execute(sql.SQL("SELECT count(*) FROM {}").format(sql.Identifier(table)))
                assert cursor.fetchone()[0] == 0
        print(f"{'Captured' if before else 'Preserved'} {len(observed)} tables, {sum(value['rows'] for value in observed.values())} legacy rows.")
