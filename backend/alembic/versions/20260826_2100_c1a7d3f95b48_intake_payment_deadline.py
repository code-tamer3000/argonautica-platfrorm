"""intake_payment_deadline

Revision ID: c1a7d3f95b48
Revises: b93a1ac79274
Create Date: 2026-08-26 21:00:00.000000

"""
from collections.abc import Sequence

import sqlalchemy as sa

from alembic import op

# revision identifiers, used by Alembic.
revision: str = 'c1a7d3f95b48'
down_revision: str | None = 'b93a1ac79274'
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    # Бронь места на 24 часа после «Принять» (ARG-108).
    op.add_column(
        'intake_applications',
        sa.Column('payment_deadline_at', sa.DateTime(timezone=True), nullable=True),
    )
    op.add_column(
        'intake_applications',
        sa.Column('expired_at', sa.DateTime(timezone=True), nullable=True),
    )
    # Новый терминальный статус «бронь сгорела». Расширение, не сужение: старый код
    # 'expired' не пишет, поэтому blue-green переживает это одним релизом.
    # Autogenerate не видит CHECK-constraints, правим руками.
    op.drop_constraint('intake_application_status_valid', 'intake_applications', type_='check')
    op.create_check_constraint(
        'intake_application_status_valid',
        'intake_applications',
        "status IN ('awaiting_about', 'submitted', 'choosing_plan', "
        "'awaiting_offer', 'awaiting_receipt', 'payment_review', 'confirmed', "
        "'expired')",
    )


def downgrade() -> None:
    # Сгоревшие заявки возвращаем на шаг «ждём решения админа» — иначе они не
    # проходят суженный CHECK.
    op.execute("UPDATE intake_applications SET status = 'submitted' WHERE status = 'expired'")
    op.drop_constraint('intake_application_status_valid', 'intake_applications', type_='check')
    op.create_check_constraint(
        'intake_application_status_valid',
        'intake_applications',
        "status IN ('awaiting_about', 'submitted', 'choosing_plan', "
        "'awaiting_offer', 'awaiting_receipt', 'payment_review', 'confirmed')",
    )
    op.drop_column('intake_applications', 'expired_at')
    op.drop_column('intake_applications', 'payment_deadline_at')
