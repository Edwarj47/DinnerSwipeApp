"""Snapshot selected recipe metadata without retaining provider nutrition."""

import sqlalchemy as sa

from alembic import op

revision = "f431d986a201"
down_revision = "e43b2d801a9c"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column("weekly_plan_slots", sa.Column("history_snapshot", sa.JSON(), nullable=True))
    slots = sa.table(
        "weekly_plan_slots",
        sa.column("id"),
        sa.column("recipe_id"),
        sa.column("history_snapshot", sa.JSON()),
    )
    recipes = sa.table(
        "recipes",
        sa.column("id"),
        sa.column("name"),
        sa.column("total_minutes"),
        sa.column("prep_minutes"),
        sa.column("cook_minutes"),
        sa.column("difficulty"),
        sa.column("meal_type"),
    )
    bind = op.get_bind()
    rows = (
        bind.execute(
            sa.select(
                slots.c.id,
                recipes.c.id.label("recipe_id"),
                recipes.c.name,
                recipes.c.total_minutes,
                recipes.c.prep_minutes,
                recipes.c.cook_minutes,
                recipes.c.difficulty,
                recipes.c.meal_type,
            ).select_from(slots.join(recipes, slots.c.recipe_id == recipes.c.id))
        )
        .mappings()
        .all()
    )
    for row in rows:
        total = row["total_minutes"]
        if row["prep_minutes"] is not None or row["cook_minutes"] is not None:
            total = (row["prep_minutes"] or 0) + (row["cook_minutes"] or 0)
        bind.execute(
            slots.update()
            .where(slots.c.id == row["id"])
            .values(
                history_snapshot={
                    "recipe_id": row["recipe_id"],
                    "recipe_name": row["name"],
                    "recipe_total_minutes": total,
                    "recipe_difficulty": row["difficulty"],
                    "meal_type": row["meal_type"],
                    "backfilled": True,
                }
            )
        )


def downgrade() -> None:
    op.drop_column("weekly_plan_slots", "history_snapshot")
