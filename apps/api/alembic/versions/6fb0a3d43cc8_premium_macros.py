"""premium macro tracking

Revision ID: 6fb0a3d43cc8
Revises: 9d45f1c9a1ab
Create Date: 2026-08-07 00:00:00.000000
"""

from __future__ import annotations

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "6fb0a3d43cc8"
down_revision: str | None = "9d45f1c9a1ab"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.create_table(
        "user_subscriptions",
        sa.Column("id", sa.String(length=36), nullable=False),
        sa.Column("user_id", sa.String(length=36), nullable=False),
        sa.Column("plan_key", sa.String(length=64), nullable=False),
        sa.Column("status", sa.String(length=32), nullable=False),
        sa.Column("source", sa.String(length=32), nullable=False),
        sa.Column("stripe_customer_id", sa.String(length=120), nullable=True),
        sa.Column("stripe_subscription_id", sa.String(length=120), nullable=True),
        sa.Column("stripe_price_id", sa.String(length=120), nullable=True),
        sa.Column("current_period_end", sa.DateTime(), nullable=True),
        sa.Column("cancel_at_period_end", sa.Boolean(), nullable=False),
        sa.Column("fee_waiver_code_hash", sa.String(length=64), nullable=True),
        sa.Column("metadata_json", sa.JSON(), nullable=False),
        sa.Column("created_at", sa.DateTime(), nullable=False),
        sa.Column("updated_at", sa.DateTime(), nullable=False),
        sa.ForeignKeyConstraint(["user_id"], ["users.id"]),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("stripe_subscription_id"),
        sa.UniqueConstraint("user_id"),
    )
    op.create_index(op.f("ix_user_subscriptions_status"), "user_subscriptions", ["status"])
    op.create_index(
        op.f("ix_user_subscriptions_stripe_customer_id"),
        "user_subscriptions",
        ["stripe_customer_id"],
    )
    op.create_index(op.f("ix_user_subscriptions_user_id"), "user_subscriptions", ["user_id"])

    op.create_table(
        "macro_profile_targets",
        sa.Column("id", sa.String(length=36), nullable=False),
        sa.Column("user_id", sa.String(length=36), nullable=False),
        sa.Column("daily_calories", sa.Integer(), nullable=True),
        sa.Column("daily_protein_g", sa.Float(), nullable=True),
        sa.Column("daily_carbs_g", sa.Float(), nullable=True),
        sa.Column("daily_fat_g", sa.Float(), nullable=True),
        sa.Column("goal", sa.String(length=80), nullable=True),
        sa.Column("created_at", sa.DateTime(), nullable=False),
        sa.Column("updated_at", sa.DateTime(), nullable=False),
        sa.ForeignKeyConstraint(["user_id"], ["users.id"]),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("user_id"),
    )
    op.create_index(op.f("ix_macro_profile_targets_user_id"), "macro_profile_targets", ["user_id"])

    op.create_table(
        "recipe_macro_profiles",
        sa.Column("id", sa.String(length=36), nullable=False),
        sa.Column("recipe_id", sa.String(length=36), nullable=False),
        sa.Column("calories_per_serving", sa.Float(), nullable=True),
        sa.Column("protein_g_per_serving", sa.Float(), nullable=True),
        sa.Column("carbs_g_per_serving", sa.Float(), nullable=True),
        sa.Column("fat_g_per_serving", sa.Float(), nullable=True),
        sa.Column("fiber_g_per_serving", sa.Float(), nullable=True),
        sa.Column("source", sa.String(length=64), nullable=False),
        sa.Column("confidence", sa.Float(), nullable=True),
        sa.Column("needs_review", sa.Boolean(), nullable=False),
        sa.Column("created_at", sa.DateTime(), nullable=False),
        sa.Column("updated_at", sa.DateTime(), nullable=False),
        sa.ForeignKeyConstraint(["recipe_id"], ["recipes.id"]),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("recipe_id"),
    )
    op.create_index(op.f("ix_recipe_macro_profiles_recipe_id"), "recipe_macro_profiles", ["recipe_id"])

    op.create_table(
        "meal_macro_confirmations",
        sa.Column("id", sa.String(length=36), nullable=False),
        sa.Column("user_id", sa.String(length=36), nullable=False),
        sa.Column("recipe_id", sa.String(length=36), nullable=True),
        sa.Column("weekly_plan_slot_id", sa.String(length=36), nullable=True),
        sa.Column("meal_date", sa.Date(), nullable=False),
        sa.Column("status", sa.String(length=16), nullable=False),
        sa.Column("servings_consumed", sa.Float(), nullable=False),
        sa.Column("calories", sa.Float(), nullable=True),
        sa.Column("protein_g", sa.Float(), nullable=True),
        sa.Column("carbs_g", sa.Float(), nullable=True),
        sa.Column("fat_g", sa.Float(), nullable=True),
        sa.Column("fiber_g", sa.Float(), nullable=True),
        sa.Column("macro_source", sa.String(length=64), nullable=False),
        sa.Column("notes", sa.Text(), nullable=True),
        sa.Column("created_at", sa.DateTime(), nullable=False),
        sa.Column("updated_at", sa.DateTime(), nullable=False),
        sa.ForeignKeyConstraint(["recipe_id"], ["recipes.id"]),
        sa.ForeignKeyConstraint(["user_id"], ["users.id"]),
        sa.ForeignKeyConstraint(["weekly_plan_slot_id"], ["weekly_plan_slots.id"]),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index(
        "ix_meal_macro_confirmations_user_date",
        "meal_macro_confirmations",
        ["user_id", "meal_date"],
    )
    op.create_index(
        op.f("ix_meal_macro_confirmations_recipe_id"),
        "meal_macro_confirmations",
        ["recipe_id"],
    )
    op.create_index(
        op.f("ix_meal_macro_confirmations_user_id"),
        "meal_macro_confirmations",
        ["user_id"],
    )
    op.create_index(
        op.f("ix_meal_macro_confirmations_weekly_plan_slot_id"),
        "meal_macro_confirmations",
        ["weekly_plan_slot_id"],
    )


def downgrade() -> None:
    op.drop_index(
        op.f("ix_meal_macro_confirmations_weekly_plan_slot_id"),
        table_name="meal_macro_confirmations",
    )
    op.drop_index(op.f("ix_meal_macro_confirmations_user_id"), table_name="meal_macro_confirmations")
    op.drop_index(
        op.f("ix_meal_macro_confirmations_recipe_id"), table_name="meal_macro_confirmations"
    )
    op.drop_index("ix_meal_macro_confirmations_user_date", table_name="meal_macro_confirmations")
    op.drop_table("meal_macro_confirmations")
    op.drop_index(op.f("ix_recipe_macro_profiles_recipe_id"), table_name="recipe_macro_profiles")
    op.drop_table("recipe_macro_profiles")
    op.drop_index(op.f("ix_macro_profile_targets_user_id"), table_name="macro_profile_targets")
    op.drop_table("macro_profile_targets")
    op.drop_index(op.f("ix_user_subscriptions_user_id"), table_name="user_subscriptions")
    op.drop_index(
        op.f("ix_user_subscriptions_stripe_customer_id"), table_name="user_subscriptions"
    )
    op.drop_index(op.f("ix_user_subscriptions_status"), table_name="user_subscriptions")
    op.drop_table("user_subscriptions")
