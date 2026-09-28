"""Track retry-safe swipe choices and undone plans without deleting history."""

import sqlalchemy as sa

from alembic import op

revision = "d8126c4ab391"
down_revision = "ca92e654710b"
branch_labels = None
depends_on = None


def upgrade() -> None:
    with op.batch_alter_table("meal_swipes") as batch:
        batch.add_column(sa.Column("request_id", sa.String(64), nullable=True))
        batch.add_column(sa.Column("planned_slot_id", sa.String(36), nullable=True))
        batch.add_column(sa.Column("undone_at", sa.DateTime(), nullable=True))
        batch.create_foreign_key(
            "fk_meal_swipe_slot",
            "weekly_plan_slots",
            ["planned_slot_id"],
            ["id"],
            ondelete="SET NULL",
        )
        batch.create_unique_constraint("uq_meal_swipe_request", ["user_id", "request_id"])
        batch.create_index("ix_meal_swipes_user_created", ["user_id", "created_at"])


def downgrade() -> None:
    with op.batch_alter_table("meal_swipes") as batch:
        batch.drop_index("ix_meal_swipes_user_created")
        batch.drop_constraint("uq_meal_swipe_request", type_="unique")
        batch.drop_constraint("fk_meal_swipe_slot", type_="foreignkey")
        batch.drop_column("undone_at")
        batch.drop_column("planned_slot_id")
        batch.drop_column("request_id")
