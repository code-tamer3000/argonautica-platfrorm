"""add kb_items kind

Revision ID: 49cd1ef043ba
Revises: 3fc6c4518667
Create Date: 2026-07-09 11:13:08.003699

"""
from collections.abc import Sequence

import sqlalchemy as sa

from alembic import op

# revision identifiers, used by Alembic.
revision: str = '49cd1ef043ba'
down_revision: str | None = '3fc6c4518667'
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    # Additive column only (expand/contract). The index drops autogenerate also
    # emitted are phantom diffs — see docs/DATA_MODEL.md "Migrations gotchas" —
    # and are intentionally NOT applied here.
    op.add_column(
        'kb_items',
        sa.Column('kind', sa.Text(), server_default='article', nullable=False),
    )


def downgrade() -> None:
    op.drop_column('kb_items', 'kind')
