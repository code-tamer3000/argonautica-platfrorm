"""add plans, users.plan_id, intake_applications (bot funnel state)

Revision ID: 51826f18440c
Revises: 535fcf72a060
Create Date: 2026-08-18 08:49:00

ARG-92: тарифы (`plans`) читает бот-воронка вместо хардкода; `users.plan_id` —
привязка участника к тарифу, по которому пришёл. `intake_applications` — состояние
воронки бота (анкета → тариф → чек → одобрение) в Postgres, не sqlite/Redis (ADR-013
касается только эфемерных данных).

Expand-only: обе новые FK-колонки nullable, старый код их не знает и не ломается.
"""
import sqlalchemy as sa

from alembic import op

revision = "51826f18440c"
down_revision = "535fcf72a060"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "plans",
        sa.Column("id", sa.BigInteger(), nullable=False),
        sa.Column("name", sa.Text(), nullable=False),
        sa.Column("price", sa.Integer(), nullable=False),
        sa.Column("description", sa.Text(), nullable=False, server_default=""),
        sa.Column(
            "is_active", sa.Boolean(), nullable=False, server_default=sa.text("true")
        ),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            nullable=False,
            server_default=sa.text("now()"),
        ),
        sa.Column(
            "updated_at",
            sa.DateTime(timezone=True),
            nullable=False,
            server_default=sa.text("now()"),
        ),
        sa.PrimaryKeyConstraint("id"),
    )

    op.add_column("users", sa.Column("plan_id", sa.BigInteger(), nullable=True))
    op.create_foreign_key(
        "users_plan_id_fkey", "users", "plans", ["plan_id"], ["id"]
    )

    op.create_table(
        "intake_applications",
        sa.Column("id", sa.BigInteger(), nullable=False),
        sa.Column("tg_id", sa.BigInteger(), nullable=False),
        sa.Column("tg_username", sa.Text(), nullable=True),
        sa.Column("tg_first_name", sa.Text(), nullable=True),
        sa.Column("tg_last_name", sa.Text(), nullable=True),
        sa.Column(
            "status",
            sa.Text(),
            nullable=False,
            server_default="awaiting_about",
        ),
        sa.Column("about", sa.Text(), nullable=True),
        sa.Column("plan_id", sa.BigInteger(), nullable=True),
        sa.Column("receipt_file_id", sa.Text(), nullable=True),
        sa.Column("receipt_kind", sa.Text(), nullable=True),
        sa.Column("user_id", sa.BigInteger(), nullable=True),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            nullable=False,
            server_default=sa.text("now()"),
        ),
        sa.Column(
            "updated_at",
            sa.DateTime(timezone=True),
            nullable=False,
            server_default=sa.text("now()"),
        ),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("tg_id"),
        sa.CheckConstraint(
            "status IN ('awaiting_about', 'submitted', 'choosing_plan', "
            "'awaiting_receipt', 'payment_review', 'confirmed')",
            name="intake_application_status_valid",
        ),
        sa.ForeignKeyConstraint(["plan_id"], ["plans.id"]),
        sa.ForeignKeyConstraint(["user_id"], ["users.id"]),
    )


def downgrade() -> None:
    op.drop_table("intake_applications")
    op.drop_constraint("users_plan_id_fkey", "users", type_="foreignkey")
    op.drop_column("users", "plan_id")
    op.drop_table("plans")
