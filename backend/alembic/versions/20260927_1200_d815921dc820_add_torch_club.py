"""add torch club: users.torch_unlocked, rooms.is_torch, torch_settings (ARG-54)

Revision ID: d815921dc820
Revises: f9e2db305d45
Create Date: 2026-09-27 12:00:00.000000

Клуб «Факел»: ручной (не биллинговый) гейт на комьюнити выпускников.

- `users.torch_unlocked` — per-user тумблер, включает/выключает только админ.
- `rooms.is_torch` — метка singleton group-комнаты клуба на всю платформу
  (кросс-поточная по конструкции, как новостной канал до ARG-104 — см.
  `uq_rooms_single_news` в 20260731_.../add_room_is_news для образца этого же
  приёма). Partial unique index без партиционирования по intake_id, в отличие
  от `uq_rooms_news_per_intake`.
- `torch_settings` — одна строка (id=1), общий текст заглушки для тех, у кого
  тумблер ещё выключен; правит админ.

Expand-only, ничего не дропаем/не переименовываем — безопасно для blue-green.
"""
from collections.abc import Sequence

import sqlalchemy as sa

from alembic import op

# revision identifiers, used by Alembic.
revision: str = 'd815921dc820'
down_revision: str | None = 'f9e2db305d45'
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.add_column(
        'users',
        sa.Column(
            'torch_unlocked',
            sa.Boolean(),
            nullable=False,
            server_default=sa.text('false'),
        ),
    )
    op.add_column(
        'rooms',
        sa.Column(
            'is_torch',
            sa.Boolean(),
            nullable=False,
            server_default=sa.text('false'),
        ),
    )
    op.execute(
        "CREATE UNIQUE INDEX uq_rooms_torch_singleton ON rooms (is_torch) WHERE is_torch"
    )
    op.create_table(
        'torch_settings',
        sa.Column('id', sa.BigInteger(), primary_key=True),
        sa.Column(
            'stub_text',
            sa.Text(),
            nullable=False,
            server_default=(
                "Факел зажигается не сразу — доступ в клуб выпускников открывает "
                "администратор."
            ),
        ),
        sa.Column(
            'updated_at',
            sa.DateTime(timezone=True),
            nullable=False,
            server_default=sa.func.now(),
        ),
        sa.CheckConstraint('id = 1', name=op.f('ck_torch_settings_singleton')),
    )


def downgrade() -> None:
    op.drop_table('torch_settings')
    op.execute('DROP INDEX IF EXISTS uq_rooms_torch_singleton')
    op.drop_column('rooms', 'is_torch')
    op.drop_column('users', 'torch_unlocked')
