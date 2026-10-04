"""room_pin_order

Revision ID: e5a2c8d41b07
Revises: d4f1b7a29c63
Create Date: 2026-10-04 19:00:00.000000

"""
from collections.abc import Sequence

import sqlalchemy as sa

from alembic import op

# revision identifiers, used by Alembic.
revision: str = 'e5a2c8d41b07'
down_revision: str | None = 'd4f1b7a29c63'
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    # expand-only: nullable-колонка, старый код её не знает и не ломается.
    op.add_column('rooms', sa.Column('pin_order', sa.SmallInteger(), nullable=True))


def downgrade() -> None:
    op.drop_column('rooms', 'pin_order')
