"""task_comment notification + task_id

Revision ID: dc5ada6300f9
Revises: ece6436b7ff4
Create Date: 2026-07-24 20:17:22.489783

Добавляет вид уведомления `task_comment` (комментарий к сдаче задачи) и колонку
`notifications.task_id` (цель навигации → /tasks/{task_id}). Expand-only:
колонка nullable, старый CHECK расширяется новым значением.

Фантомные диффы автогенерации (drop ix_journal_*, uq_rooms_single_news) намеренно
НЕ включены — см. docs/DATA_MODEL.md «Migrations gotchas».
"""
from collections.abc import Sequence

import sqlalchemy as sa

from alembic import op

# revision identifiers, used by Alembic.
revision: str = 'dc5ada6300f9'
down_revision: str | None = 'ece6436b7ff4'
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

_KINDS_OLD = (
    "kind IN ('dm', 'reply', 'news', 'mention', 'journal_missed', "
    "'cabin_granted', 'admin')"
)
_KINDS_NEW = (
    "kind IN ('dm', 'reply', 'news', 'mention', 'journal_missed', "
    "'cabin_granted', 'admin', 'task_comment')"
)


def upgrade() -> None:
    op.add_column(
        'notifications', sa.Column('task_id', sa.BigInteger(), nullable=True)
    )
    op.create_foreign_key(
        op.f('fk_notifications_task_id_tasks'),
        'notifications', 'tasks', ['task_id'], ['id'],
    )
    op.drop_constraint(
        op.f('ck_notifications_notification_kind_valid'),
        'notifications', type_='check',
    )
    op.create_check_constraint('notification_kind_valid', 'notifications', _KINDS_NEW)


def downgrade() -> None:
    op.drop_constraint(
        op.f('ck_notifications_notification_kind_valid'),
        'notifications', type_='check',
    )
    op.create_check_constraint('notification_kind_valid', 'notifications', _KINDS_OLD)
    op.drop_constraint(
        op.f('fk_notifications_task_id_tasks'), 'notifications', type_='foreignkey'
    )
    op.drop_column('notifications', 'task_id')
