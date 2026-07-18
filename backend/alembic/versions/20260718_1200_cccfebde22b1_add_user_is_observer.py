"""add user is_observer

Revision ID: cccfebde22b1
Revises: 1166b920854e
Create Date: 2026-07-18 12:00:00.000000

"""
from collections.abc import Sequence

import sqlalchemy as sa

from alembic import op

# revision identifiers, used by Alembic.
revision: str = 'cccfebde22b1'
down_revision: str | None = '1166b920854e'
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    # Режим наблюдателя: пассивный доступ «только к материалам». Expand-only —
    # server_default бэкфиллит существующие строки в false, старый код колонку
    # игнорирует (blue-green, общий Postgres).
    op.add_column(
        'users',
        sa.Column(
            'is_observer',
            sa.Boolean(),
            nullable=False,
            server_default=sa.text('false'),
        ),
    )


def downgrade() -> None:
    op.drop_column('users', 'is_observer')
