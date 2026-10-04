"""users_tg_id

Revision ID: a7c4e19b2d35
Revises: 6a25457918ee
Create Date: 2026-10-03 11:00:00.000000

"""
from collections.abc import Sequence

import sqlalchemy as sa

from alembic import op

# revision identifiers, used by Alembic.
revision: str = 'a7c4e19b2d35'
down_revision: str | None = '6a25457918ee'
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    # expand-only: nullable-колонка, старый код её не знает и не ломается.
    op.add_column('users', sa.Column('tg_id', sa.BigInteger(), nullable=True))
    op.create_unique_constraint(op.f('uq_users_tg_id'), 'users', ['tg_id'])


def downgrade() -> None:
    op.drop_constraint(op.f('uq_users_tg_id'), 'users', type_='unique')
    op.drop_column('users', 'tg_id')
