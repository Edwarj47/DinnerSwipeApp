"""Separate group calendars, shopping inventories and explicit Discover choices."""

from alembic import op
import sqlalchemy as sa

revision = "a8f97b321c40"
down_revision = "f20b84e901ac"
branch_labels = None
depends_on = None


def timestamps():
    return [
        sa.Column("created_at", sa.DateTime(), nullable=False),
        sa.Column("updated_at", sa.DateTime(), nullable=False),
    ]


def upgrade() -> None:
    op.add_column(
        "households", sa.Column("planning_settings", sa.JSON(), nullable=False, server_default="{}")
    )
    for table, unique, constraint in (
        ("weekly_plans", "week_start", "ck_weekly_plan_scope"),
        ("grocery_lists", "weekly_plan_id", "ck_grocery_scope"),
        ("pantry_items", "normalized_name", "ck_pantry_scope"),
    ):
        with op.batch_alter_table(table) as batch:
            batch.alter_column("user_id", existing_type=sa.String(36), nullable=True)
            batch.add_column(sa.Column("household_id", sa.String(36), nullable=True))
            batch.create_foreign_key(
                f"fk_{table}_household", "households", ["household_id"], ["id"]
            )
            batch.create_index(f"ix_{table}_household_id", ["household_id"])
            batch.create_unique_constraint(
                f"uq_{table}_household_{unique}", ["household_id", unique]
            )
            batch.create_check_constraint(constraint, "(user_id IS NULL) <> (household_id IS NULL)")
    op.create_table(
        "household_discover_choices",
        sa.Column("id", sa.String(36), primary_key=True),
        sa.Column("household_id", sa.String(36), sa.ForeignKey("households.id"), nullable=False),
        sa.Column("recipe_id", sa.String(36), sa.ForeignKey("recipes.id"), nullable=False),
        *timestamps(),
        sa.UniqueConstraint("household_id", "recipe_id"),
    )
    op.create_table(
        "meal_proposals",
        sa.Column("id", sa.String(36), primary_key=True),
        sa.Column("household_id", sa.String(36), sa.ForeignKey("households.id"), nullable=False),
        sa.Column("recipe_id", sa.String(36), sa.ForeignKey("recipes.id"), nullable=False),
        sa.Column("week_start", sa.Date(), nullable=False),
        sa.Column("status", sa.String(16), nullable=False),
        sa.Column(
            "planned_slot_id", sa.String(36), sa.ForeignKey("weekly_plan_slots.id"), nullable=True
        ),
        *timestamps(),
        sa.UniqueConstraint("household_id", "week_start", "recipe_id"),
    )
    op.create_table(
        "meal_proposal_members",
        sa.Column("id", sa.String(36), primary_key=True),
        sa.Column("proposal_id", sa.String(36), sa.ForeignKey("meal_proposals.id"), nullable=False),
        sa.Column("user_id", sa.String(36), sa.ForeignKey("users.id"), nullable=False),
        *timestamps(),
        sa.UniqueConstraint("proposal_id", "user_id"),
    )
    for table, columns in (
        ("household_discover_choices", ("household_id", "recipe_id")),
        ("meal_proposals", ("household_id", "recipe_id", "week_start")),
        ("meal_proposal_members", ("proposal_id", "user_id")),
    ):
        for column in columns:
            op.create_index(f"ix_{table}_{column}", table, [column])
    with op.batch_alter_table("meal_swipes") as batch:
        batch.add_column(sa.Column("household_id", sa.String(36), nullable=True))
        batch.add_column(sa.Column("proposal_id", sa.String(36), nullable=True))
        batch.create_foreign_key("fk_swipe_household", "households", ["household_id"], ["id"])
        batch.create_foreign_key("fk_swipe_proposal", "meal_proposals", ["proposal_id"], ["id"])
        batch.create_index("ix_meal_swipes_household_id", ["household_id"])


def downgrade() -> None:
    # Downgrade cannot safely discard shared activity. Roll back application images instead.
    raise RuntimeError(
        "Retain the additive schema and restore previous service images for rollback."
    )
