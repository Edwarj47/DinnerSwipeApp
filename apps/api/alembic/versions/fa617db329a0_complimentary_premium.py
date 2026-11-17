"""Separate no-card welcome eligibility from paid subscriptions."""

import sqlalchemy as sa

from alembic import op

revision = "fa617db329a0"
down_revision = "d9b46e13a702"
branch_labels = None
depends_on = None


def upgrade() -> None:
    # No backfill: existing subscriptions and accounts retain their current terms.
    op.create_table(
        "complimentary_premium_access",
        sa.Column(
            "user_id",
            sa.String(36),
            sa.ForeignKey("users.id", ondelete="CASCADE"),
            primary_key=True,
        ),
        sa.Column("offer_key", sa.String(64), nullable=False),
        sa.Column("started_at", sa.DateTime(), nullable=True),
        sa.Column("ends_at", sa.DateTime(), nullable=True),
        sa.Column("created_at", sa.DateTime(), nullable=False),
        sa.Column("updated_at", sa.DateTime(), nullable=False),
        sa.CheckConstraint(
            "(started_at IS NULL AND ends_at IS NULL) OR "
            "(started_at IS NOT NULL AND ends_at IS NOT NULL AND ends_at > started_at)",
            name="ck_complimentary_access_dates",
        ),
    )


def downgrade() -> None:
    op.drop_table("complimentary_premium_access")
