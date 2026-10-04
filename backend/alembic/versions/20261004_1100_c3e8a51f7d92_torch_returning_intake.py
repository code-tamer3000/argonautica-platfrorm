"""torch_returning_intake

Revision ID: c3e8a51f7d92
Revises: a7c4e19b2d35
Create Date: 2026-10-04 11:00:00.000000

"""
from collections.abc import Sequence

import sqlalchemy as sa

from alembic import op

# revision identifiers, used by Alembic.
revision: str = 'c3e8a51f7d92'
down_revision: str | None = 'a7c4e19b2d35'
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    # expand-only: nullable/default-колонки, старый код их не знает и не ломается.
    op.add_column('intakes', sa.Column('graduation_popup_text', sa.Text(), nullable=True))
    op.add_column('intakes', sa.Column('torch_stub_text', sa.Text(), nullable=True))
    op.add_column('intakes', sa.Column('torch_kb_intake_id', sa.BigInteger(), nullable=True))
    op.create_foreign_key(
        op.f('fk_intakes_torch_kb_intake_id_intakes'),
        'intakes',
        'intakes',
        ['torch_kb_intake_id'],
        ['id'],
        ondelete='SET NULL',
    )
    op.add_column(
        'rooms',
        sa.Column('torch_autojoin', sa.Boolean(), server_default='false', nullable=False),
    )


def downgrade() -> None:
    op.drop_column('rooms', 'torch_autojoin')
    op.drop_constraint(
        op.f('fk_intakes_torch_kb_intake_id_intakes'), 'intakes', type_='foreignkey'
    )
    op.drop_column('intakes', 'torch_kb_intake_id')
    op.drop_column('intakes', 'torch_stub_text')
    op.drop_column('intakes', 'graduation_popup_text')
