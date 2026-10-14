"""Isolated workout templates, calendars, proposals and private performance logs."""

import sqlalchemy as sa

from alembic import op

revision = "c7e40b9d2a61"
down_revision = "f431d986a201"
branch_labels = None
depends_on = None


def timestamps() -> list[sa.Column]:
    return [
        sa.Column("created_at", sa.DateTime(), nullable=False),
        sa.Column("updated_at", sa.DateTime(), nullable=False),
    ]


def upgrade() -> None:
    op.create_table(
        "workout_templates",
        sa.Column("id", sa.String(36), primary_key=True),
        sa.Column("owner_id", sa.String(36), sa.ForeignKey("users.id"), nullable=False),
        sa.Column("title", sa.String(160), nullable=False),
        sa.Column("category", sa.String(16), nullable=False),
        sa.Column("photo_url", sa.String(2048), nullable=True),
        sa.Column("description", sa.Text(), nullable=True),
        sa.Column("exercises", sa.JSON(), nullable=False),
        *timestamps(),
        sa.CheckConstraint(
            "category IN ('upper', 'lower', 'cardio', 'full_body')",
            name="ck_workout_template_category",
        ),
    )
    op.create_table(
        "workout_template_shares",
        sa.Column("id", sa.String(36), primary_key=True),
        sa.Column("household_id", sa.String(36), sa.ForeignKey("households.id"), nullable=False),
        sa.Column(
            "template_id", sa.String(36), sa.ForeignKey("workout_templates.id"), nullable=False
        ),
        sa.Column("discover_enabled", sa.Boolean(), nullable=False, server_default=sa.false()),
        sa.Column("snapshot", sa.JSON(), nullable=False),
        *timestamps(),
        sa.UniqueConstraint("household_id", "template_id"),
    )
    op.create_table(
        "workout_planning_preferences",
        sa.Column("id", sa.String(36), primary_key=True),
        sa.Column("user_id", sa.String(36), sa.ForeignKey("users.id"), nullable=True),
        sa.Column("household_id", sa.String(36), sa.ForeignKey("households.id"), nullable=True),
        sa.Column("mode", sa.String(16), nullable=False),
        sa.Column("reset_day", sa.Integer(), nullable=False),
        sa.Column("notify", sa.Boolean(), nullable=False),
        sa.Column("time_zone", sa.String(80), nullable=False),
        sa.Column("cursor", sa.Date(), nullable=True),
        *timestamps(),
        sa.UniqueConstraint("user_id"),
        sa.UniqueConstraint("household_id"),
        sa.CheckConstraint(
            "(user_id IS NULL) <> (household_id IS NULL)", name="ck_workout_preference_scope"
        ),
        sa.CheckConstraint("mode IN ('manual', 'automatic')", name="ck_workout_preference_mode"),
        sa.CheckConstraint("reset_day BETWEEN 0 AND 6", name="ck_workout_preference_reset_day"),
    )
    op.create_table(
        "workout_plans",
        sa.Column("id", sa.String(36), primary_key=True),
        sa.Column("user_id", sa.String(36), sa.ForeignKey("users.id"), nullable=True),
        sa.Column("household_id", sa.String(36), sa.ForeignKey("households.id"), nullable=True),
        sa.Column("week_start", sa.Date(), nullable=False),
        *timestamps(),
        sa.UniqueConstraint("user_id", "week_start"),
        sa.UniqueConstraint("household_id", "week_start"),
        sa.CheckConstraint(
            "(user_id IS NULL) <> (household_id IS NULL)", name="ck_workout_plan_scope"
        ),
    )
    op.create_table(
        "workout_plan_slots",
        sa.Column("id", sa.String(36), primary_key=True),
        sa.Column("plan_id", sa.String(36), sa.ForeignKey("workout_plans.id"), nullable=False),
        sa.Column(
            "template_id", sa.String(36), sa.ForeignKey("workout_templates.id"), nullable=False
        ),
        sa.Column("slot_date", sa.Date(), nullable=True),
        sa.Column("sort_order", sa.Integer(), nullable=False),
        sa.Column("snapshot", sa.JSON(), nullable=False),
        *timestamps(),
        sa.CheckConstraint("sort_order >= 0", name="ck_workout_slot_order"),
    )
    op.create_table(
        "workout_proposals",
        sa.Column("id", sa.String(36), primary_key=True),
        sa.Column("household_id", sa.String(36), sa.ForeignKey("households.id"), nullable=False),
        sa.Column(
            "template_id", sa.String(36), sa.ForeignKey("workout_templates.id"), nullable=False
        ),
        sa.Column("week_start", sa.Date(), nullable=False),
        sa.Column("status", sa.String(16), nullable=False),
        sa.Column("snapshot", sa.JSON(), nullable=False),
        sa.Column(
            "planned_slot_id",
            sa.String(36),
            sa.ForeignKey("workout_plan_slots.id", ondelete="SET NULL"),
            nullable=True,
        ),
        *timestamps(),
        sa.UniqueConstraint("household_id", "week_start", "template_id"),
        sa.CheckConstraint(
            "status IN ('pending', 'approved', 'rejected')", name="ck_workout_proposal_status"
        ),
    )
    op.create_table(
        "workout_proposal_members",
        sa.Column("id", sa.String(36), primary_key=True),
        sa.Column(
            "proposal_id", sa.String(36), sa.ForeignKey("workout_proposals.id"), nullable=False
        ),
        sa.Column("user_id", sa.String(36), sa.ForeignKey("users.id"), nullable=False),
        *timestamps(),
        sa.UniqueConstraint("proposal_id", "user_id"),
    )
    op.create_table(
        "workout_logs",
        sa.Column("id", sa.String(36), primary_key=True),
        sa.Column("user_id", sa.String(36), sa.ForeignKey("users.id"), nullable=False),
        sa.Column("request_uuid", sa.String(36), nullable=False),
        sa.Column(
            "template_id", sa.String(36), sa.ForeignKey("workout_templates.id"), nullable=False
        ),
        sa.Column("performed_on", sa.Date(), nullable=False),
        sa.Column("completed", sa.Boolean(), nullable=False),
        sa.Column("notes", sa.Text(), nullable=True),
        sa.Column("sets", sa.JSON(), nullable=False),
        sa.Column("exercise_details", sa.JSON(), nullable=False, server_default="[]"),
        sa.Column("snapshot", sa.JSON(), nullable=False),
        *timestamps(),
        sa.UniqueConstraint("user_id", "request_uuid"),
    )
    for table, columns in (
        ("workout_templates", ("owner_id",)),
        ("workout_template_shares", ("household_id", "template_id")),
        ("workout_plans", ("user_id", "household_id")),
        ("workout_planning_preferences", ("user_id", "household_id")),
        ("workout_plan_slots", ("plan_id", "template_id")),
        ("workout_proposals", ("household_id", "template_id")),
        ("workout_proposal_members", ("proposal_id", "user_id")),
        ("workout_logs", ("user_id", "template_id", "performed_on")),
    ):
        for column in columns:
            op.create_index(f"ix_{table}_{column}", table, [column])


def downgrade() -> None:
    for table in (
        "workout_logs",
        "workout_proposal_members",
        "workout_proposals",
        "workout_plan_slots",
        "workout_plans",
        "workout_planning_preferences",
        "workout_template_shares",
        "workout_templates",
    ):
        op.drop_table(table)
