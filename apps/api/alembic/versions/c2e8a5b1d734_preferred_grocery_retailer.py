"""preferred grocery retailer

Revision ID: c2e8a5b1d734
Revises: a77f1a9d4c32
Create Date: 2026-08-10 00:00:00.000000
"""

from __future__ import annotations

from alembic import op
import sqlalchemy as sa


revision: str = "c2e8a5b1d734"
down_revision: str | None = "a77f1a9d4c32"
branch_labels: str | None = None
depends_on: str | None = None


def upgrade() -> None:
    op.add_column(
        "user_profiles",
        sa.Column(
            "preferred_grocery_retailer",
            sa.String(length=32),
            nullable=False,
            server_default="walmart",
        ),
    )
    op.alter_column("user_profiles", "preferred_grocery_retailer", server_default=None)


def downgrade() -> None:
    op.drop_column("user_profiles", "preferred_grocery_retailer")
