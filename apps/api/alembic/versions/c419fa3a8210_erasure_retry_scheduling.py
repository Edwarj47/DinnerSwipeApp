"""Bound durable erasure retries without changing existing account content."""

import sqlalchemy as sa

from alembic import op

revision = "c419fa3a8210"
down_revision = "b731f90e2c41"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column(
        "account_erasures",
        sa.Column("next_attempt_at", sa.DateTime(), nullable=False, server_default=sa.func.now()),
    )
    op.add_column("account_erasures", sa.Column("last_error_code", sa.String(40), nullable=True))
    op.create_index("ix_account_erasures_next_attempt_at", "account_erasures", ["next_attempt_at"])


def downgrade() -> None:
    op.drop_index("ix_account_erasures_next_attempt_at", table_name="account_erasures")
    op.drop_column("account_erasures", "last_error_code")
    op.drop_column("account_erasures", "next_attempt_at")
