"""url candidate recycle bin

Revision ID: fb4a2c41d816
Revises: c2e8a5b1d734
Create Date: 2026-08-27 10:30:00.000000
"""

from __future__ import annotations

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "fb4a2c41d816"
down_revision: str | None = "c2e8a5b1d734"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    with op.batch_alter_table("url_ingestion_candidates") as batch:
        batch.add_column(sa.Column("rejected_at", sa.DateTime(), nullable=True))


def downgrade() -> None:
    with op.batch_alter_table("url_ingestion_candidates") as batch:
        batch.drop_column("rejected_at")
