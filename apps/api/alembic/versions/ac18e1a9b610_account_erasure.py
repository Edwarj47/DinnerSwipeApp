"""Add durable account erasure and detached cleanup receipts.

Revision ID: ac18e1a9b610
Revises: fa617db329a0
"""

from alembic import op
import sqlalchemy as sa

revision = "ac18e1a9b610"
down_revision = "fa617db329a0"
branch_labels = None
depends_on = None


def upgrade() -> None:
    with op.batch_alter_table("workout_logs") as batch:
        batch.alter_column("template_id", existing_type=sa.String(36), nullable=True)
    with op.batch_alter_table("workout_plan_slots") as batch:
        batch.alter_column("template_id", existing_type=sa.String(36), nullable=True)
    op.create_table("account_erasures",
        sa.Column("id", sa.String(36), primary_key=True),
        sa.Column("user_id", sa.String(36), unique=True, nullable=True),
        sa.Column("subject_hash", sa.String(64), nullable=False),
        sa.Column("status", sa.String(32), nullable=False),
        sa.Column("attempts", sa.Integer(), nullable=False),
        sa.Column("report", sa.JSON(), nullable=False),
        sa.Column("completed_at", sa.DateTime(), nullable=True),
        sa.Column("created_at", sa.DateTime(), nullable=False),
        sa.Column("updated_at", sa.DateTime(), nullable=False))
    op.create_index("ix_account_erasures_status", "account_erasures", ["status"])
    op.create_index("ix_account_erasures_subject_hash", "account_erasures", ["subject_hash"])
    op.create_table("account_erasure_media_tasks",
        sa.Column("id", sa.String(36), primary_key=True),
        sa.Column("erasure_id", sa.String(36), sa.ForeignKey("account_erasures.id"), nullable=False),
        sa.Column("kind", sa.String(16), nullable=False),
        sa.Column("object_id", sa.String(36), nullable=True),
        sa.Column("storage_key", sa.String(2048), nullable=False),
        sa.Column("backend", sa.String(30), nullable=False),
        sa.Column("created_at", sa.DateTime(), nullable=False),
        sa.Column("updated_at", sa.DateTime(), nullable=False))
    op.create_index("ix_account_erasure_media_tasks_erasure_id", "account_erasure_media_tasks", ["erasure_id"])
    op.create_table("detached_billing_references",
        sa.Column("id", sa.String(36), primary_key=True),
        sa.Column("erasure_id", sa.String(36), sa.ForeignKey("account_erasures.id"), nullable=False),
        sa.Column("provider", sa.String(16), nullable=False),
        sa.Column("subscription_id", sa.String(255), nullable=True),
        sa.Column("customer_id", sa.String(255), nullable=True),
        sa.Column("status", sa.String(32), nullable=False),
        sa.Column("created_at", sa.DateTime(), nullable=False),
        sa.Column("updated_at", sa.DateTime(), nullable=False))
    op.create_index("ix_detached_billing_references_erasure_id", "detached_billing_references", ["erasure_id"])


def downgrade() -> None:
    connection = op.get_bind()
    for name in ("workout_logs", "workout_plan_slots"):
        if connection.scalar(sa.text(f"SELECT count(*) FROM {name} WHERE template_id IS NULL")):
            raise RuntimeError("Detached independent history cannot be downgraded safely.")
    for name in ("detached_billing_references", "account_erasure_media_tasks", "account_erasures"):
        if connection.scalar(sa.text(f"SELECT count(*) FROM {name}")):
            raise RuntimeError("Retain erasure receipts; downgrade requires empty disposable tables.")
    for name in ("detached_billing_references", "account_erasure_media_tasks", "account_erasures"):
        op.drop_table(name)
    with op.batch_alter_table("workout_logs") as batch:
        batch.alter_column("template_id", existing_type=sa.String(36), nullable=False)
    with op.batch_alter_table("workout_plan_slots") as batch:
        batch.alter_column("template_id", existing_type=sa.String(36), nullable=False)
