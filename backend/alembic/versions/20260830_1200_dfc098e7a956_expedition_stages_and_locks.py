"""expedition_stages_and_locks

Круг Экспедиции: расписание этапов потока (intake_stages) + гексаграммы,
введённые участником в четыре замка стихий (expedition_locks).

Revision ID: dfc098e7a956
Revises: 1bdaabcaa132
Create Date: 2026-08-30 12:00:00.000000

"""
from collections.abc import Sequence

import sqlalchemy as sa

from alembic import op

# revision identifiers, used by Alembic.
revision: str = 'dfc098e7a956'
down_revision: str | None = '1bdaabcaa132'
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    # Автогенерация к этой миграции также нашла 4 фантомных диффа (индексы) —
    # известная гоча, не относящаяся к ней, см. docs/DATA_MODEL.md «Migrations
    # gotchas». Не коммитим их здесь.
    op.create_table(
        'intake_stages',
        sa.Column('id', sa.BigInteger(), autoincrement=True, nullable=False),
        sa.Column('intake_id', sa.BigInteger(), nullable=False),
        sa.Column('kind', sa.Text(), nullable=False),
        sa.Column('air_date', sa.Date(), nullable=False),
        sa.Column('air_time', sa.Time(), nullable=True),
        sa.Column('task_id', sa.BigInteger(), nullable=True),
        sa.CheckConstraint(
            "kind IN ('balance', 'air', 'fire', 'water', 'earth', 'final')",
            name='intake_stage_kind_valid',
        ),
        sa.ForeignKeyConstraint(['intake_id'], ['intakes.id'], ondelete='CASCADE'),
        sa.ForeignKeyConstraint(['task_id'], ['tasks.id'], ondelete='SET NULL'),
        sa.PrimaryKeyConstraint('id'),
        sa.UniqueConstraint('intake_id', 'kind', name='uq_intake_stages_intake_kind'),
    )
    op.create_table(
        'expedition_locks',
        sa.Column('id', sa.BigInteger(), autoincrement=True, nullable=False),
        sa.Column('user_id', sa.BigInteger(), nullable=False),
        sa.Column('element', sa.Text(), nullable=False),
        sa.Column('key_number', sa.Integer(), nullable=False),
        sa.Column('hexagram', sa.Text(), nullable=False),
        sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=False),
        sa.Column('updated_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=False),
        sa.CheckConstraint(
            "element IN ('air', 'fire', 'water', 'earth')",
            name='expedition_lock_element_valid',
        ),
        sa.CheckConstraint(
            'key_number >= 1 AND key_number <= 64',
            name='expedition_lock_key_number_valid',
        ),
        sa.ForeignKeyConstraint(['user_id'], ['users.id']),
        sa.PrimaryKeyConstraint('id'),
        sa.UniqueConstraint('user_id', 'element', name='uq_expedition_locks_user_element'),
    )


def downgrade() -> None:
    op.drop_table('expedition_locks')
    op.drop_table('intake_stages')
