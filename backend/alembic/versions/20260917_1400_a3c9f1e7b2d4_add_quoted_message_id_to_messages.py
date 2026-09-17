"""add quoted_message_id to messages

Revision ID: a3c9f1e7b2d4
Revises: 1f8cb568e2c4
Create Date: 2026-09-17 14:00:00.000000

Цитата (Telegram-style «ответить») — презентационный указатель на сообщение,
ОРТОГОНАЛЬНЫЙ треду: quoted_message_id не пишет thread_root_id, не инкрементит
reply_count/last_reply_at, не меняет предикат ленты thread_root_id IS NULL.
ADR-002 (треды, заморожен) и ADR-010 (денормализация reply_count) этой миграцией
не затрагиваются — см. docs/DECISIONS.md «Цитата — отдельное поле, не тред».

Индекс не добавляем: единственный путь чтения — WHERE id IN (...) по PK при
резолве превью на странице ленты; обратного запроса «кто меня процитировал»
продуктом не предусмотрено.

Обратная совместимость (blue-green, п.8): миграция только ДОБАВЛЯЕТ nullable-колонку.
Старый код её не заполняет и не читает, поэтому blue и green работают с этой схемой
без конфликта. downgrade просто убирает колонку.
"""
from collections.abc import Sequence

import sqlalchemy as sa

from alembic import op

revision: str = "a3c9f1e7b2d4"
down_revision: str | None = "1f8cb568e2c4"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.add_column(
        "messages",
        sa.Column("quoted_message_id", sa.BigInteger(), nullable=True),
    )
    op.create_foreign_key(
        op.f("fk_messages_quoted_message_id_messages"),
        "messages",
        "messages",
        ["quoted_message_id"],
        ["id"],
    )


def downgrade() -> None:
    op.drop_constraint(
        op.f("fk_messages_quoted_message_id_messages"),
        "messages",
        type_="foreignkey",
    )
    op.drop_column("messages", "quoted_message_id")
