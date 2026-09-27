"""add survey_submitted notification kind

Revision ID: b2d1c27ea500
Revises: 054d6c6c460b
Create Date: 2026-09-27 15:00:00.000000

Добавляет вид уведомления `survey_submitted` (участник сдал выпускную анкету,
адресат — админы) в CHECK на `notifications.kind`. Expand-only: никаких новых
колонок не требуется — `survey_submitted` использует room_id/message_id/
actor_id = NULL (системное уведомление), как cabin_granted/task_returned,
group_count растёт бёрстом (колонка уже существует, 062fb15005b2).

Фантомные диффы автогенерации (drop ix_journal_*, uq_rooms_single_news)
намеренно НЕ включены — см. docs/DATA_MODEL.md «Migrations gotchas».
"""
from collections.abc import Sequence

from alembic import op

# revision identifiers, used by Alembic.
revision: str = 'b2d1c27ea500'
down_revision: str | None = '054d6c6c460b'
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

_KINDS_OLD = (
    "kind IN ('dm', 'reply', 'news', 'mention', 'journal_missed', "
    "'cabin_granted', 'admin', 'task_comment', 'task_returned')"
)
_KINDS_NEW = (
    "kind IN ('dm', 'reply', 'news', 'mention', 'journal_missed', "
    "'cabin_granted', 'admin', 'task_comment', 'task_returned', "
    "'survey_submitted')"
)


def upgrade() -> None:
    op.drop_constraint(
        op.f('ck_notifications_notification_kind_valid'),
        'notifications', type_='check',
    )
    op.create_check_constraint('notification_kind_valid', 'notifications', _KINDS_NEW)


def downgrade() -> None:
    op.execute("DELETE FROM notifications WHERE kind = 'survey_submitted'")
    op.drop_constraint(
        op.f('ck_notifications_notification_kind_valid'),
        'notifications', type_='check',
    )
    op.create_check_constraint('notification_kind_valid', 'notifications', _KINDS_OLD)
