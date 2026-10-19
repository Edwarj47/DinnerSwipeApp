"""Owner-private 35-day content campaigns and capped review staging.

Revision ID: d9b46e13a702
Revises: c7e40b9d2a61
"""

from typing import Any

import sqlalchemy as sa

from alembic import op

revision = "d9b46e13a702"
down_revision = "c7e40b9d2a61"
branch_labels = None
depends_on = None


def timestamps() -> list[sa.Column[Any]]:
    return [
        sa.Column("created_at", sa.DateTime(), nullable=False),
        sa.Column("updated_at", sa.DateTime(), nullable=False),
    ]


def upgrade() -> None:
    op.create_table(
        "content_automation_campaigns",
        sa.Column("id", sa.String(36), primary_key=True),
        sa.Column("user_id", sa.String(36), sa.ForeignKey("users.id"), nullable=False),
        sa.Column("status", sa.String(16), nullable=False),
        sa.Column("time_zone", sa.String(80), nullable=False),
        sa.Column("start_date", sa.Date(), nullable=False),
        sa.Column("end_date", sa.Date(), nullable=False),
        sa.Column("days_total", sa.Integer(), nullable=False),
        *timestamps(),
        sa.UniqueConstraint("user_id", name="uq_content_campaign_owner"),
        sa.UniqueConstraint("id", "user_id", name="uq_content_campaign_scope"),
        sa.CheckConstraint("days_total = 35", name="ck_content_campaign_days"),
        sa.CheckConstraint("time_zone = 'America/New_York'", name="ck_content_campaign_zone"),
        sa.CheckConstraint("end_date >= start_date", name="ck_content_campaign_dates"),
        sa.CheckConstraint(
            "status IN ('active', 'paused', 'completed')", name="ck_content_campaign_status"
        ),
    )
    op.create_table(
        "content_automation_batches",
        sa.Column("id", sa.String(36), primary_key=True),
        sa.Column("campaign_id", sa.String(36), nullable=False),
        sa.Column("user_id", sa.String(36), nullable=False),
        sa.Column("scheduled_date", sa.Date(), nullable=False),
        sa.Column("status", sa.String(16), nullable=False),
        sa.Column("lease_token", sa.String(36), nullable=True),
        sa.Column("lease_expires_at", sa.DateTime(), nullable=True),
        sa.Column("attempts", sa.Integer(), nullable=False),
        sa.Column("report", sa.JSON(), nullable=False),
        sa.Column("finished_at", sa.DateTime(), nullable=True),
        *timestamps(),
        sa.ForeignKeyConstraint(
            ["campaign_id", "user_id"],
            ["content_automation_campaigns.id", "content_automation_campaigns.user_id"],
            name="fk_content_batch_scope",
        ),
        sa.UniqueConstraint("campaign_id", "scheduled_date", name="uq_content_batch_date"),
        sa.UniqueConstraint("id", "user_id", name="uq_content_batch_scope"),
        sa.CheckConstraint(
            "status IN ('running', 'complete', 'partial', 'skipped')",
            name="ck_content_batch_status",
        ),
        sa.CheckConstraint("attempts >= 0", name="ck_content_batch_attempts"),
    )
    op.create_table(
        "content_automation_candidates",
        sa.Column("id", sa.String(36), primary_key=True),
        sa.Column("batch_id", sa.String(36), nullable=False),
        sa.Column("user_id", sa.String(36), nullable=False),
        sa.Column("kind", sa.String(16), nullable=False),
        sa.Column("slot", sa.Integer(), nullable=False),
        sa.Column("status", sa.String(16), nullable=False),
        sa.Column("title", sa.String(240), nullable=False),
        sa.Column("payload", sa.JSON(), nullable=False),
        sa.Column("source_url", sa.Text(), nullable=False),
        sa.Column("source_name", sa.String(240), nullable=False),
        sa.Column("canonical_source_url", sa.Text(), nullable=False),
        sa.Column("source_hash", sa.String(64), nullable=False),
        sa.Column("content_hash", sa.String(64), nullable=False),
        sa.Column("provenance", sa.JSON(), nullable=False),
        sa.Column("warnings", sa.JSON(), nullable=False),
        sa.Column("recipe_id", sa.String(36), sa.ForeignKey("recipes.id"), nullable=True),
        sa.Column(
            "workout_template_id",
            sa.String(36),
            sa.ForeignKey("workout_templates.id"),
            nullable=True,
        ),
        sa.Column("decided_at", sa.DateTime(), nullable=True),
        *timestamps(),
        sa.ForeignKeyConstraint(
            ["batch_id", "user_id"],
            ["content_automation_batches.id", "content_automation_batches.user_id"],
            name="fk_content_candidate_scope",
        ),
        sa.UniqueConstraint("batch_id", "kind", "slot", name="uq_content_candidate_slot"),
        sa.UniqueConstraint("user_id", "kind", "source_hash", name="uq_content_candidate_source"),
        sa.UniqueConstraint("user_id", "kind", "content_hash", name="uq_content_candidate_content"),
        sa.CheckConstraint("slot BETWEEN 1 AND 5", name="ck_content_candidate_slot"),
        sa.CheckConstraint("kind IN ('recipe', 'workout')", name="ck_content_candidate_kind"),
        sa.CheckConstraint(
            "status IN ('pending', 'approved', 'dismissed')", name="ck_content_candidate_status"
        ),
        sa.CheckConstraint(
            "(status = 'approved' AND ((kind = 'recipe' AND recipe_id IS NOT NULL "
            "AND workout_template_id IS NULL) OR (kind = 'workout' AND recipe_id IS NULL "
            "AND workout_template_id IS NOT NULL))) OR (status <> 'approved' "
            "AND recipe_id IS NULL AND workout_template_id IS NULL)",
            name="ck_content_candidate_result",
        ),
    )
    for table, columns in (
        ("content_automation_batches", ("campaign_id", "user_id")),
        ("content_automation_candidates", ("batch_id", "user_id")),
    ):
        for column in columns:
            op.create_index(f"ix_{table}_{column}", table, [column])


def downgrade() -> None:
    op.drop_table("content_automation_candidates")
    op.drop_table("content_automation_batches")
    op.drop_table("content_automation_campaigns")
