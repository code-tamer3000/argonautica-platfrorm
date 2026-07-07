"""add journal_pardons table

Revision ID: f6a7b8c9d0e1
Revises: e5f6a7b8c9d0
Create Date: 2026-07-03 11:00:00.000000

Таблица хранит «помилования» — каждый участник может аннулировать
до 3 пропущенных дней дневника (кнопка «Плавы с китами»).

Обратная совместимость (blue-green, п.8): новая таблица, старый код её не трогает.
Downgrade безопасен — данных ещё нет.
"""
from collections.abc import Sequence

import sqlalchemy as sa

from alembic import op

revision: str = "f6a7b8c9d0e1"
down_revision: str | None = "e5f6a7b8c9d0"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.create_table(
        "journal_pardons",
        sa.Column("id", sa.BigInteger(), autoincrement=True, nullable=False),
        sa.Column("user_id", sa.BigInteger(), nullable=False),
        sa.Column("date", sa.Date(), nullable=False),
        sa.Column(
            "used_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("now()"),
            nullable=False,
        ),
        sa.ForeignKeyConstraint(["user_id"], ["users.id"]),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("user_id", "date", name="uq_journal_pardons_user_date"),
    )
    op.create_index("ix_journal_pardons_user_id", "journal_pardons", ["user_id"])


def downgrade() -> None:
    op.drop_index("ix_journal_pardons_user_id", "journal_pardons")
    op.drop_table("journal_pardons")
