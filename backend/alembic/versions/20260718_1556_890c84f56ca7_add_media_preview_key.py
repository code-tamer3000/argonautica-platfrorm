"""add media preview key

Revision ID: 890c84f56ca7
Revises: fc8d700dd3a5
Create Date: 2026-07-18 15:56:04.071295

"""
from collections.abc import Sequence

import sqlalchemy as sa

from alembic import op

# revision identifiers, used by Alembic.
revision: str = '890c84f56ca7'
down_revision: str | None = 'fc8d700dd3a5'
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    # Только expand: новая nullable-колонка под ключ среднего WebP-деривата картинки
    # (лайтбокс вместо оригинала). Фантомные index-диффы автогенерации удалены —
    # см. docs/DATA_MODEL.md «Migrations gotchas».
    op.add_column('media_assets', sa.Column('preview_key', sa.Text(), nullable=True))


def downgrade() -> None:
    op.drop_column('media_assets', 'preview_key')
