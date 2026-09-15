"""rooms dm_unlocked_by_admin

Revision ID: 63874d0d661a
Revises: 1dc64b3ba309
Create Date: 2026-09-15 12:30:45.245771

"""
from collections.abc import Sequence

import sqlalchemy as sa

from alembic import op

# revision identifiers, used by Alembic.
revision: str = '63874d0d661a'
down_revision: str | None = '1dc64b3ba309'
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    # NOTE: autogenerate also proposed dropping calendar_events.room_id,
    # notifications.task_id, and three journal_*/rooms indexes — unrelated to
    # this change (see docs/DATA_MODEL.md "Migrations gotchas" for the four
    # known phantom index diffs; the two column drops are separate drift, not
    # ours to carry in this migration). Trimmed by hand to just the new column.
    op.add_column('rooms', sa.Column('dm_unlocked_by_admin', sa.Boolean(), server_default='false', nullable=False))


def downgrade() -> None:
    op.drop_column('rooms', 'dm_unlocked_by_admin')
