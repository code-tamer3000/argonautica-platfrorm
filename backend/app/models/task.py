"""Задачи (SPEC: раздел «Задачи»): общие/индивидуальные + сдачи, комментарии, ревью.

Задача либо общая (`type='common'` — видна всем активным участникам, каждый может
сдать), либо индивидуальная (`type='individual'` — адресована конкретным юзерам через
`task_assignments`). Сдачи (`task_submissions`) несут текст и медиа-вложения (через
общую `media_assets`). Ревью админа меняет статус назначения; при возврате пишется
комментарий на последнюю сдачу. Мягкое удаление задач/комментариев (deleted_at, п.6).
Дедлайн-события синхронизируются в `calendar_events` (см. services/tasks.py).
"""
from datetime import datetime

from sqlalchemy import (
    BigInteger,
    Boolean,
    CheckConstraint,
    DateTime,
    ForeignKey,
    Index,
    Text,
    UniqueConstraint,
    func,
)
from sqlalchemy.orm import Mapped, mapped_column

from app.db.base import Base


class Task(Base):
    """Задача автора. `type` различает общую и индивидуальную (поведение — в коде)."""

    __tablename__ = "tasks"
    __table_args__ = (
        CheckConstraint(
            "type IN ('common', 'individual')", name="task_type_valid"
        ),
    )

    id: Mapped[int] = mapped_column(BigInteger, primary_key=True, autoincrement=True)
    type: Mapped[str] = mapped_column(Text, nullable=False)
    title: Mapped[str] = mapped_column(Text, nullable=False)
    body: Mapped[str | None] = mapped_column(Text)  # markdown
    # Опциональная привязка к материалу базы знаний.
    kb_item_id: Mapped[int | None] = mapped_column(
        BigInteger, ForeignKey("kb_items.id")
    )
    deadline_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    created_by: Mapped[int] = mapped_column(
        BigInteger, ForeignKey("users.id"), nullable=False
    )
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, server_default=func.now()
    )
    deleted_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))  # мягкое удаление


class TaskAssignment(Base):
    """Назначение задачи юзеру + жизненный цикл сдачи.

    Для индивидуальных задач строки создаём при создании задачи. Для общих —
    лениво при первой сдаче (вариант «неявного доступа», как каналы, п.3).
    """

    __tablename__ = "task_assignments"
    __table_args__ = (
        CheckConstraint(
            "status IN ('assigned', 'submitted', 'returned', 'accepted')",
            name="task_assignment_status_valid",
        ),
        UniqueConstraint("task_id", "user_id", name="uq_task_assignment"),
        Index("ix_task_assignments_user", "user_id"),
    )

    id: Mapped[int] = mapped_column(BigInteger, primary_key=True, autoincrement=True)
    task_id: Mapped[int] = mapped_column(
        BigInteger, ForeignKey("tasks.id"), nullable=False
    )
    user_id: Mapped[int] = mapped_column(
        BigInteger, ForeignKey("users.id"), nullable=False
    )
    status: Mapped[str] = mapped_column(
        Text, nullable=False, server_default="assigned"
    )
    # Сдано после дедлайна (проставляется на первой сдаче).
    late: Mapped[bool] = mapped_column(
        Boolean, nullable=False, server_default="false"
    )
    reviewed_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, server_default=func.now()
    )


class TaskSubmission(Base):
    """Одна сдача по назначению. История сдач сохраняется (возврат → новая сдача)."""

    __tablename__ = "task_submissions"
    __table_args__ = (
        Index(
            "ix_task_submissions_assignment_created",
            "assignment_id",
            "created_at",
        ),
    )

    id: Mapped[int] = mapped_column(BigInteger, primary_key=True, autoincrement=True)
    assignment_id: Mapped[int] = mapped_column(
        BigInteger, ForeignKey("task_assignments.id"), nullable=False
    )
    body: Mapped[str | None] = mapped_column(Text)  # markdown
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, server_default=func.now()
    )


class TaskSubmissionMedia(Base):
    """Связь сдачи с файлами/видео (через общую media_assets)."""

    __tablename__ = "task_submission_media"

    submission_id: Mapped[int] = mapped_column(
        BigInteger, ForeignKey("task_submissions.id"), primary_key=True
    )
    media_asset_id: Mapped[int] = mapped_column(
        BigInteger, ForeignKey("media_assets.id"), primary_key=True
    )


class TaskComment(Base):
    """Плоские комментарии под сдачей (ревью-фидбек). Мягкое удаление (п.6)."""

    __tablename__ = "task_comments"
    __table_args__ = (
        Index(
            "ix_task_comments_submission_created",
            "submission_id",
            "created_at",
        ),
    )

    id: Mapped[int] = mapped_column(BigInteger, primary_key=True, autoincrement=True)
    submission_id: Mapped[int] = mapped_column(
        BigInteger, ForeignKey("task_submissions.id"), nullable=False
    )
    author_id: Mapped[int] = mapped_column(
        BigInteger, ForeignKey("users.id"), nullable=False
    )
    body: Mapped[str] = mapped_column(Text, nullable=False)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, server_default=func.now()
    )
    deleted_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
