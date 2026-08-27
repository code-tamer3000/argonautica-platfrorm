"""intake_application_price_snapshot

Revision ID: 1bdaabcaa132
Revises: 9e747d7af6f6
Create Date: 2026-08-27 16:52:48.131941

"""
from collections.abc import Sequence

import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

from alembic import op

# revision identifiers, used by Alembic.
revision: str = '1bdaabcaa132'
down_revision: str | None = '9e747d7af6f6'
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    # Автогенерация также нашла 4 фантомных диффа (3 индекса + notifications.task_id
    # FK/колонка) — известная гоча, не относящаяся к этой миграции, см.
    # docs/DATA_MODEL.md «Migrations gotchas». Не коммитим их здесь.
    op.add_column('intake_applications', sa.Column('price_snapshot', postgresql.JSONB(astext_type=sa.Text()), nullable=True))


def downgrade() -> None:
    op.drop_column('intake_applications', 'price_snapshot')
