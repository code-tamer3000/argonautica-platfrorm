"""add tasks

Revision ID: c4d5e6f7a8b9
Revises: a2b3c4d5e6f7
Create Date: 2026-07-06 10:00:00.000000

Раздел «Задачи»: задачи (общие/индивидуальные), назначения с жизненным циклом сдачи,
сдачи + их медиа, ревью-комментарии. Мягкое удаление задач/комментариев (deleted_at).
Плюс автоуправляемая привязка события календаря к дедлайну задачи (calendar_events.task_id).
Expand-only (п.8): только add — таблицы и nullable-колонка.
"""
from collections.abc import Sequence

import sqlalchemy as sa

from alembic import op

revision: str = "c4d5e6f7a8b9"
down_revision: str | None = "a2b3c4d5e6f7"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.create_table(
        "tasks",
        sa.Column("id", sa.BigInteger(), autoincrement=True, nullable=False),
        sa.Column("type", sa.Text(), nullable=False),
        sa.Column("title", sa.Text(), nullable=False),
        sa.Column("body", sa.Text(), nullable=True),
        sa.Column("kb_item_id", sa.BigInteger(), nullable=True),
        sa.Column("deadline_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("created_by", sa.BigInteger(), nullable=False),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("now()"),
            nullable=False,
        ),
        sa.Column("deleted_at", sa.DateTime(timezone=True), nullable=True),
        sa.CheckConstraint(
            "type IN ('common', 'individual')",
            name=op.f("ck_tasks_task_type_valid"),
        ),
        sa.ForeignKeyConstraint(
            ["kb_item_id"], ["kb_items.id"],
            name=op.f("fk_tasks_kb_item_id_kb_items"),
        ),
        sa.ForeignKeyConstraint(
            ["created_by"], ["users.id"],
            name=op.f("fk_tasks_created_by_users"),
        ),
        sa.PrimaryKeyConstraint("id", name=op.f("pk_tasks")),
    )

    op.create_table(
        "task_assignments",
        sa.Column("id", sa.BigInteger(), autoincrement=True, nullable=False),
        sa.Column("task_id", sa.BigInteger(), nullable=False),
        sa.Column("user_id", sa.BigInteger(), nullable=False),
        sa.Column(
            "status", sa.Text(), server_default=sa.text("'assigned'"), nullable=False
        ),
        sa.Column(
            "late", sa.Boolean(), server_default=sa.text("false"), nullable=False
        ),
        sa.Column("reviewed_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("now()"),
            nullable=False,
        ),
        sa.CheckConstraint(
            "status IN ('assigned', 'submitted', 'returned', 'accepted')",
            name=op.f("ck_task_assignments_task_assignment_status_valid"),
        ),
        sa.ForeignKeyConstraint(
            ["task_id"], ["tasks.id"],
            name=op.f("fk_task_assignments_task_id_tasks"),
        ),
        sa.ForeignKeyConstraint(
            ["user_id"], ["users.id"],
            name=op.f("fk_task_assignments_user_id_users"),
        ),
        sa.PrimaryKeyConstraint("id", name=op.f("pk_task_assignments")),
        sa.UniqueConstraint("task_id", "user_id", name="uq_task_assignment"),
    )
    op.create_index(
        "ix_task_assignments_user",
        "task_assignments",
        ["user_id"],
        unique=False,
    )

    op.create_table(
        "task_submissions",
        sa.Column("id", sa.BigInteger(), autoincrement=True, nullable=False),
        sa.Column("assignment_id", sa.BigInteger(), nullable=False),
        sa.Column("body", sa.Text(), nullable=True),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("now()"),
            nullable=False,
        ),
        sa.ForeignKeyConstraint(
            ["assignment_id"], ["task_assignments.id"],
            name=op.f("fk_task_submissions_assignment_id_task_assignments"),
        ),
        sa.PrimaryKeyConstraint("id", name=op.f("pk_task_submissions")),
    )
    op.create_index(
        "ix_task_submissions_assignment_created",
        "task_submissions",
        ["assignment_id", "created_at"],
        unique=False,
    )

    op.create_table(
        "task_submission_media",
        sa.Column("submission_id", sa.BigInteger(), nullable=False),
        sa.Column("media_asset_id", sa.BigInteger(), nullable=False),
        sa.ForeignKeyConstraint(
            ["submission_id"], ["task_submissions.id"],
            name=op.f("fk_task_submission_media_submission_id_task_submissions"),
        ),
        sa.ForeignKeyConstraint(
            ["media_asset_id"], ["media_assets.id"],
            name=op.f("fk_task_submission_media_media_asset_id_media_assets"),
        ),
        sa.PrimaryKeyConstraint(
            "submission_id", "media_asset_id",
            name=op.f("pk_task_submission_media"),
        ),
    )

    op.create_table(
        "task_comments",
        sa.Column("id", sa.BigInteger(), autoincrement=True, nullable=False),
        sa.Column("submission_id", sa.BigInteger(), nullable=False),
        sa.Column("author_id", sa.BigInteger(), nullable=False),
        sa.Column("body", sa.Text(), nullable=False),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("now()"),
            nullable=False,
        ),
        sa.Column("deleted_at", sa.DateTime(timezone=True), nullable=True),
        sa.ForeignKeyConstraint(
            ["submission_id"], ["task_submissions.id"],
            name=op.f("fk_task_comments_submission_id_task_submissions"),
        ),
        sa.ForeignKeyConstraint(
            ["author_id"], ["users.id"],
            name=op.f("fk_task_comments_author_id_users"),
        ),
        sa.PrimaryKeyConstraint("id", name=op.f("pk_task_comments")),
    )
    op.create_index(
        "ix_task_comments_submission_created",
        "task_comments",
        ["submission_id", "created_at"],
        unique=False,
    )

    # Автоуправляемая привязка события календаря к дедлайну задачи.
    op.add_column(
        "calendar_events",
        sa.Column("task_id", sa.BigInteger(), nullable=True),
    )
    op.create_foreign_key(
        op.f("fk_calendar_events_task_id_tasks"),
        "calendar_events",
        "tasks",
        ["task_id"],
        ["id"],
    )


def downgrade() -> None:
    op.drop_constraint(
        op.f("fk_calendar_events_task_id_tasks"),
        "calendar_events",
        type_="foreignkey",
    )
    op.drop_column("calendar_events", "task_id")

    op.drop_index(
        "ix_task_comments_submission_created", table_name="task_comments"
    )
    op.drop_table("task_comments")
    op.drop_table("task_submission_media")
    op.drop_index(
        "ix_task_submissions_assignment_created", table_name="task_submissions"
    )
    op.drop_table("task_submissions")
    op.drop_index("ix_task_assignments_user", table_name="task_assignments")
    op.drop_table("task_assignments")
    op.drop_table("tasks")
