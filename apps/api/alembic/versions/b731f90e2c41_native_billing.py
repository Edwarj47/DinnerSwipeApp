"""Native store ownership, encrypted purchase chains and notification retries."""

import sqlalchemy as sa
from alembic import op

revision = "b731f90e2c41"
down_revision = "ac18e1a9b610"
branch_labels = None
depends_on = None


def timestamps() -> list[sa.Column]:
    return [
        sa.Column("created_at", sa.DateTime(), nullable=False),
        sa.Column("updated_at", sa.DateTime(), nullable=False),
    ]


def upgrade() -> None:
    op.create_table(
        "native_billing_accounts",
        sa.Column("id", sa.String(36), primary_key=True),
        sa.Column(
            "user_id",
            sa.String(36),
            sa.ForeignKey("users.id", ondelete="SET NULL"),
            unique=True,
            nullable=True,
        ),
        sa.Column("apple_token", sa.String(36), unique=True, nullable=False),
        sa.Column("google_token", sa.String(64), unique=True, nullable=False),
        sa.Column("deleted_at", sa.DateTime(), nullable=True),
        *timestamps(),
    )
    op.create_table(
        "native_purchases",
        sa.Column("id", sa.String(36), primary_key=True),
        sa.Column(
            "account_id", sa.String(36), sa.ForeignKey("native_billing_accounts.id"), nullable=False
        ),
        sa.Column("provider", sa.String(16), nullable=False),
        sa.Column("environment", sa.String(16), nullable=False),
        sa.Column("chain_hash", sa.String(64), nullable=False),
        sa.Column("reference_encrypted", sa.Text(), nullable=False),
        sa.Column("product_id", sa.String(255), nullable=False),
        sa.Column("state", sa.String(40), nullable=False),
        sa.Column("expires_at", sa.DateTime(), nullable=True),
        sa.Column("valid_until", sa.DateTime(), nullable=True),
        sa.Column("verified_at", sa.DateTime(), nullable=False),
        sa.Column("auto_renew", sa.Boolean(), nullable=False),
        sa.Column("ack_pending", sa.Boolean(), nullable=False),
        sa.Column("superseded", sa.Boolean(), nullable=False),
        sa.Column("attempts", sa.Integer(), nullable=False),
        sa.Column("next_check_at", sa.DateTime(), nullable=False),
        *timestamps(),
        sa.UniqueConstraint("provider", "environment", "chain_hash"),
    )
    op.create_index("ix_native_purchases_account_id", "native_purchases", ["account_id"])
    op.create_index("ix_native_purchases_next_check_at", "native_purchases", ["next_check_at"])
    op.create_table(
        "native_billing_notifications",
        sa.Column("id", sa.String(36), primary_key=True),
        sa.Column("provider", sa.String(16), nullable=False),
        sa.Column("event_hash", sa.String(64), nullable=False),
        sa.Column("reference_encrypted", sa.Text(), nullable=True),
        sa.Column("status", sa.String(16), nullable=False),
        sa.Column("attempts", sa.Integer(), nullable=False),
        sa.Column("next_check_at", sa.DateTime(), nullable=False),
        *timestamps(),
        sa.UniqueConstraint("provider", "event_hash"),
    )
    op.create_index(
        "ix_native_billing_notifications_next_check_at",
        "native_billing_notifications",
        ["next_check_at"],
    )


def downgrade() -> None:
    for name in ("native_purchases", "native_billing_notifications", "native_billing_accounts"):
        if op.get_bind().scalar(sa.text(f"SELECT count(*) FROM {name}")):
            raise RuntimeError("Native ownership tombstones must not be discarded by downgrade.")
    for name in ("native_purchases", "native_billing_notifications", "native_billing_accounts"):
        op.drop_table(name)
