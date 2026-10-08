"""Isolated nutrition identifiers, usage and budget ledger; no provider content."""

from alembic import op
import sqlalchemy as sa

revision = "b981fc2a7610"
down_revision = "a8f97b321c40"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "nutrition_food_identifiers",
        sa.Column("food_id", sa.String(20), primary_key=True),
        sa.Column("first_seen_at", sa.DateTime(), nullable=False),
        sa.Column("last_seen_at", sa.DateTime(), nullable=False),
        sa.Column("last_refreshed_at", sa.DateTime()),
    )
    op.create_index(
        "ix_nutrition_food_identifiers_last_refreshed_at",
        "nutrition_food_identifiers",
        ["last_refreshed_at"],
    )
    op.create_table(
        "nutrition_serving_identifiers",
        sa.Column(
            "food_id",
            sa.String(20),
            sa.ForeignKey("nutrition_food_identifiers.food_id"),
            primary_key=True,
        ),
        sa.Column("serving_id", sa.String(20), primary_key=True),
    )
    op.create_table(
        "nutrition_food_usage",
        sa.Column("id", sa.String(36), primary_key=True),
        sa.Column(
            "user_id", sa.String(36), sa.ForeignKey("users.id", ondelete="CASCADE"), nullable=False
        ),
        sa.Column("food_id", sa.String(20), nullable=False),
        sa.Column("serving_id", sa.String(20), nullable=False),
        sa.Column("portions", sa.Float(), nullable=False),
        sa.Column("used_at", sa.DateTime(), nullable=False),
        sa.Column("request_id", sa.String(36), nullable=False, unique=True),
        sa.ForeignKeyConstraint(
            ["food_id", "serving_id"],
            ["nutrition_serving_identifiers.food_id", "nutrition_serving_identifiers.serving_id"],
        ),
    )
    for column in ("user_id", "food_id", "used_at"):
        op.create_index(f"ix_nutrition_food_usage_{column}", "nutrition_food_usage", [column])
    op.create_table(
        "nutrition_provider_state",
        sa.Column("provider", sa.String(30), primary_key=True),
        sa.Column("next_request_at", sa.DateTime()),
        sa.Column("blocked_until", sa.DateTime()),
        sa.Column("block_reason", sa.String(40)),
    )
    op.execute("INSERT INTO nutrition_provider_state (provider) VALUES ('fatsecret')")
    op.create_table(
        "nutrition_api_calls",
        sa.Column("id", sa.String(36), primary_key=True),
        sa.Column("reserved_at", sa.DateTime(), nullable=False),
        sa.Column("background", sa.Integer(), nullable=False),
        sa.Column("kind", sa.String(20), nullable=False),
        sa.Column("outcome", sa.String(30), nullable=False),
    )
    op.create_index("ix_nutrition_api_calls_reserved_at", "nutrition_api_calls", ["reserved_at"])
    op.create_index(
        "ix_nutrition_calls_background_time", "nutrition_api_calls", ["background", "reserved_at"]
    )
    op.create_table(
        "nutrition_refresh_runs",
        sa.Column("run_date", sa.Date(), primary_key=True),
        sa.Column("lease_token", sa.String(36), nullable=False),
        sa.Column("lease_until", sa.DateTime(), nullable=False),
        sa.Column("started_at", sa.DateTime(), nullable=False),
        sa.Column("finished_at", sa.DateTime()),
        sa.Column("status", sa.String(30), nullable=False),
        sa.Column("refreshed", sa.Integer(), nullable=False),
        sa.Column("error_code", sa.String(40)),
    )


def downgrade() -> None:
    raise RuntimeError("Retain nutrition data and restore the prior application image for rollback.")
