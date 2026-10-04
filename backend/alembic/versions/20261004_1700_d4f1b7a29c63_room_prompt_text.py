"""room_prompt_text

Revision ID: d4f1b7a29c63
Revises: c3e8a51f7d92
Create Date: 2026-10-04 17:00:00.000000

"""
from collections.abc import Sequence

import sqlalchemy as sa

from alembic import op

# revision identifiers, used by Alembic.
revision: str = 'd4f1b7a29c63'
down_revision: str | None = 'c3e8a51f7d92'
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    # expand-only: nullable-колонка, старый код её не знает и не ломается.
    op.add_column('rooms', sa.Column('prompt_text', sa.Text(), nullable=True))


def downgrade() -> None:
    op.drop_column('rooms', 'prompt_text')
