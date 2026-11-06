"""intake_application_kind

Revision ID: b7d4f2a91c35
Revises: a8c5e1f37b94
Create Date: 2026-11-06 12:00:00.000000

"""
from collections.abc import Sequence

import sqlalchemy as sa

from alembic import op

# revision identifiers, used by Alembic.
revision: str = 'b7d4f2a91c35'
down_revision: str | None = 'a8c5e1f37b94'
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    # expand: nullable-колонка, старый код её не знает (ARG-189). Историческим заявкам
    # тип не восстанавливаем — NULL.
    op.add_column('intake_applications', sa.Column('applicant_kind', sa.Text(), nullable=True))
    op.create_check_constraint(
        op.f('ck_intake_applications_intake_application_kind_valid'),
        'intake_applications',
        "applicant_kind IS NULL OR applicant_kind IN ('new', 'retry', 'returning')",
    )


def downgrade() -> None:
    op.drop_constraint(
        op.f('ck_intake_applications_intake_application_kind_valid'),
        'intake_applications',
        type_='check',
    )
    op.drop_column('intake_applications', 'applicant_kind')
