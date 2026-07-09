"""drop_journal_missed_notifications

Revision ID: f0e1d2c3b4a5
Revises: 65af0834bb94
Create Date: 2026-07-09 18:00:00.000000

Данные-only: удаляем накопленные уведомления «день дневника не закрыт»
(kind='journal_missed'). Их генерацию убрали (раздражали пользователей). Само
значение kind оставлено в CHECK ради обратной совместимости — новые строки не
создаются, но и старый констрейнт не трогаем (expand/contract, п.8).

downgrade — no-op: восстановить удалённые уведомления неоткуда, да и не нужно.
"""
from collections.abc import Sequence

from alembic import op

# revision identifiers, used by Alembic.
revision: str = 'f0e1d2c3b4a5'
down_revision: str | None = '65af0834bb94'
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.execute("DELETE FROM notifications WHERE kind = 'journal_missed'")


def downgrade() -> None:
    # Необратимо — удалённые уведомления не восстанавливаем.
    pass
