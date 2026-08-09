"""onboarding tutorial state

Revision ID: f5c2d9b8a610
Revises: d5d70bb7a3cb
Create Date: 2026-08-09 03:40:00.000000
"""

from __future__ import annotations

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "f5c2d9b8a610"
down_revision: str | None = "d5d70bb7a3cb"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    with op.batch_alter_table("user_profiles") as batch:
        batch.add_column(sa.Column("onboarding_completed_at", sa.DateTime(), nullable=True))
        batch.add_column(sa.Column("tutorial_completed_at", sa.DateTime(), nullable=True))
        batch.add_column(sa.Column("tutorial_dismissed_at", sa.DateTime(), nullable=True))
        batch.add_column(sa.Column("tutorial_version_seen", sa.String(length=40), nullable=True))


def downgrade() -> None:
    with op.batch_alter_table("user_profiles") as batch:
        batch.drop_column("tutorial_version_seen")
        batch.drop_column("tutorial_dismissed_at")
        batch.drop_column("tutorial_completed_at")
        batch.drop_column("onboarding_completed_at")
