"""journal section requires media

Revision ID: 1d9deee92e88
Revises: d4e81b3f92aa
Create Date: 2026-09-22 16:45:58.358954

"""
from collections.abc import Sequence

import sqlalchemy as sa

from alembic import op

# revision identifiers, used by Alembic.
revision: str = '1d9deee92e88'
down_revision: str | None = 'd4e81b3f92aa'
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.add_column(
        'journal_sections',
        sa.Column('requires_media', sa.Boolean(), server_default='false', nullable=False),
    )


def downgrade() -> None:
    op.drop_column('journal_sections', 'requires_media')
