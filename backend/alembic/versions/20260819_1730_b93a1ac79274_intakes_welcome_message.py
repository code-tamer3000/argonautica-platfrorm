"""intakes_welcome_message

Revision ID: b93a1ac79274
Revises: 648eb1b2027b
Create Date: 2026-08-19 17:30:00.193557

"""
from collections.abc import Sequence

import sqlalchemy as sa

from alembic import op

# revision identifiers, used by Alembic.
revision: str = 'b93a1ac79274'
down_revision: str | None = '648eb1b2027b'
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.add_column('intakes', sa.Column('welcome_message', sa.Text(), nullable=True))


def downgrade() -> None:
    op.drop_column('intakes', 'welcome_message')
