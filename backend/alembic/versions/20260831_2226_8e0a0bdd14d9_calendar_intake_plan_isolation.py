"""calendar_events.intake_id + calendar_event_plans (ARG-111)

Revision ID: 8e0a0bdd14d9
Revises: f2a7c9e1b6d4
Create Date: 2026-08-31 22:26:30.450692

Изоляция событий календаря по потоку и тарифу — тот же механизм, что уже есть у
каналов/common-задач/материалов КБ (ARG-96, см. docs/DATA_MODEL.md "Content
isolation by intake and plan"). `intake_id` (nullable FK intakes, NULL = виден всем
потокам) + `calendar_event_plans` (пусто = виден всем тарифам потока).

`room_id` (устаревший, более грубый механизм видимости по каналу — на практике не
использовался) в этой миграции не трогаем: код перестаёт его читать/писать, но
колонка остаётся физически (expand/contract, CLAUDE.md) — дроп отдельной миграцией
позже.

Autogenerate заодно предложил дропнуть `notifications.task_id` (несвязанный
дрейф модели/схемы, не эта задача) и 4 фантомных индекса из "Migrations gotchas"
(docs/DATA_MODEL.md) — обе группы вычищены из этого файла вручную.

Expand-only: новая колонка nullable, новая таблица пустая, старый код их не знает.
"""
from collections.abc import Sequence

import sqlalchemy as sa

from alembic import op

# revision identifiers, used by Alembic.
revision: str = '8e0a0bdd14d9'
down_revision: str | None = 'f2a7c9e1b6d4'
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.create_table('calendar_event_plans',
    sa.Column('calendar_event_id', sa.BigInteger(), nullable=False),
    sa.Column('plan_id', sa.BigInteger(), nullable=False),
    sa.ForeignKeyConstraint(['calendar_event_id'], ['calendar_events.id'], name=op.f('fk_calendar_event_plans_calendar_event_id_calendar_events')),
    sa.ForeignKeyConstraint(['plan_id'], ['plans.id'], name=op.f('fk_calendar_event_plans_plan_id_plans')),
    sa.PrimaryKeyConstraint('calendar_event_id', 'plan_id', name=op.f('pk_calendar_event_plans'))
    )
    op.add_column('calendar_events', sa.Column('intake_id', sa.BigInteger(), nullable=True))
    op.create_foreign_key(op.f('fk_calendar_events_intake_id_intakes'), 'calendar_events', 'intakes', ['intake_id'], ['id'])


def downgrade() -> None:
    op.drop_constraint(op.f('fk_calendar_events_intake_id_intakes'), 'calendar_events', type_='foreignkey')
    op.drop_column('calendar_events', 'intake_id')
    op.drop_table('calendar_event_plans')
