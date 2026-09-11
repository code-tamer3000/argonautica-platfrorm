"""task assignment deadline override

Персональный override дедлайна общей задачи для конкретного участника
(ARG-133/ARG-128): NULL — использовать tasks.deadline_at как есть. Только для
common-задач — у individual/pair/stream дедлайн уже осмысленно один через сам
объект задачи. Expand-only.

Autogenerate также предложил фантомные дропы индексов и два дропа колонок, не
относящихся к этой задаче (см. предыдущие миграции 30824f5a4b50/a16d0ffe6f49) —
убраны.

Revision ID: 1dc64b3ba309
Revises: a16d0ffe6f49
Create Date: 2026-09-11 15:07:00.000000

"""
from collections.abc import Sequence

import sqlalchemy as sa

from alembic import op

# revision identifiers, used by Alembic.
revision: str = '1dc64b3ba309'
down_revision: str | None = 'a16d0ffe6f49'
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.add_column(
        'task_assignments',
        sa.Column('deadline_at', sa.DateTime(timezone=True), nullable=True),
    )


def downgrade() -> None:
    op.drop_column('task_assignments', 'deadline_at')
