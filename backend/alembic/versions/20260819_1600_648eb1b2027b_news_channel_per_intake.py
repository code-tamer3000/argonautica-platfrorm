"""news channel isolated per intake, drop singleton constraint (ARG-104)

Revision ID: 648eb1b2027b
Revises: cce2af239220
Create Date: 2026-08-19 16:00:00

Новостной канал (`rooms.is_news`) был singleton, кросс-поточный намеренно
(ARG-96). ARG-104 снимает это исключение: канал получает `intake_id`, как
обычный channel, и одна платформа может иметь по новостному каналу на поток.

Бэкфилл: существующий singleton получает `intake_id` исторического (самого
раннего) набора — тот же выбор, что миграция 8f3c1a9d5e21 применила к обычным
каналам/задачам/материалам КБ.

`uq_rooms_single_news` (`WHERE is_news`) заменяется на `uq_rooms_news_per_intake`
(`WHERE is_news`, unique по `intake_id`) — один новостной канал на поток вместо
одного на всю платформу. Expand/contract: старый индекс просто заменяется новым,
код blue/green читает/пишет через `ensure_news_channel(session, intake_id)`,
которая теперь везде вызывается с конкретным intake_id (см. app/services/rooms.py).
"""
from alembic import op

revision = "648eb1b2027b"
down_revision = "cce2af239220"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.execute(
        """
        UPDATE rooms
        SET intake_id = (SELECT id FROM intakes ORDER BY starts_on ASC LIMIT 1)
        WHERE is_news = true AND intake_id IS NULL
        """
    )
    op.execute("DROP INDEX IF EXISTS uq_rooms_single_news")
    op.execute(
        "CREATE UNIQUE INDEX uq_rooms_news_per_intake ON rooms (intake_id) WHERE is_news"
    )


def downgrade() -> None:
    op.execute("DROP INDEX IF EXISTS uq_rooms_news_per_intake")
    op.execute(
        "CREATE UNIQUE INDEX uq_rooms_single_news ON rooms (is_news) WHERE is_news"
    )
