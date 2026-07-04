"""add journal_credits table

Revision ID: c9d0e1f2a3b4
Revises: a7b8c9d0e1f2
Create Date: 2026-07-04 10:00:00.000000

Таблица хранит «зачёты дней» — админ вручную отмечает день участнику закрытым
(человек сдал не через форму, был сбой по времени и т.п.). Без лимита, в отличие
от помилований.

Обратная совместимость (blue-green, п.8): новая таблица, старый код её не трогает.
Downgrade безопасен — данных ещё нет.
"""
from collections.abc import Sequence

import sqlalchemy as sa

from alembic import op

revision: str = "c9d0e1f2a3b4"
down_revision: str | None = "a7b8c9d0e1f2"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.create_table(
        "journal_credits",
        sa.Column("id", sa.BigInteger(), autoincrement=True, nullable=False),
        sa.Column("user_id", sa.BigInteger(), nullable=False),
        sa.Column("date", sa.Date(), nullable=False),
        sa.Column("granted_by", sa.BigInteger(), nullable=False),
        sa.Column(
            "granted_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("now()"),
            nullable=False,
        ),
        sa.ForeignKeyConstraint(["user_id"], ["users.id"]),
        sa.ForeignKeyConstraint(["granted_by"], ["users.id"]),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("user_id", "date", name="uq_journal_credits_user_date"),
    )
    op.create_index("ix_journal_credits_user_id", "journal_credits", ["user_id"])


def downgrade() -> None:
    op.drop_index("ix_journal_credits_user_id", "journal_credits")
    op.drop_table("journal_credits")
