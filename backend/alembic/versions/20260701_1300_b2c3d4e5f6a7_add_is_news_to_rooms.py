"""add is_news to rooms + single-news unique index

Revision ID: b2c3d4e5f6a7
Revises: a1b2c3d4e5f6
Create Date: 2026-07-01 13:00:00.000000

Схема: добавляем флаг is_news. Сам новостной канал (singleton) создаётся лениво
на старте приложения (ensure_news_channel), т.к. ему нужен created_by = admin,
которого на fresh-БД во время миграции ещё нет. Частичный уникальный индекс
гарантирует, что новостной канал в системе ровно один (защита от гонки blue/green).
"""
from collections.abc import Sequence

import sqlalchemy as sa

from alembic import op

revision: str = "b2c3d4e5f6a7"
down_revision: str | None = "a1b2c3d4e5f6"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.add_column(
        "rooms",
        sa.Column("is_news", sa.Boolean(), nullable=False, server_default="false"),
    )
    # Не более одной строки с is_news = true.
    op.execute(
        "CREATE UNIQUE INDEX uq_rooms_single_news ON rooms (is_news) WHERE is_news"
    )


def downgrade() -> None:
    op.execute("DROP INDEX IF EXISTS uq_rooms_single_news")
    op.execute("DELETE FROM rooms WHERE is_news = true")
    op.drop_column("rooms", "is_news")
