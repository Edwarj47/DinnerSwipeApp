"""Private kitchens and group-scoped recipes and votes.

Revision ID: ca92e654710b
Revises: 0db143da7f75
"""
from __future__ import annotations

from datetime import datetime
from uuid import uuid4

import sqlalchemy as sa
from alembic import op

revision = "ca92e654710b"
down_revision = "0db143da7f75"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column("households", sa.Column("is_personal", sa.Boolean(), nullable=False, server_default=sa.false()))
    bind = op.get_bind()
    # Only the original, still-solo auto-created space becomes private. Existing shared
    # groups keep their membership, invite, name, and recipe access unchanged.
    bind.execute(sa.text("""
        UPDATE households SET is_personal = true
        WHERE id IN (
            SELECT h.id FROM households h
            JOIN household_members m ON m.household_id = h.id
            JOIN users u ON u.id = m.user_id
            WHERE m.role = 'owner' AND h.name = u.email || '''s household'
            AND (SELECT count(*) FROM household_members hm WHERE hm.household_id = h.id) = 1
        )
    """))
    op.create_table("household_votes",
        sa.Column("id", sa.String(36), primary_key=True),
        sa.Column("household_id", sa.String(36), sa.ForeignKey("households.id"), nullable=False),
        sa.Column("week_start", sa.Date(), nullable=False),
        sa.Column("user_id", sa.String(36), sa.ForeignKey("users.id"), nullable=False),
        sa.Column("recipe_id", sa.String(36), sa.ForeignKey("recipes.id"), nullable=False),
        sa.Column("vote", sa.String(16), nullable=False),
        sa.Column("created_at", sa.DateTime(), nullable=False),
        sa.Column("updated_at", sa.DateTime(), nullable=False),
        sa.UniqueConstraint("household_id", "week_start", "user_id", "recipe_id"),
    )
    for field in ("household_id", "week_start", "user_id", "recipe_id"):
        op.create_index(f"ix_household_votes_{field}", "household_votes", [field])
    # Retain the legacy table. Copy only votes whose original owner identifies a
    # single group, rather than guessing and exposing votes to the wrong group.
    bind.execute(sa.text("""
        INSERT INTO household_votes (id, household_id, week_start, user_id, recipe_id, vote, created_at, updated_at)
        SELECT v.id, m.household_id, p.week_start, v.user_id, v.recipe_id, v.vote, v.created_at, v.updated_at
        FROM weekly_plan_votes v JOIN weekly_plans p ON p.id = v.weekly_plan_id
        JOIN household_members m ON m.user_id = p.user_id AND m.role = 'owner'
        WHERE (SELECT count(*) FROM household_members owners WHERE owners.user_id = p.user_id AND owners.role = 'owner') = 1
    """))
    op.create_table("household_recipes",
        sa.Column("id", sa.String(36), primary_key=True),
        sa.Column("household_id", sa.String(36), sa.ForeignKey("households.id"), nullable=False),
        sa.Column("recipe_id", sa.String(36), sa.ForeignKey("recipes.id"), nullable=False),
        sa.Column("created_at", sa.DateTime(), nullable=False),
        sa.Column("updated_at", sa.DateTime(), nullable=False),
        sa.UniqueConstraint("household_id", "recipe_id"),
    )
    for field in ("household_id", "recipe_id"):
        op.create_index(f"ix_household_recipes_{field}", "household_recipes", [field])
    users_without_kitchen = bind.execute(sa.text("""
        SELECT u.id FROM users u WHERE NOT EXISTS (
            SELECT 1 FROM household_members m JOIN households h ON h.id = m.household_id
            WHERE m.user_id = u.id AND h.is_personal = true
        )
    """)).all()
    for (user_id,) in users_without_kitchen:
        kitchen_id = str(uuid4())
        now = datetime.utcnow()
        bind.execute(sa.text("""
            INSERT INTO households (id, name, is_personal, allergen_filter_mode, dislike_filter_mode, created_at, updated_at)
            VALUES (:id, 'My kitchen', true, 'warn', 'warn', :now, :now)
        """), {"id": kitchen_id, "now": now})
        bind.execute(sa.text("""
            INSERT INTO household_members (id, household_id, user_id, role, created_at, updated_at)
            VALUES (:id, :household_id, :user_id, 'owner', :now, :now)
        """), {"id": str(uuid4()), "household_id": kitchen_id, "user_id": user_id, "now": now})


def downgrade() -> None:
    # Back up before downgrade: this removes group-specific records created after upgrade.
    op.drop_table("household_recipes")
    op.drop_table("household_votes")
    with op.batch_alter_table("households") as batch:
        batch.drop_column("is_personal")
