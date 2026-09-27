"""torch admin and applied at (ARG-158)

Revision ID: 3fa0cc35c661
Revises: b2d1c27ea500
Create Date: 2026-09-27 15:47:24.331965

Кнопка «Подать заявку» на гейте клуба «Факел»:

- `torch_settings.admin_user_id` — назначенный админ клуба, с кем сводит кнопка.
- `users.torch_applied_at` — отметка первого клика по кнопке.

Autogenerate заодно предложил снять `calendar_events.room_id` и 4 фантомных
индекса (`ix_journal_credits_user_id`, `ix_journal_pardons_user_id`,
`ix_journal_sections_program_id`, `uq_rooms_news_per_intake`,
`uq_rooms_torch_singleton`, `ix_tasks_publish_at`) — см. docs/DATA_MODEL.md
"Migrations gotchas", это шум окружения, не убираем.
"""
from collections.abc import Sequence

import sqlalchemy as sa

from alembic import op

# revision identifiers, used by Alembic.
revision: str = '3fa0cc35c661'
down_revision: str | None = 'b2d1c27ea500'
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.add_column('torch_settings', sa.Column('admin_user_id', sa.BigInteger(), nullable=True))
    op.create_foreign_key(op.f('fk_torch_settings_admin_user_id_users'), 'torch_settings', 'users', ['admin_user_id'], ['id'])
    op.add_column('users', sa.Column('torch_applied_at', sa.DateTime(timezone=True), nullable=True))


def downgrade() -> None:
    op.drop_column('users', 'torch_applied_at')
    op.drop_constraint(op.f('fk_torch_settings_admin_user_id_users'), 'torch_settings', type_='foreignkey')
    op.drop_column('torch_settings', 'admin_user_id')
