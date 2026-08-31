"""add message reactions

Revision ID: f2a7c9e1b6d4
Revises: a1e94f7d3c2b
Create Date: 2026-08-31 15:00:00.000000

Реакции на сообщения: один фиксированный образ (MVP), максимум одна реакция на
юзера на сообщение — композитный PK (message_id, user_id) даёт и уникальность, и
готовый индекс для агрегатных запросов count/reacted_by_me по message_id.
Expand-only (п.8): новая таблица, без изменений существующих.
"""
from collections.abc import Sequence

import sqlalchemy as sa

from alembic import op

revision: str = "f2a7c9e1b6d4"
down_revision: str | None = "a1e94f7d3c2b"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.create_table(
        "message_reactions",
        sa.Column("message_id", sa.BigInteger(), nullable=False),
        sa.Column("user_id", sa.BigInteger(), nullable=False),
        sa.Column(
            "created_at", sa.DateTime(timezone=True),
            server_default=sa.text("now()"), nullable=False,
        ),
        sa.ForeignKeyConstraint(
            ["message_id"], ["messages.id"],
            name=op.f("fk_message_reactions_message_id_messages"),
        ),
        sa.ForeignKeyConstraint(
            ["user_id"], ["users.id"],
            name=op.f("fk_message_reactions_user_id_users"),
        ),
        sa.PrimaryKeyConstraint(
            "message_id", "user_id",
            name=op.f("pk_message_reactions"),
        ),
    )


def downgrade() -> None:
    op.drop_table("message_reactions")
