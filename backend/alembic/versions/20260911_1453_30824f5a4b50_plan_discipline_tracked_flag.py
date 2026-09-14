"""plan discipline tracked flag

Явный флаг тарифа: входит ли он в контур учёта дисциплины (просрочки задач,
пропуски дневника, кандидат в Междумирье) — см. docs/LIMBO.md. Не выводится
автоматически по цене/рангу, ставится осознанно админом. Expand-only.

Autogenerate также предложил 4 фантомных дропа индексов (rooms/journal_*, см.
docs/DATA_MODEL.md «Migrations gotchas») и два дропа колонок, не относящихся к
этой задаче (calendar_events.room_id, notifications.task_id) — убраны, здесь
только реальное изменение.

Revision ID: 30824f5a4b50
Revises: a1e5c0f9b7d2
Create Date: 2026-09-11 14:53:27.385958

"""
from collections.abc import Sequence

import sqlalchemy as sa

from alembic import op

# revision identifiers, used by Alembic.
revision: str = '30824f5a4b50'
down_revision: str | None = 'a1e5c0f9b7d2'
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.add_column(
        'plans',
        sa.Column(
            'discipline_tracked', sa.Boolean(), server_default='false', nullable=False
        ),
    )


def downgrade() -> None:
    op.drop_column('plans', 'discipline_tracked')
