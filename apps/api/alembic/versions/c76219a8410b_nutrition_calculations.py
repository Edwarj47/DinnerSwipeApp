"""User calculations with provider references, not provider nutrition snapshots."""

from alembic import op
import sqlalchemy as sa

revision = "c76219a8410b"
down_revision = "b981fc2a7610"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "nutrition_calculations",
        sa.Column("id", sa.String(36), primary_key=True),
        sa.Column(
            "user_id", sa.String(36), sa.ForeignKey("users.id", ondelete="CASCADE"), nullable=False
        ),
        sa.Column(
            "recipe_id", sa.String(36), sa.ForeignKey("recipes.id", ondelete="CASCADE"), unique=True
        ),
        sa.Column(
            "entry_id",
            sa.String(36),
            sa.ForeignKey("meal_macro_confirmations.id", ondelete="CASCADE"),
            unique=True,
        ),
        sa.Column("servings", sa.Float(), nullable=False),
        sa.Column("items", sa.JSON(), nullable=False),
        sa.Column("request_id", sa.String(36), nullable=False, unique=True),
        sa.Column("request_hash", sa.String(64), nullable=False),
        sa.CheckConstraint(
            "(recipe_id IS NULL AND entry_id IS NOT NULL) OR "
            "(recipe_id IS NOT NULL AND entry_id IS NULL)",
            name="nutrition_calculation_one_target",
        ),
    )
    op.create_index("ix_nutrition_calculations_user_id", "nutrition_calculations", ["user_id"])


def downgrade() -> None:
    raise RuntimeError("Retain calculations and restore the prior application image for rollback.")
