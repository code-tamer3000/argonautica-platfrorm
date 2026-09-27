"""add rooms.torch_scope (ARG-54, part 2: Факел own section)

Revision ID: 054d6c6c460b
Revises: d815921dc820
Create Date: 2026-09-27 14:00:00.000000

Клуб «Факел» становится отдельным разделом со своим списком чатов (не табом
внутри Рубки): нужен способ отличить «эта dm/группа относится к Факелу» от
обычных комнат Рубки. `is_torch` для этого не годится — он узкоspecific
маркер ОДНОЙ singleton-комнаты клуба (partial unique index не даёт второй
такой). `torch_scope` — широкий маркер, ставится и на неё, и на любые dm/группы,
созданные внутри раздела «Факел».

Бэкфилл: у уже существующей singleton-комнаты (если кто-то успел включить
тумблер до этой миграции) синхронизируем `torch_scope` с `is_torch`.

Expand-only, ничего не дропаем/не переименовываем — безопасно для blue-green.
"""
from collections.abc import Sequence

import sqlalchemy as sa

from alembic import op

# revision identifiers, used by Alembic.
revision: str = '054d6c6c460b'
down_revision: str | None = 'd815921dc820'
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.add_column(
        'rooms',
        sa.Column(
            'torch_scope',
            sa.Boolean(),
            nullable=False,
            server_default=sa.text('false'),
        ),
    )
    op.execute("UPDATE rooms SET torch_scope = true WHERE is_torch = true")


def downgrade() -> None:
    op.drop_column('rooms', 'torch_scope')
