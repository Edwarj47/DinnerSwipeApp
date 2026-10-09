"""Additive session, consent, quota and media tracking controls."""

from alembic import op
import sqlalchemy as sa

revision = "e43b2d801a9c"
down_revision = "c76219a8410b"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column(
        "users", sa.Column("session_version", sa.Integer(), nullable=False, server_default="0")
    )
    op.add_column("users", sa.Column("fatsecret_terms_version", sa.String(40), nullable=True))
    op.add_column("users", sa.Column("fatsecret_terms_accepted_at", sa.DateTime(), nullable=True))
    op.create_table(
        "security_rate_counters",
        sa.Column("key", sa.String(64), primary_key=True),
        sa.Column("count", sa.Integer(), nullable=False),
        sa.Column("reset_at", sa.DateTime(), nullable=False),
    )
    op.create_index("ix_security_rate_counters_reset_at", "security_rate_counters", ["reset_at"])
    op.create_table(
        "recipe_media_objects",
        sa.Column("id", sa.String(36), primary_key=True),
        sa.Column("owner_user_id", sa.String(36), sa.ForeignKey("users.id"), nullable=False),
        sa.Column("storage_key", sa.String(512), nullable=False, unique=True),
        sa.Column("backend", sa.String(30), nullable=False),
        sa.Column("content_type", sa.String(80), nullable=False),
        sa.Column("size_bytes", sa.Integer(), nullable=False),
        sa.Column("created_at", sa.DateTime(), nullable=False),
        sa.Column("claimed_at", sa.DateTime()),
        sa.Column("orphaned_at", sa.DateTime()),
        sa.Column("managed", sa.Boolean(), nullable=False, server_default=sa.true()),
        sa.Column("deleted_at", sa.DateTime()),
    )
    op.create_index(
        "ix_recipe_media_objects_owner_user_id", "recipe_media_objects", ["owner_user_id"]
    )
    op.add_column("nutrition_api_calls", sa.Column("user_id", sa.String(36), nullable=True))
    op.create_index(
        "ix_nutrition_calls_user_time", "nutrition_api_calls", ["user_id", "reserved_at"]
    )


def downgrade() -> None:
    raise RuntimeError(
        "Preserve security metadata; rollback application images without dropping these tables."
    )
