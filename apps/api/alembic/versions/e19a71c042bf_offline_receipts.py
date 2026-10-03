"""Keep retry receipts for account-scoped offline edits."""

import sqlalchemy as sa

from alembic import op

revision = "e19a71c042bf"
down_revision = "d8126c4ab391"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "offline_receipts",
        sa.Column("id", sa.String(36), primary_key=True),
        sa.Column(
            "user_id", sa.String(36), sa.ForeignKey("users.id", ondelete="CASCADE"), nullable=False
        ),
        sa.Column("operation_id", sa.String(36), nullable=False),
        sa.Column("request_hash", sa.String(64), nullable=False),
        sa.Column("result", sa.JSON(), nullable=False),
        sa.Column("created_at", sa.DateTime(), nullable=False),
        sa.Column("updated_at", sa.DateTime(), nullable=False),
        sa.UniqueConstraint("user_id", "operation_id"),
    )
    op.create_index("ix_offline_receipts_user_id", "offline_receipts", ["user_id"])


def downgrade() -> None:
    op.drop_table("offline_receipts")
