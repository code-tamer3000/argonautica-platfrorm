"""add forwarded_from_sender_id to messages

Revision ID: e5f6a7b8c9d0
Revises: d4e5f6a7b8c9
Create Date: 2026-07-03 10:00:00.000000

Репост сообщения в новостной канал сохраняет исходного автора для атрибуции
(«переслано от X»). Храним это в новой nullable-колонке forwarded_from_sender_id.

Обратная совместимость (blue-green, п.8): миграция только ДОБАВЛЯЕТ nullable-колонку.
Старый код её не заполняет и не читает, поэтому blue и green работают с этой схемой
без конфликта. downgrade просто убирает колонку.
"""
from collections.abc import Sequence

import sqlalchemy as sa

from alembic import op

revision: str = "e5f6a7b8c9d0"
down_revision: str | None = "d4e5f6a7b8c9"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.add_column(
        "messages",
        sa.Column("forwarded_from_sender_id", sa.BigInteger(), nullable=True),
    )
    op.create_foreign_key(
        op.f("fk_messages_forwarded_from_sender_id_users"),
        "messages",
        "users",
        ["forwarded_from_sender_id"],
        ["id"],
    )


def downgrade() -> None:
    op.drop_constraint(
        op.f("fk_messages_forwarded_from_sender_id_users"),
        "messages",
        type_="foreignkey",
    )
    op.drop_column("messages", "forwarded_from_sender_id")
