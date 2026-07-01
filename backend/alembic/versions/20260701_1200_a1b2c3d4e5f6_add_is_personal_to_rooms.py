"""add is_personal to rooms + backfill personal channels

Revision ID: a1b2c3d4e5f6
Revises: e10ce43ba1d3
Create Date: 2026-07-01 12:00:00.000000

"""
from collections.abc import Sequence

import sqlalchemy as sa

from alembic import op

revision: str = "a1b2c3d4e5f6"
down_revision: str | None = "e10ce43ba1d3"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.add_column(
        "rooms",
        sa.Column("is_personal", sa.Boolean(), nullable=False, server_default="false"),
    )
    # Backfill: create personal channels for all existing users who don't have one.
    # Uses display_name as channel name (same as the auto-create logic in admin.py).
    op.execute("""
        INSERT INTO rooms (type, name, is_personal, created_by, created_at)
        SELECT 'channel', display_name, true, id, now()
        FROM users u
        WHERE NOT EXISTS (
            SELECT 1 FROM rooms r
            WHERE r.is_personal = true AND r.created_by = u.id
        )
    """)


def downgrade() -> None:
    op.execute("DELETE FROM rooms WHERE is_personal = true")
    op.drop_column("rooms", "is_personal")
