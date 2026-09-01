"""room avatar media

Revision ID: af71ca3a7e11
Revises: 8e0a0bdd14d9
Create Date: 2026-09-01 08:38:19.909527

Обложка личного дневника (rooms.avatar_media_id) — та же пара legacy-url +
media-id, что и у users.avatar_url/avatar_media_id.

Autogenerate заодно предложил дропнуть `calendar_events.room_id` и
`notifications.task_id` (несвязанный дрейф модели/схемы — уже описан и
сознательно не тронут в 8e0a0bdd14d9) и 4 фантомных индекса из "Migrations
gotchas" (docs/DATA_MODEL.md, включая `uq_rooms_news_per_intake`) — обе группы
вычищены из этого файла вручную.

Expand-only: новая колонка nullable, старый код её не знает.
"""
from collections.abc import Sequence

import sqlalchemy as sa

from alembic import op

# revision identifiers, used by Alembic.
revision: str = 'af71ca3a7e11'
down_revision: str | None = '8e0a0bdd14d9'
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.add_column('rooms', sa.Column('avatar_media_id', sa.BigInteger(), nullable=True))
    op.create_foreign_key(op.f('fk_rooms_avatar_media_id_media_assets'), 'rooms', 'media_assets', ['avatar_media_id'], ['id'])


def downgrade() -> None:
    op.drop_constraint(op.f('fk_rooms_avatar_media_id_media_assets'), 'rooms', type_='foreignkey')
    op.drop_column('rooms', 'avatar_media_id')
