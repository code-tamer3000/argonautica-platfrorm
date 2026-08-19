"""offer_consent_and_task_display_name

Revision ID: cce2af239220
Revises: 8f3c1a9d5e21
Create Date: 2026-08-19 12:15:57.147210

"""
from collections.abc import Sequence

import sqlalchemy as sa

from alembic import op

# revision identifiers, used by Alembic.
revision: str = 'cce2af239220'
down_revision: str | None = '8f3c1a9d5e21'
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.add_column('intake_applications', sa.Column('offer_accepted_at', sa.DateTime(timezone=True), nullable=True))
    op.add_column('intake_applications', sa.Column('offer_version', sa.Text(), nullable=True))
    # Новый шаг воронки — согласие с офертой (ARG-43) между тарифом и чеком.
    # Autogenerate не видит CHECK-constraints, правим руками.
    op.drop_constraint('intake_application_status_valid', 'intake_applications', type_='check')
    op.create_check_constraint(
        'intake_application_status_valid',
        'intake_applications',
        "status IN ('awaiting_about', 'submitted', 'choosing_plan', "
        "'awaiting_offer', 'awaiting_receipt', 'payment_review', 'confirmed')",
    )
    op.add_column('tasks', sa.Column('sets_display_name', sa.Boolean(), server_default='false', nullable=False))


def downgrade() -> None:
    op.drop_column('tasks', 'sets_display_name')
    op.drop_constraint('intake_application_status_valid', 'intake_applications', type_='check')
    op.create_check_constraint(
        'intake_application_status_valid',
        'intake_applications',
        "status IN ('awaiting_about', 'submitted', 'choosing_plan', "
        "'awaiting_receipt', 'payment_review', 'confirmed')",
    )
    op.drop_column('intake_applications', 'offer_version')
    op.drop_column('intake_applications', 'offer_accepted_at')
