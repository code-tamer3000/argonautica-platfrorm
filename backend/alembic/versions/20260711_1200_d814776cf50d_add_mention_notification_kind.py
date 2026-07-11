"""add_mention_notification_kind

Revision ID: d814776cf50d
Revises: f0e1d2c3b4a5
Create Date: 2026-07-11 12:00:00.000000

Расширяем CHECK на notifications.kind новым значением 'mention' (@упоминание в
сообщении). Чистый expand (п.8): добавляем допустимое значение, ничего не ломаем
для существующих строк. Констрейнт пересоздаём (Postgres не умеет ALTER CHECK).

downgrade сужает набор обратно; сначала удаляем строки нового вида, иначе новый
(старый) CHECK не наложится.
"""
from collections.abc import Sequence

from alembic import op

# revision identifiers, used by Alembic.
revision: str = 'd814776cf50d'
down_revision: str | None = 'f0e1d2c3b4a5'
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

_OLD = (
    "kind IN ('dm', 'reply', 'news', 'journal_missed', 'cabin_granted', 'admin')"
)
_NEW = (
    "kind IN ('dm', 'reply', 'news', 'mention', 'journal_missed', "
    "'cabin_granted', 'admin')"
)


def upgrade() -> None:
    op.drop_constraint("notification_kind_valid", "notifications", type_="check")
    op.create_check_constraint("notification_kind_valid", "notifications", _NEW)


def downgrade() -> None:
    op.execute("DELETE FROM notifications WHERE kind = 'mention'")
    op.drop_constraint("notification_kind_valid", "notifications", type_="check")
    op.create_check_constraint("notification_kind_valid", "notifications", _OLD)
