"""Verify that the additive nutrition migration preserves every existing row."""

import hashlib
import json
import os
import sys
from pathlib import Path

import psycopg
from psycopg import sql

directory = Path(os.environ["DINNER_NUTRITION_CHECK_DIRECTORY"])
record = directory / "legacy-fingerprints.json"
before = sys.argv[1] == "before"
expected = {} if before else json.loads(record.read_text())
url = os.environ["DATABASE_URL"].replace("postgresql+psycopg:", "postgresql:")
with psycopg.connect(url) as connection, connection.cursor() as cursor:
    if before:
        cursor.execute("SELECT table_name FROM information_schema.tables WHERE table_schema = 'public' AND table_type = 'BASE TABLE' AND table_name != 'alembic_version' AND table_name NOT LIKE 'nutrition_%' ORDER BY table_name")
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
    elif observed != expected:
        raise RuntimeError("Existing rows changed during nutrition migration.")
    print(f"{'Captured' if before else 'Preserved'} {len(observed)} tables and {sum(item['rows'] for item in observed.values())} existing rows.")
