"""drop_old_tg_id_unique

Revision ID: a8c5e1f37b94
Revises: f6b3d9e25a18
Create Date: 2026-11-06 10:00:00.000000

"""
from collections.abc import Sequence

from alembic import op

# revision identifiers, used by Alembic.
revision: str = 'a8c5e1f37b94'
down_revision: str | None = 'f6b3d9e25a18'
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    # Предыдущая миграция сняла старую уникальность tg_id по имени Postgres по умолчанию
    # (`..._tg_id_key`), а на деле ограничение названо по naming_convention —
    # `uq_intake_applications_tg_id`, и осталось. Снимаем оба имени, IF EXISTS.
    op.execute("ALTER TABLE intake_applications DROP CONSTRAINT IF EXISTS uq_intake_applications_tg_id")
    op.execute("ALTER TABLE intake_applications DROP CONSTRAINT IF EXISTS intake_applications_tg_id_key")


def downgrade() -> None:
    pass
