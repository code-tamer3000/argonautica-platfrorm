"""add_rooms_is_readonly

Revision ID: 8c2ee967163d
Revises: 1d9deee92e88
Create Date: 2026-09-23 04:53:31.024747

"""
from collections.abc import Sequence

import sqlalchemy as sa

from alembic import op

# revision identifiers, used by Alembic.
revision: str = '8c2ee967163d'
down_revision: str | None = '1d9deee92e88'
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.add_column('rooms', sa.Column('is_readonly', sa.Boolean(), server_default='false', nullable=False))


def downgrade() -> None:
    op.drop_column('rooms', 'is_readonly')
