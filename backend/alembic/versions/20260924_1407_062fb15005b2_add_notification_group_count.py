"""add_notification_group_count

Revision ID: 062fb15005b2
Revises: 278cb5ef3942
Create Date: 2026-09-24 14:07:41.156492

"""
from collections.abc import Sequence

import sqlalchemy as sa

from alembic import op

# revision identifiers, used by Alembic.
revision: str = '062fb15005b2'
down_revision: str | None = '278cb5ef3942'
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    # Только реальное изменение — остальное, что предложил autogenerate (индексы
    # rooms/journal_*/tasks, calendar_events.room_id), это либо известные phantom-
    # диффы (docs/DATA_MODEL.md "Migrations gotchas"), либо чужой дрейф вне задачи —
    # не трогаем.
    op.add_column('notifications', sa.Column('group_count', sa.BigInteger(), server_default=sa.text('1'), nullable=False))


def downgrade() -> None:
    op.drop_column('notifications', 'group_count')
