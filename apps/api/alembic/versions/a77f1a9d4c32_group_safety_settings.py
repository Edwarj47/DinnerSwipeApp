"""group safety settings

Revision ID: a77f1a9d4c32
Revises: f5c2d9b8a610
Create Date: 2026-08-09 18:10:00.000000
"""

from __future__ import annotations

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "a77f1a9d4c32"
down_revision: str | None = "f5c2d9b8a610"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    with op.batch_alter_table("households") as batch:
        batch.add_column(
            sa.Column(
                "allergen_filter_mode",
                sa.String(length=16),
                nullable=False,
                server_default="warn",
            )
        )
        batch.add_column(
            sa.Column(
                "dislike_filter_mode",
                sa.String(length=16),
                nullable=False,
                server_default="warn",
            )
        )
    with op.batch_alter_table("households") as batch:
        batch.alter_column("allergen_filter_mode", server_default=None)
        batch.alter_column("dislike_filter_mode", server_default=None)


def downgrade() -> None:
    with op.batch_alter_table("households") as batch:
        batch.drop_column("dislike_filter_mode")
        batch.drop_column("allergen_filter_mode")
