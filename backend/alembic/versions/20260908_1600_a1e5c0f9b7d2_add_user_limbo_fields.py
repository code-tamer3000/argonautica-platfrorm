"""add user limbo fields

Revision ID: a1e5c0f9b7d2
Revises: d88beb19a5a2
Create Date: 2026-09-08 16:00:00.000000

"""
from collections.abc import Sequence

import sqlalchemy as sa

from alembic import op

# revision identifiers, used by Alembic.
revision: str = 'a1e5c0f9b7d2'
down_revision: str | None = 'd88beb19a5a2'
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    # Междумирье (ARG-*): временное состояние участника, понижённого с платного
    # тарифа до самого дешёвого, пока не истёк 5-дневный срок на отработку. Все
    # три поля NULL одновременно — не в междумирье; проставляются вместе при
    # входе (PATCH /api/admin/users/{id} plan_id -> дешёвый тариф) и вместе
    # обнуляются при выходе (успел -> тариф восстановлен, не успел -> просто
    # снимается срочность). См. docs/LIMBO.md.
    op.add_column(
        'users', sa.Column('limbo_previous_plan_id', sa.BigInteger(), nullable=True)
    )
    op.create_foreign_key(
        op.f('fk_users_limbo_previous_plan_id_plans'),
        'users',
        'plans',
        ['limbo_previous_plan_id'],
        ['id'],
    )
    op.add_column(
        'users',
        sa.Column('limbo_deadline_at', sa.DateTime(timezone=True), nullable=True),
    )
    op.add_column(
        'users', sa.Column('limbo_makeup_task_id', sa.BigInteger(), nullable=True)
    )
    op.create_foreign_key(
        op.f('fk_users_limbo_makeup_task_id_tasks'),
        'users',
        'tasks',
        ['limbo_makeup_task_id'],
        ['id'],
    )


def downgrade() -> None:
    op.drop_constraint(
        op.f('fk_users_limbo_makeup_task_id_tasks'), 'users', type_='foreignkey'
    )
    op.drop_column('users', 'limbo_makeup_task_id')
    op.drop_column('users', 'limbo_deadline_at')
    op.drop_constraint(
        op.f('fk_users_limbo_previous_plan_id_plans'), 'users', type_='foreignkey'
    )
    op.drop_column('users', 'limbo_previous_plan_id')
