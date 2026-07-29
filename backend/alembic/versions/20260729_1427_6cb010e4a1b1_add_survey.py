"""add survey

Выпускная анкета экспедиции: таблица ответов + два флага на пользователе
(перекрытие платформы и подарок-книга). Expand-only, ничего не удаляем.

Фантомные диффы autogenerate (индексы journal_*/rooms и notifications.task_id —
см. docs/DATA_MODEL.md «Migrations gotchas») из миграции убраны намеренно.

Revision ID: 6cb010e4a1b1
Revises: dc5ada6300f9
Create Date: 2026-07-29 14:27:33.218323

"""
from collections.abc import Sequence

import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

from alembic import op

# revision identifiers, used by Alembic.
revision: str = '6cb010e4a1b1'
down_revision: str | None = 'dc5ada6300f9'
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.create_table(
        'survey_responses',
        sa.Column('id', sa.BigInteger(), autoincrement=True, nullable=False),
        sa.Column('user_id', sa.BigInteger(), nullable=False),
        sa.Column('version', sa.Integer(), nullable=False),
        sa.Column(
            'answers', postgresql.JSONB(astext_type=sa.Text()), nullable=False
        ),
        sa.Column(
            'publish_consent',
            sa.Boolean(),
            server_default='false',
            nullable=False,
        ),
        sa.Column(
            'created_at',
            sa.DateTime(timezone=True),
            server_default=sa.text('now()'),
            nullable=False,
        ),
        sa.ForeignKeyConstraint(
            ['user_id'], ['users.id'], name=op.f('fk_survey_responses_user_id_users')
        ),
        sa.PrimaryKeyConstraint('id', name=op.f('pk_survey_responses')),
        sa.UniqueConstraint('user_id', name=op.f('uq_survey_responses_user_id')),
    )
    op.add_column(
        'users',
        sa.Column(
            'survey_required', sa.Boolean(), server_default='false', nullable=False
        ),
    )
    op.add_column(
        'users', sa.Column('survey_gift_asset_id', sa.BigInteger(), nullable=True)
    )
    op.create_foreign_key(
        op.f('fk_users_survey_gift_asset_id_media_assets'),
        'users',
        'media_assets',
        ['survey_gift_asset_id'],
        ['id'],
    )


def downgrade() -> None:
    op.drop_constraint(
        op.f('fk_users_survey_gift_asset_id_media_assets'),
        'users',
        type_='foreignkey',
    )
    op.drop_column('users', 'survey_gift_asset_id')
    op.drop_column('users', 'survey_required')
    op.drop_table('survey_responses')
