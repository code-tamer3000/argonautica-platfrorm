"""push_subscriptions_and_admin_notifications

Revision ID: 65af0834bb94
Revises: 3fc6c4518667
Create Date: 2026-07-09 14:17:43.186694

Web Push (VAPID): таблица подписок + расширение уведомлений под админ-рассылку.
Expand-only (п.8): новая таблица, два nullable-столбца, расширение CHECK-набора
kind — обратно совместимо (старые строки проходят новый CHECK).

Фантомные диффы автогена (ix_journal_credits_user_id / ix_journal_pardons_user_id /
ix_journal_sections_program_id / uq_rooms_single_news) НЕ включены намеренно —
см. docs/DATA_MODEL.md «Migrations gotchas».
"""
from collections.abc import Sequence

import sqlalchemy as sa

from alembic import op

# revision identifiers, used by Alembic.
revision: str = '65af0834bb94'
down_revision: str | None = '3fc6c4518667'
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

_KINDS_OLD = "'dm', 'reply', 'news', 'journal_missed', 'cabin_granted'"
_KINDS_NEW = "'dm', 'reply', 'news', 'journal_missed', 'cabin_granted', 'admin'"


def upgrade() -> None:
    op.create_table(
        'push_subscriptions',
        sa.Column('id', sa.BigInteger(), autoincrement=True, nullable=False),
        sa.Column('user_id', sa.BigInteger(), nullable=False),
        sa.Column('endpoint', sa.Text(), nullable=False),
        sa.Column('p256dh', sa.Text(), nullable=False),
        sa.Column('auth', sa.Text(), nullable=False),
        sa.Column('user_agent', sa.Text(), nullable=True),
        sa.Column(
            'created_at', sa.DateTime(timezone=True),
            server_default=sa.text('now()'), nullable=False,
        ),
        sa.ForeignKeyConstraint(
            ['user_id'], ['users.id'],
            name=op.f('fk_push_subscriptions_user_id_users'), ondelete='CASCADE',
        ),
        sa.PrimaryKeyConstraint('id', name=op.f('pk_push_subscriptions')),
        sa.UniqueConstraint('endpoint', name=op.f('uq_push_subscriptions_endpoint')),
    )
    op.create_index(
        op.f('ix_push_subscriptions_user_id'), 'push_subscriptions',
        ['user_id'], unique=False,
    )

    op.add_column('notifications', sa.Column('title', sa.Text(), nullable=True))
    op.add_column('notifications', sa.Column('body', sa.Text(), nullable=True))

    # Расширяем набор допустимых kind добавлением 'admin' (админ-рассылка).
    op.drop_constraint('notification_kind_valid', 'notifications', type_='check')
    op.create_check_constraint(
        'notification_kind_valid', 'notifications', f"kind IN ({_KINDS_NEW})"
    )


def downgrade() -> None:
    op.drop_constraint('notification_kind_valid', 'notifications', type_='check')
    op.create_check_constraint(
        'notification_kind_valid', 'notifications', f"kind IN ({_KINDS_OLD})"
    )
    op.drop_column('notifications', 'body')
    op.drop_column('notifications', 'title')
    op.drop_index(
        op.f('ix_push_subscriptions_user_id'), table_name='push_subscriptions'
    )
    op.drop_table('push_subscriptions')
