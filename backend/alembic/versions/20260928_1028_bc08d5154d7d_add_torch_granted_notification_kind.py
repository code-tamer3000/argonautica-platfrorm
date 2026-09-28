"""add torch_granted notification kind

Revision ID: bc08d5154d7d
Revises: 02ea8b6ced60
Create Date: 2026-09-28 10:28:52.087104

Добавляет вид уведомления `torch_granted` (админ открыл участнику доступ к
разделу «Факел», см. `grant_torch_access` в app/services/torch.py) в CHECK на
`notifications.kind`. Expand-only: room_id/message_id/actor_id остаются NULL,
как у cabin_granted/task_returned/survey_submitted — новых колонок не
требуется.

Фантомные диффы автогенерации (drop ix_journal_*, uq_rooms_news_per_intake,
uq_rooms_torch_singleton, ix_tasks_publish_at) и несвязанный
calendar_events.room_id намеренно НЕ включены — см. docs/DATA_MODEL.md
«Migrations gotchas».
"""
from collections.abc import Sequence

from alembic import op

# revision identifiers, used by Alembic.
revision: str = 'bc08d5154d7d'
down_revision: str | None = '02ea8b6ced60'
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

_KINDS_OLD = (
    "kind IN ('dm', 'reply', 'news', 'mention', 'journal_missed', "
    "'cabin_granted', 'admin', 'task_comment', 'task_returned', "
    "'survey_submitted')"
)
_KINDS_NEW = (
    "kind IN ('dm', 'reply', 'news', 'mention', 'journal_missed', "
    "'cabin_granted', 'admin', 'task_comment', 'task_returned', "
    "'survey_submitted', 'torch_granted')"
)


def upgrade() -> None:
    op.drop_constraint(
        op.f('ck_notifications_notification_kind_valid'),
        'notifications', type_='check',
    )
    op.create_check_constraint('notification_kind_valid', 'notifications', _KINDS_NEW)


def downgrade() -> None:
    op.execute("DELETE FROM notifications WHERE kind = 'torch_granted'")
    op.drop_constraint(
        op.f('ck_notifications_notification_kind_valid'),
        'notifications', type_='check',
    )
    op.create_check_constraint('notification_kind_valid', 'notifications', _KINDS_OLD)
