"""Questionnaires for repeatable task entries."""
import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects.postgresql import JSONB

revision = "d70e925b531f"
down_revision = "c8d2a4f6b901"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column("tasks", sa.Column("questions", JSONB(), nullable=True))
    op.add_column("task_submissions", sa.Column("answers", JSONB(), nullable=True))
    op.drop_constraint("task_type_valid", "tasks", type_="check")
    op.create_check_constraint("task_type_valid", "tasks", "type IN ('common','individual','pair','stream','structure')")


def downgrade() -> None:
    op.drop_constraint("task_type_valid", "tasks", type_="check")
    op.create_check_constraint("task_type_valid", "tasks", "type IN ('common','individual','pair','stream')")
    op.drop_column("task_submissions", "answers")
    op.drop_column("tasks", "questions")
