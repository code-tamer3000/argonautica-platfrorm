"""user discipline reset at

Точка отсчёта для счётчика «сдач после дедлайна» (ARG-130/ARG-128): NULL —
считать с начала; выставляется при входе/выходе из Междумирье (services/limbo.py,
подзадача ARG-132), чтобы предупреждение «ещё N раз — и Междумирье» отсчитывалось
заново на каждом цикле, а не копило штрафы бесконечно. Expand-only.

Autogenerate также предложил фантомные дропы индексов и два дропа колонок, не
относящихся к этой задаче (см. предыдущую миграцию 30824f5a4b50) — убраны.

Revision ID: a16d0ffe6f49
Revises: 30824f5a4b50
Create Date: 2026-09-11 15:00:00.000000

"""
from collections.abc import Sequence

import sqlalchemy as sa

from alembic import op

# revision identifiers, used by Alembic.
revision: str = 'a16d0ffe6f49'
down_revision: str | None = '30824f5a4b50'
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.add_column(
        'users',
        sa.Column('discipline_reset_at', sa.DateTime(timezone=True), nullable=True),
    )


def downgrade() -> None:
    op.drop_column('users', 'discipline_reset_at')
