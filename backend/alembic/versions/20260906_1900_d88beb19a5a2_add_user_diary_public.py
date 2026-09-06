"""add user diary_public

Revision ID: d88beb19a5a2
Revises: c61f3cac42f8
Create Date: 2026-09-06 19:00:00.000000

"""
from collections.abc import Sequence

import sqlalchemy as sa

from alembic import op

# revision identifiers, used by Alembic.
revision: str = 'd88beb19a5a2'
down_revision: str | None = 'c61f3cac42f8'
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    # Личный дневник конкретного админа показать участникам его потока (обычно
    # дневники админов скрыты целиком, см. diary_visible) — ручной разовый флаг,
    # смысл только при role='admin' (проверяется в API, не в БД). Expand-only —
    # server_default бэкфиллит существующие строки в false.
    op.add_column(
        'users',
        sa.Column(
            'diary_public',
            sa.Boolean(),
            nullable=False,
            server_default=sa.text('false'),
        ),
    )


def downgrade() -> None:
    op.drop_column('users', 'diary_public')
