"""kb video progress

Revision ID: c61f3cac42f8
Revises: af71ca3a7e11
Create Date: 2026-09-05 01:41:19.415856

Позиция просмотра видео из КБ, на пользователя (ARG-118).

Autogenerate заодно предложил дропнуть `calendar_events.room_id` и
`notifications.task_id` (несвязанный дрейф модели/схемы — уже описан и
сознательно не тронут в 8e0a0bdd14d9) и 4 фантомных индекса из "Migrations
gotchas" (docs/DATA_MODEL.md, включая `uq_rooms_news_per_intake`) — обе группы
вычищены из этого файла вручную.

Expand-only: новая таблица, старый код её не знает.
"""
from collections.abc import Sequence

import sqlalchemy as sa

from alembic import op

# revision identifiers, used by Alembic.
revision: str = 'c61f3cac42f8'
down_revision: str | None = 'af71ca3a7e11'
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.create_table(
        'kb_video_progress',
        sa.Column('kb_item_id', sa.BigInteger(), nullable=False),
        sa.Column('media_asset_id', sa.BigInteger(), nullable=False),
        sa.Column('user_id', sa.BigInteger(), nullable=False),
        sa.Column('position_seconds', sa.Integer(), nullable=False),
        sa.Column('updated_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=False),
        sa.ForeignKeyConstraint(['kb_item_id'], ['kb_items.id'], name=op.f('fk_kb_video_progress_kb_item_id_kb_items')),
        sa.ForeignKeyConstraint(['media_asset_id'], ['media_assets.id'], name=op.f('fk_kb_video_progress_media_asset_id_media_assets')),
        sa.ForeignKeyConstraint(['user_id'], ['users.id'], name=op.f('fk_kb_video_progress_user_id_users')),
        sa.PrimaryKeyConstraint('kb_item_id', 'media_asset_id', 'user_id', name=op.f('pk_kb_video_progress')),
    )


def downgrade() -> None:
    op.drop_table('kb_video_progress')
