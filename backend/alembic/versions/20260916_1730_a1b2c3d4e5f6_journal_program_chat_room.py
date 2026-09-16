"""journal_programs.chat_room_id

Динамика: задание может вести отписки в выбранную группу вместо личного
дневника участника. NULL (все исторические строки) = личный дневник, как
раньше. Group.type='group' валидируется в коде (dynamics._validate_chat_room),
не в CHECK — тип комнаты не денормализован сюда. Expand-only.

Revision ID: a1b2c3d4e5f6
Revises: 9f3b2c1a7d4e
Create Date: 2026-09-16 17:30:00.000000

"""
from collections.abc import Sequence

import sqlalchemy as sa

from alembic import op

# revision identifiers, used by Alembic.
revision: str = 'a1b2c3d4e5f6'
down_revision: str | None = '9f3b2c1a7d4e'
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.add_column(
        'journal_programs',
        sa.Column('chat_room_id', sa.BigInteger(), nullable=True),
    )
    op.create_foreign_key(
        'fk_journal_programs_chat_room_id_rooms',
        'journal_programs',
        'rooms',
        ['chat_room_id'],
        ['id'],
    )


def downgrade() -> None:
    op.drop_constraint(
        'fk_journal_programs_chat_room_id_rooms', 'journal_programs', type_='foreignkey'
    )
    op.drop_column('journal_programs', 'chat_room_id')
