"""add task media

Revision ID: d5e6f7a8b9c0
Revises: c4d5e6f7a8b9
Create Date: 2026-07-06 12:00:00.000000

Медиа самого условия задачи: связь tasks↔media_assets (описание задачи может нести
фото/видео/аудио/файлы, создаёт/правит admin). Зеркало task_submission_media.
Expand-only (п.8): только add — одна связочная таблица.
"""
from collections.abc import Sequence

import sqlalchemy as sa

from alembic import op

revision: str = "d5e6f7a8b9c0"
down_revision: str | None = "c4d5e6f7a8b9"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.create_table(
        "task_media",
        sa.Column("task_id", sa.BigInteger(), nullable=False),
        sa.Column("media_asset_id", sa.BigInteger(), nullable=False),
        sa.ForeignKeyConstraint(
            ["task_id"], ["tasks.id"],
            name=op.f("fk_task_media_task_id_tasks"),
        ),
        sa.ForeignKeyConstraint(
            ["media_asset_id"], ["media_assets.id"],
            name=op.f("fk_task_media_media_asset_id_media_assets"),
        ),
        sa.PrimaryKeyConstraint(
            "task_id", "media_asset_id",
            name=op.f("pk_task_media"),
        ),
    )


def downgrade() -> None:
    op.drop_table("task_media")
