"""add users.graduated_at (экспедиция пройдена)

Revision ID: b7f2a1c9d4e3
Revises: 6cb010e4a1b1
Create Date: 2026-07-30 10:00:00

Отметка выпуска. Проставляется при отправке выпускной анкеты; тем, кто анкету уже
сдал до этого релиза, — бэкфиллом по `survey_responses.created_at` (иначе они
остались бы «в пути», хотя экспедицию закончили).

Expand-only: колонка nullable, старый код её не знает и не ломается.
"""
import sqlalchemy as sa

from alembic import op

revision = "b7f2a1c9d4e3"
down_revision = "6cb010e4a1b1"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column(
        "users",
        sa.Column("graduated_at", sa.DateTime(timezone=True), nullable=True),
    )
    op.execute(
        """
        UPDATE users u
        SET graduated_at = r.created_at
        FROM survey_responses r
        WHERE r.user_id = u.id AND u.graduated_at IS NULL
        """
    )


def downgrade() -> None:
    op.drop_column("users", "graduated_at")
