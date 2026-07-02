"""add kb_comments

Revision ID: c3d4e5f6a7b8
Revises: b2c3d4e5f6a7
Create Date: 2026-07-02 14:00:00.000000

Плоские комментарии участников под материалом БЗ. Мягкое удаление (deleted_at, п.6).
Индекс по (kb_item_id, created_at) — под ленту комментариев материала.
"""
from collections.abc import Sequence

import sqlalchemy as sa

from alembic import op

revision: str = "c3d4e5f6a7b8"
down_revision: str | None = "b2c3d4e5f6a7"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.create_table(
        "kb_comments",
        sa.Column("id", sa.BigInteger(), autoincrement=True, nullable=False),
        sa.Column("kb_item_id", sa.BigInteger(), nullable=False),
        sa.Column("author_id", sa.BigInteger(), nullable=False),
        sa.Column("body", sa.Text(), nullable=False),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("now()"),
            nullable=False,
        ),
        sa.Column("deleted_at", sa.DateTime(timezone=True), nullable=True),
        sa.ForeignKeyConstraint(
            ["kb_item_id"], ["kb_items.id"],
            name=op.f("fk_kb_comments_kb_item_id_kb_items"),
        ),
        sa.ForeignKeyConstraint(
            ["author_id"], ["users.id"],
            name=op.f("fk_kb_comments_author_id_users"),
        ),
        sa.PrimaryKeyConstraint("id", name=op.f("pk_kb_comments")),
    )
    op.create_index(
        "ix_kb_comments_item_created",
        "kb_comments",
        ["kb_item_id", "created_at"],
        unique=False,
    )


def downgrade() -> None:
    op.drop_index("ix_kb_comments_item_created", table_name="kb_comments")
    op.drop_table("kb_comments")
