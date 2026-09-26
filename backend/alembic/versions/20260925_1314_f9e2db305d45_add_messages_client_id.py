"""add_messages_client_id

Revision ID: f9e2db305d45
Revises: 062fb15005b2
Create Date: 2026-09-25 13:14:03.934133

"""
from collections.abc import Sequence

import sqlalchemy as sa

from alembic import op

# revision identifiers, used by Alembic.
revision: str = 'f9e2db305d45'
down_revision: str | None = '062fb15005b2'
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.add_column('messages', sa.Column('client_id', sa.Text(), nullable=True))
    op.create_index('uq_messages_sender_room_client', 'messages', ['sender_id', 'room_id', 'client_id'], unique=True)


def downgrade() -> None:
    op.drop_index('uq_messages_sender_room_client', table_name='messages')
    op.drop_column('messages', 'client_id')
