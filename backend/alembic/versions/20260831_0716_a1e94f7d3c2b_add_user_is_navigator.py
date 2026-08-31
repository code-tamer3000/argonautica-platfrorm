"""add user is_navigator

Revision ID: a1e94f7d3c2b
Revises: dfc098e7a956
Create Date: 2026-08-31 07:16:00.000000

"""
from collections.abc import Sequence

import sqlalchemy as sa

from alembic import op

# revision identifiers, used by Alembic.
revision: str = 'a1e94f7d3c2b'
down_revision: str | None = 'dfc098e7a956'
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    # Навигатор (ARG-110): админ, доступный для лички любому тарифу своего потока,
    # в обход рангового ограничения «пишут только два самых дорогих тарифа». Имеет
    # смысл только при role='admin' (проверяется в API, не в БД). Expand-only —
    # server_default бэкфиллит существующие строки в false.
    op.add_column(
        'users',
        sa.Column(
            'is_navigator',
            sa.Boolean(),
            nullable=False,
            server_default=sa.text('false'),
        ),
    )


def downgrade() -> None:
    op.drop_column('users', 'is_navigator')
