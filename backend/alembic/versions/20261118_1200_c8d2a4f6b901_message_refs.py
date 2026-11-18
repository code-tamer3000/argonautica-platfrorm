"""replace singular message refs with ordered message_refs

Revision ID: c8d2a4f6b901
Revises: b7d4f2a91c35
Create Date: 2026-11-18
"""
from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "c8d2a4f6b901"
down_revision: str | None = "b7d4f2a91c35"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.create_table(
        "message_refs",
        sa.Column("message_id", sa.BigInteger(), sa.ForeignKey("messages.id", ondelete="CASCADE"), primary_key=True),
        sa.Column("kind", sa.Text(), primary_key=True),
        sa.Column("ref_id", sa.BigInteger(), primary_key=True),
        sa.Column("position", sa.Integer(), nullable=False),
        sa.CheckConstraint("kind IN ('kb', 'task')", name="ck_message_refs_kind"),
    )
    op.create_index("ix_message_refs_target", "message_refs", ["kind", "ref_id"])
    op.execute("""
        INSERT INTO message_refs (message_id, kind, ref_id, position)
        SELECT id, ref_kind, ref_id, 0 FROM messages
        WHERE ref_kind IS NOT NULL AND ref_id IS NOT NULL
    """)
    op.drop_constraint("ck_messages_ref_pair", "messages", type_="check")
    op.drop_constraint("ck_messages_ref_kind", "messages", type_="check")
    op.drop_column("messages", "ref_id")
    op.drop_column("messages", "ref_kind")


def downgrade() -> None:
    op.add_column("messages", sa.Column("ref_kind", sa.Text(), nullable=True))
    op.add_column("messages", sa.Column("ref_id", sa.BigInteger(), nullable=True))
    op.create_check_constraint("ck_messages_ref_pair", "messages", "(ref_kind IS NULL) = (ref_id IS NULL)")
    op.create_check_constraint("ck_messages_ref_kind", "messages", "ref_kind IS NULL OR ref_kind IN ('kb', 'task')")
    op.execute("""
        UPDATE messages SET ref_kind = refs.kind, ref_id = refs.ref_id
        FROM (SELECT DISTINCT ON (message_id) message_id, kind, ref_id
              FROM message_refs ORDER BY message_id, position) AS refs
        WHERE messages.id = refs.message_id
    """)
    op.drop_index("ix_message_refs_target", table_name="message_refs")
    op.drop_table("message_refs")
