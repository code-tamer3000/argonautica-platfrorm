"""cabin access flag + cabin_granted notification

Revision ID: a2b3c4d5e6f7
Revises: e1f2a3b4c5d6
Create Date: 2026-07-05 14:00:00.000000

Раздел «Каюта» по умолчанию закрыт: доступ выдаёт админ (флаг users.can_access_cabin,
default false). О выдаче участник узнаёт через новое уведомление kind='cabin_granted'
— оно не привязано к комнате, поэтому notifications.room_id делаем nullable, а
CHECK по kind расширяем.

Обратная совместимость (blue-green, п.8):
- add column со server_default — старый код колонку не трогает, blue продолжает жить;
- расширение CHECK — надмножество прежних значений: старый код (blue) новые не пишет,
  ограничение для него не строже;
- room_id NOT NULL -> NULL — ослабление: старый код всегда шлёт room_id, ему всё равно.
Порядок безопасен: миграция накатывается ДО кода, который начинает писать cabin_granted.
"""
from collections.abc import Sequence

import sqlalchemy as sa

from alembic import op

revision: str = "a2b3c4d5e6f7"
down_revision: str | None = "e1f2a3b4c5d6"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.add_column(
        "users",
        sa.Column(
            "can_access_cabin",
            sa.Boolean(),
            nullable=False,
            server_default="false",
        ),
    )
    # room_id больше не обязателен (уведомления без комнаты — cabin_granted).
    op.alter_column("notifications", "room_id", existing_type=sa.BigInteger(), nullable=True)
    # Расширяем допустимые kind: добавляем cabin_granted (надмножество прежних).
    op.drop_constraint("notification_kind_valid", "notifications", type_="check")
    op.create_check_constraint(
        "notification_kind_valid",
        "notifications",
        "kind IN ('dm', 'reply', 'news', 'journal_missed', 'cabin_granted')",
    )


def downgrade() -> None:
    op.drop_constraint("notification_kind_valid", "notifications", type_="check")
    # Убираем строки нового вида, иначе NOT NULL/старый CHECK откажут.
    op.execute("DELETE FROM notifications WHERE kind = 'cabin_granted'")
    op.create_check_constraint(
        "notification_kind_valid",
        "notifications",
        "kind IN ('dm', 'reply', 'news', 'journal_missed')",
    )
    op.alter_column("notifications", "room_id", existing_type=sa.BigInteger(), nullable=False)
    op.drop_column("users", "can_access_cabin")
