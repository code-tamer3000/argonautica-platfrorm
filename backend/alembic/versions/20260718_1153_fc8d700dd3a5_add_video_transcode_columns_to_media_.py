"""add_video_transcode_columns_to_media_assets

Revision ID: fc8d700dd3a5
Revises: cccfebde22b1
Create Date: 2026-07-18 11:53:10.376886

Expand-only (blue-green, shared Postgres): три новые nullable-колонки + CHECK.
Ничего не переименовано/не удалено. Легаси-строки остаются с NULL (транскод
неприменим/не проходили) — отдаются как раньше.

ВНИМАНИЕ: автоген повторно предложил снос фантомных индексов
(ix_journal_credits_user_id, ix_journal_pardons_user_id,
ix_journal_sections_program_id, uq_rooms_single_news) — см. docs/DATA_MODEL.md
«Migrations gotchas». Они НЕ включены сюда намеренно.
"""
from collections.abc import Sequence

import sqlalchemy as sa

from alembic import op

# revision identifiers, used by Alembic.
revision: str = 'fc8d700dd3a5'
down_revision: str | None = 'cccfebde22b1'
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.add_column('media_assets', sa.Column('transcode_status', sa.Text(), nullable=True))
    op.add_column('media_assets', sa.Column('variant_key', sa.Text(), nullable=True))
    op.add_column('media_assets', sa.Column('variant_mime', sa.Text(), nullable=True))
    op.create_check_constraint(
        'transcode_status_valid',
        'media_assets',
        "transcode_status IS NULL OR transcode_status IN "
        "('processing', 'done', 'failed')",
    )


def downgrade() -> None:
    op.drop_constraint('transcode_status_valid', 'media_assets', type_='check')
    op.drop_column('media_assets', 'variant_mime')
    op.drop_column('media_assets', 'variant_key')
    op.drop_column('media_assets', 'transcode_status')
