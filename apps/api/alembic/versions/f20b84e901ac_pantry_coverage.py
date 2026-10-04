"""Add quantity and week-scoped pantry coverage without removing legacy entries."""

from alembic import op
import sqlalchemy as sa

revision = "f20b84e901ac"
down_revision = "e19a71c042bf"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column(
        "pantry_items",
        sa.Column("coverage_mode", sa.String(16), nullable=False, server_default="legacy"),
    )
    op.add_column("pantry_items", sa.Column("quantity", sa.Float(), nullable=True))
    op.add_column("pantry_items", sa.Column("unit", sa.String(32), nullable=True))
    op.add_column("pantry_items", sa.Column("week_start", sa.Date(), nullable=True))
    op.add_column(
        "pantry_items", sa.Column("requirements_fingerprint", sa.String(64), nullable=True)
    )
    op.add_column("grocery_list_items", sa.Column("required_quantity", sa.Float(), nullable=True))
    op.execute("UPDATE grocery_list_items SET required_quantity = quantity")


def downgrade() -> None:
    op.drop_column("grocery_list_items", "required_quantity")
    for name in ("requirements_fingerprint", "week_start", "unit", "quantity", "coverage_mode"):
        op.drop_column("pantry_items", name)
