"""add task_returned notification kind

Revision ID: 278cb5ef3942
Revises: 8c2ee967163d
Create Date: 2026-09-24 12:00:00.000000

Добавляет вид уведомления `task_returned` (сдача задачи возвращена на
доработку) в CHECK на `notifications.kind`. Expand-only: колонка `task_id`
уже существует (dc5ada6300f9), новый ревью-эндпоинт её переиспользует —
менять схему таблицы не требуется, только сам CHECK.

Фантомные диффы автогенерации (drop ix_journal_*, uq_rooms_single_news)
намеренно НЕ включены — см. docs/DATA_MODEL.md «Migrations gotchas».
"""
from collections.abc import Sequence

from alembic import op

# revision identifiers, used by Alembic.
revision: str = '278cb5ef3942'
down_revision: str | None = '8c2ee967163d'
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

_KINDS_OLD = (
    "kind IN ('dm', 'reply', 'news', 'mention', 'journal_missed', "
    "'cabin_granted', 'admin', 'task_comment')"
)
_KINDS_NEW = (
    "kind IN ('dm', 'reply', 'news', 'mention', 'journal_missed', "
    "'cabin_granted', 'admin', 'task_comment', 'task_returned')"
)


def upgrade() -> None:
    op.drop_constraint(
        op.f('ck_notifications_notification_kind_valid'),
        'notifications', type_='check',
    )
    op.create_check_constraint('notification_kind_valid', 'notifications', _KINDS_NEW)


def downgrade() -> None:
    op.execute("DELETE FROM notifications WHERE kind = 'task_returned'")
    op.drop_constraint(
        op.f('ck_notifications_notification_kind_valid'),
        'notifications', type_='check',
    )
    op.create_check_constraint('notification_kind_valid', 'notifications', _KINDS_OLD)
