"""add journal_pardons table

Revision ID: e5f6a7b8c9d0
Revises: d4e5f6a7b8c9
Create Date: 2026-07-03 10:00:00.000000

Таблица хранит «помилования» — каждый участник может аннулировать
до 3 пропущенных дней дневника (кнопка «Плавы с китами»).

Обратная совместимость (blue-green, п.8): новая таблица, старый код её не трогает.
Downgrade безопасен — данных ещё нет.
"""
from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "e5f6a7b8c9d0"
down_revision: str | None = "d4e5f6a7b8c9"
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
