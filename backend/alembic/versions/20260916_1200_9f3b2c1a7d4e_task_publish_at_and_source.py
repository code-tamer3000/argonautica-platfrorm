"""task publish_at and source_task_id

База заданий и отложенная публикация (админский хаб «Задания»):

- `tasks.publish_at` — NULL (все исторические строки) означает «опубликована
  сразу»; иначе задача скрыта от не-админов до этого момента и проявляется
  лениво на чтении, без планировщика (в проекте его нет принципиально, см.
  services/limbo.py) — тем же принципом, что 5-дневный срок Междумирья.
- `tasks.source_task_id` — самоссылка на задачу, из которой эта клонирована
  переизданием на другой поток (`services/tasks.py::clone_task`). NULL —
  задача создана обычным способом, не клон.

Autogenerate также предложил фантомные дропы/пересоздания индексов, не
относящиеся к этой задаче (см. docs/DATA_MODEL.md "Migrations gotchas") —
убраны. Expand-only.

Revision ID: 9f3b2c1a7d4e
Revises: 63874d0d661a
Create Date: 2026-09-16 12:00:00.000000

"""
from collections.abc import Sequence

import sqlalchemy as sa

from alembic import op

# revision identifiers, used by Alembic.
revision: str = '9f3b2c1a7d4e'
down_revision: str | None = '63874d0d661a'
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.add_column(
        'tasks',
        sa.Column('publish_at', sa.DateTime(timezone=True), nullable=True),
    )
    op.add_column(
        'tasks',
        sa.Column('source_task_id', sa.BigInteger(), nullable=True),
    )
    op.create_foreign_key(
        'fk_tasks_source_task_id_tasks',
        'tasks',
        'tasks',
        ['source_task_id'],
        ['id'],
    )
    op.create_index(
        'ix_tasks_publish_at',
        'tasks',
        ['publish_at'],
        postgresql_where=sa.text('publish_at IS NOT NULL'),
    )


def downgrade() -> None:
    op.drop_index('ix_tasks_publish_at', table_name='tasks')
    op.drop_constraint('fk_tasks_source_task_id_tasks', 'tasks', type_='foreignkey')
    op.drop_column('tasks', 'source_task_id')
    op.drop_column('tasks', 'publish_at')
