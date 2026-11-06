"""intake_application_intake_id

Revision ID: f6b3d9e25a18
Revises: e5a2c8d41b07
Create Date: 2026-11-06 09:00:00.000000

"""
from collections.abc import Sequence

import sqlalchemy as sa

from alembic import op

# revision identifiers, used by Alembic.
revision: str = 'f6b3d9e25a18'
down_revision: str | None = 'e5a2c8d41b07'
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    # expand: nullable-колонка, старый код её не знает. Уникальность tg_id ослабляем
    # до (tg_id, intake_id), чтобы вернувшийся участник мог подать заявку на новый
    # поток (ARG-176). Бот не в blue-green — единственный читатель таблицы.
    op.add_column('intake_applications', sa.Column('intake_id', sa.BigInteger(), nullable=True))
    op.create_foreign_key(
        op.f('fk_intake_applications_intake_id_intakes'),
        'intake_applications', 'intakes', ['intake_id'], ['id'],
    )
    # Бэкфилл: поток зачисленных заявок — поток их учётки. Остальные остаются NULL.
    op.execute(
        "UPDATE intake_applications a SET intake_id = u.intake_id "
        "FROM users u WHERE a.user_id = u.id"
    )
    op.execute(
        "ALTER TABLE intake_applications DROP CONSTRAINT IF EXISTS intake_applications_tg_id_key"
    )
    op.create_index(
        'uq_intake_applications_tg_id_intake_id',
        'intake_applications', ['tg_id', 'intake_id'], unique=True,
    )
    op.create_index(
        'uq_intake_applications_tg_id_no_intake',
        'intake_applications', ['tg_id'], unique=True,
        postgresql_where=sa.text('intake_id IS NULL'),
    )


def downgrade() -> None:
    op.drop_index('uq_intake_applications_tg_id_no_intake', table_name='intake_applications')
    op.drop_index('uq_intake_applications_tg_id_intake_id', table_name='intake_applications')
    op.create_unique_constraint('intake_applications_tg_id_key', 'intake_applications', ['tg_id'])
    op.drop_constraint(
        op.f('fk_intake_applications_intake_id_intakes'), 'intake_applications', type_='foreignkey'
    )
    op.drop_column('intake_applications', 'intake_id')
