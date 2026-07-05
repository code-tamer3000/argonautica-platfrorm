"""media_assets.thumb_key (серверные превью изображений)

Revision ID: b3c4d5e6f7a8
Revises: d0e1f2a3b4c5
Create Date: 2026-07-05 16:00:00.000000

ВНИМАНИЕ (частичный релиз в main): на ветке develop эта миграция зачейнена за
миграции «Каюты» (down_revision = a2b3c4d5e6f7). В main каюты нет, поэтому здесь
миграция перецеплена на текущий head main (d0e1f2a3b4c5, add_faq_items) — thumb_key
добавляет независимую колонку, порядок относительно каюты не важен. При будущем полном
мёрже develop→main эти два родителя разойдутся: понадобится однократный `alembic merge`
(две головы: thumb_key и последняя миграция каюты), затем upgrade head.

Превью картинок генерятся при подтверждении загрузки и хранятся отдельным объектом
в том же бакете; ссылку на объект держим в media_assets.thumb_key. В ленте отдаём
превью (лёгкое), оригинал — по клику.

Обратная совместимость (blue-green, п.8): add column nullable, без server_default —
старый код (blue) колонку не читает и не пишет, продолжает работать. Миграция
накатывается ДО кода, который начинает заполнять thumb_key. DROP не делаем.
"""
from collections.abc import Sequence

import sqlalchemy as sa

from alembic import op

revision: str = "b3c4d5e6f7a8"
down_revision: str | None = "d0e1f2a3b4c5"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.add_column(
        "media_assets",
        sa.Column("thumb_key", sa.Text(), nullable=True),
    )


def downgrade() -> None:
    op.drop_column("media_assets", "thumb_key")
