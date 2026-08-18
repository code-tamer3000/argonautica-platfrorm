"""add intakes + users.intake_id, backfill historical intake

Revision ID: 535fcf72a060
Revises: b7f2a1c9d4e3
Create Date: 2026-08-17 15:00:00

Сущность-носитель даты старта 28-дневного окна Динамики (когорта). Первый набор
получает starts_on = 2026-06-02 — фактическая дата старта первого набора,
уточнённая с пользователем 2026-08-17 (расходится с устаревшей константой
settings.journal_program_start = 2026-07-03). Все существующие пользователи
бэкфиллятся на этот набор.

Expand-only: users.intake_id nullable, старый код колонку не знает и не ломается.
"""
import sqlalchemy as sa

from alembic import op

revision = "535fcf72a060"
down_revision = "b7f2a1c9d4e3"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "intakes",
        sa.Column("id", sa.BigInteger(), nullable=False),
        sa.Column("starts_on", sa.Date(), nullable=False),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            nullable=False,
            server_default=sa.text("now()"),
        ),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("starts_on"),
    )
    op.add_column(
        "users",
        sa.Column("intake_id", sa.BigInteger(), nullable=True),
    )
    op.create_foreign_key(
        "users_intake_id_fkey", "users", "intakes", ["intake_id"], ["id"]
    )

    op.execute(
        """
        INSERT INTO intakes (starts_on) VALUES ('2026-06-02')
        """
    )
    op.execute(
        """
        UPDATE users
        SET intake_id = (SELECT id FROM intakes WHERE starts_on = '2026-06-02')
        WHERE intake_id IS NULL
        """
    )


def downgrade() -> None:
    op.drop_constraint("users_intake_id_fkey", "users", type_="foreignkey")
    op.drop_column("users", "intake_id")
    op.drop_table("intakes")
