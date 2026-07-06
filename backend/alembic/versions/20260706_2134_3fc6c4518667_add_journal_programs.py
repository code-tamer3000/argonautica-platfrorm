"""add journal programs

Revision ID: 3fc6c4518667
Revises: d5e6f7a8b9c0
Create Date: 2026-07-06 21:34:04.794522

Конфигурация структуры дневника: «задания» (journal_programs) с их разделами
(journal_sections). Задание = версия структуры с даты `starts_on`; активное для
дня — с максимальным `starts_on <= day`. Смена структуры не ломает историю.

Сид: задание #1 со starts_on = 2026-07-03 (текущий journal_program_start) и тремя
разделами focus/notes/film — в точности как захардкоженная структура до этой
миграции. Поэтому подсчёт прошлых дней не меняется. created_by = NULL (системное).

Expand-only (blue-green, п.8): только новые таблицы + сид, старый код их не трогает.
"""
from collections.abc import Sequence
from datetime import date

import sqlalchemy as sa

from alembic import op

# revision identifiers, used by Alembic.
revision: str = "3fc6c4518667"
down_revision: str | None = "d5e6f7a8b9c0"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.create_table(
        "journal_programs",
        sa.Column("id", sa.BigInteger(), autoincrement=True, nullable=False),
        sa.Column("starts_on", sa.Date(), nullable=False),
        sa.Column("title", sa.Text(), nullable=True),
        sa.Column("description", sa.Text(), nullable=True),
        sa.Column("created_by", sa.BigInteger(), nullable=True),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("now()"),
            nullable=False,
        ),
        sa.ForeignKeyConstraint(
            ["created_by"], ["users.id"],
            name=op.f("fk_journal_programs_created_by_users"),
        ),
        sa.PrimaryKeyConstraint("id", name=op.f("pk_journal_programs")),
        sa.UniqueConstraint("starts_on", name=op.f("uq_journal_programs_starts_on")),
    )
    op.create_table(
        "journal_sections",
        sa.Column("id", sa.BigInteger(), autoincrement=True, nullable=False),
        sa.Column("program_id", sa.BigInteger(), nullable=False),
        sa.Column("key", sa.Text(), nullable=False),
        sa.Column("position", sa.Integer(), nullable=False),
        sa.Column("emoji", sa.Text(), server_default="", nullable=False),
        sa.Column("label", sa.Text(), nullable=False),
        sa.Column("heading", sa.Text(), server_default="", nullable=False),
        sa.Column("placeholder", sa.Text(), server_default="", nullable=False),
        sa.Column("input_type", sa.Text(), server_default="text", nullable=False),
        sa.ForeignKeyConstraint(
            ["program_id"], ["journal_programs.id"],
            name=op.f("fk_journal_sections_program_id_journal_programs"),
            ondelete="CASCADE",
        ),
        sa.PrimaryKeyConstraint("id", name=op.f("pk_journal_sections")),
        sa.UniqueConstraint("program_id", "key", name="uq_journal_sections_program_key"),
        sa.UniqueConstraint(
            "program_id", "position", name="uq_journal_sections_program_position"
        ),
    )
    op.create_index(
        "ix_journal_sections_program_id", "journal_sections", ["program_id"]
    )

    _seed_program_one()


def _seed_program_one() -> None:
    """Задание #1 = прежняя захардкоженная структура (focus/notes/film)."""
    programs = sa.table(
        "journal_programs",
        sa.column("id", sa.BigInteger),
        sa.column("starts_on", sa.Date),
        sa.column("title", sa.Text),
        sa.column("description", sa.Text),
        sa.column("created_by", sa.BigInteger),
    )
    sections = sa.table(
        "journal_sections",
        sa.column("program_id", sa.BigInteger),
        sa.column("key", sa.Text),
        sa.column("position", sa.Integer),
        sa.column("emoji", sa.Text),
        sa.column("label", sa.Text),
        sa.column("heading", sa.Text),
        sa.column("placeholder", sa.Text),
        sa.column("input_type", sa.Text),
    )
    bind = op.get_bind()
    program_id = bind.execute(
        programs.insert()
        .values(
            starts_on=date(2026, 7, 3),
            title="Программа дневника",
            description=None,
            created_by=None,
        )
        .returning(programs.c.id)
    ).scalar_one()

    bind.execute(
        sections.insert(),
        [
            {
                "program_id": program_id,
                "key": "focus",
                "position": 0,
                "emoji": "🎯",
                "label": "Фокус на день",
                "heading": "## 🎯 Фокус на день",
                "placeholder": "Концентрация намерения на день",
                "input_type": "text",
            },
            {
                "program_id": program_id,
                "key": "notes",
                "position": 1,
                "emoji": "📝",
                "label": "Заметки",
                "heading": "## 📝 Заметки",
                "placeholder": "Процесс исследования",
                "input_type": "text",
            },
            {
                "program_id": program_id,
                "key": "film",
                "position": 2,
                "emoji": "🎬",
                "label": "Фильм дня",
                "heading": "",
                "placeholder": "Как бы ты назвал фильм про сегодняшний день?",
                "input_type": "title",
            },
        ],
    )


def downgrade() -> None:
    op.drop_index("ix_journal_sections_program_id", table_name="journal_sections")
    op.drop_table("journal_sections")
    op.drop_table("journal_programs")
