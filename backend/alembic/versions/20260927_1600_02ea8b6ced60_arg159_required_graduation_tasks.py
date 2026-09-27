"""arg159: required tasks for expedition artifact

Revision ID: 02ea8b6ced60
Revises: 3fa0cc35c661
Create Date: 2026-09-27 16:00:00.000000

Артефакт экспедиции открывается только после сдачи обязательных заданий,
выбранных админом в разделе анкеты (ARG-159).

- `tasks.required_for_graduation` — админ отмечает общее (`type='common'`)
  задание обязательным для получения артефакта. Пусто/false у всех —
  поведение как раньше, гейта нет.
- `survey_responses.required_task_ids` — снимок id таких заданий на момент
  сдачи анкеты; правки админа после выпуска участника уже не ретроактивны.

Expand-only, ничего не дропаем/не переименовываем — безопасно для blue-green.
"""
from collections.abc import Sequence

import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

from alembic import op

# revision identifiers, used by Alembic.
revision: str = '02ea8b6ced60'
down_revision: str | None = '3fa0cc35c661'
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.add_column(
        'tasks',
        sa.Column(
            'required_for_graduation',
            sa.Boolean(),
            nullable=False,
            server_default=sa.text('false'),
        ),
    )
    op.add_column(
        'survey_responses',
        sa.Column(
            'required_task_ids',
            postgresql.JSONB(astext_type=sa.Text()),
            nullable=False,
            server_default=sa.text("'[]'::jsonb"),
        ),
    )


def downgrade() -> None:
    op.drop_column('survey_responses', 'required_task_ids')
    op.drop_column('tasks', 'required_for_graduation')
