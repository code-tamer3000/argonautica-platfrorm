"""add tasks.is_draft

Revision ID: d4e81b3f92aa
Revises: b7c426100236
Create Date: 2026-09-18 13:30:00.000000

"""
from collections.abc import Sequence

import sqlalchemy as sa

from alembic import op

# revision identifiers, used by Alembic.
revision: str = 'd4e81b3f92aa'
down_revision: str | None = 'b7c426100236'
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    # Expand-only: новая колонка со server_default, старый код её просто не
    # читает (docs/DATA_MODEL.md «Migrations», blue-green). Существующие строки
    # получают false — то есть остаются опубликованными, как и были.
    op.add_column(
        'tasks',
        sa.Column('is_draft', sa.Boolean(), server_default='false', nullable=False),
    )


def downgrade() -> None:
    op.drop_column('tasks', 'is_draft')
