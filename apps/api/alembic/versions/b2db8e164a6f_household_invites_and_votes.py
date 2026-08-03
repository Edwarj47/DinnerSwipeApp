"""household invites and votes

Revision ID: b2db8e164a6f
Revises: 8400307f3e4b
Create Date: 2026-08-02 20:05:00.000000
"""

from __future__ import annotations

import secrets
import string

import sqlalchemy as sa
from alembic import op

revision = "b2db8e164a6f"
down_revision = "8400307f3e4b"
branch_labels = None
depends_on = None


def _invite_code() -> str:
    alphabet = string.ascii_uppercase + string.digits
    return "".join(secrets.choice(alphabet) for _ in range(8))


def upgrade() -> None:
    with op.batch_alter_table("households") as batch:
        batch.add_column(sa.Column("invite_code", sa.String(length=16), nullable=True))
        batch.create_unique_constraint("uq_households_invite_code", ["invite_code"])
    bind = op.get_bind()
    rows = bind.execute(sa.text("select id from households where invite_code is null")).all()
    used: set[str] = set()
    for (household_id,) in rows:
        code = _invite_code()
        while code in used:
            code = _invite_code()
        used.add(code)
        bind.execute(
            sa.text("update households set invite_code = :code where id = :id"),
            {"code": code, "id": household_id},
        )
    op.create_table(
        "weekly_plan_votes",
        sa.Column("id", sa.String(length=36), nullable=False),
        sa.Column("weekly_plan_id", sa.String(length=36), nullable=False),
        sa.Column("user_id", sa.String(length=36), nullable=False),
        sa.Column("recipe_id", sa.String(length=36), nullable=False),
        sa.Column("vote", sa.String(length=16), nullable=False),
        sa.Column("created_at", sa.DateTime(), nullable=False),
        sa.Column("updated_at", sa.DateTime(), nullable=False),
        sa.ForeignKeyConstraint(["recipe_id"], ["recipes.id"]),
        sa.ForeignKeyConstraint(["user_id"], ["users.id"]),
        sa.ForeignKeyConstraint(["weekly_plan_id"], ["weekly_plans.id"]),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("weekly_plan_id", "user_id", "recipe_id"),
    )
    op.create_index(op.f("ix_weekly_plan_votes_recipe_id"), "weekly_plan_votes", ["recipe_id"])
    op.create_index(op.f("ix_weekly_plan_votes_user_id"), "weekly_plan_votes", ["user_id"])
    op.create_index(
        op.f("ix_weekly_plan_votes_weekly_plan_id"), "weekly_plan_votes", ["weekly_plan_id"]
    )


def downgrade() -> None:
    op.drop_index(op.f("ix_weekly_plan_votes_weekly_plan_id"), table_name="weekly_plan_votes")
    op.drop_index(op.f("ix_weekly_plan_votes_user_id"), table_name="weekly_plan_votes")
    op.drop_index(op.f("ix_weekly_plan_votes_recipe_id"), table_name="weekly_plan_votes")
    op.drop_table("weekly_plan_votes")
    with op.batch_alter_table("households") as batch:
        batch.drop_constraint("uq_households_invite_code", type_="unique")
        batch.drop_column("invite_code")
