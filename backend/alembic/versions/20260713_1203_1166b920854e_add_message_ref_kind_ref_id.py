"""add message ref_kind ref_id

Revision ID: 1166b920854e
Revises: a5ac607d6dee
Create Date: 2026-07-13 12:03:09.697997

"""
from collections.abc import Sequence

import sqlalchemy as sa

from alembic import op

# revision identifiers, used by Alembic.
revision: str = '1166b920854e'
down_revision: str | None = 'a5ac607d6dee'
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    # Одна ссылка на материал КБ / задачу на сообщение (без FK — цель резолвится
    # лениво, висячая ссылка отдаётся как «недоступна»).
    op.add_column('messages', sa.Column('ref_kind', sa.Text(), nullable=True))
    op.add_column('messages', sa.Column('ref_id', sa.BigInteger(), nullable=True))
    op.create_check_constraint(
        'ck_messages_ref_pair', 'messages', '(ref_kind IS NULL) = (ref_id IS NULL)'
    )
    op.create_check_constraint(
        'ck_messages_ref_kind', 'messages', "ref_kind IS NULL OR ref_kind IN ('kb', 'task')"
    )


def downgrade() -> None:
    op.drop_constraint('ck_messages_ref_kind', 'messages', type_='check')
    op.drop_constraint('ck_messages_ref_pair', 'messages', type_='check')
    op.drop_column('messages', 'ref_id')
    op.drop_column('messages', 'ref_kind')
