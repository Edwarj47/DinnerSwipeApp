"""user legal acceptance

Revision ID: d5d70bb7a3cb
Revises: 6fb0a3d43cc8
Create Date: 2026-08-07 21:05:00.000000
"""

from __future__ import annotations

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "d5d70bb7a3cb"
down_revision: str | None = "6fb0a3d43cc8"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    with op.batch_alter_table("users") as batch:
        batch.add_column(sa.Column("terms_accepted_at", sa.DateTime(), nullable=True))
        batch.add_column(sa.Column("privacy_accepted_at", sa.DateTime(), nullable=True))
        batch.add_column(sa.Column("legal_acceptance_version", sa.String(length=40), nullable=True))


def downgrade() -> None:
    with op.batch_alter_table("users") as batch:
        batch.drop_column("legal_acceptance_version")
        batch.drop_column("privacy_accepted_at")
        batch.drop_column("terms_accepted_at")
