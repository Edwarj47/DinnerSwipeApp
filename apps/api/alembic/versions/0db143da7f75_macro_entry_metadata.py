"""macro entry metadata

Revision ID: 0db143da7f75
Revises: fb4a2c41d816
Create Date: 2026-09-07 00:00:00.000000
"""

from __future__ import annotations

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "0db143da7f75"
down_revision: str | None = "fb4a2c41d816"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    with op.batch_alter_table("meal_macro_confirmations") as batch:
        batch.add_column(sa.Column("entry_name", sa.String(length=160), nullable=True))
        batch.add_column(sa.Column("meal_label", sa.String(length=32), nullable=True))


def downgrade() -> None:
    with op.batch_alter_table("meal_macro_confirmations") as batch:
        batch.drop_column("meal_label")
        batch.drop_column("entry_name")
