"""Pydantic-схемы раздела «Задачи».

Задача общая (`type='common'`) или индивидуальная (`type='individual'`, адресована
конкретным юзерам). Сдачи несут текст и/или медиа-вложения (обычный media-flow,
линкуются по media_asset_id). Ревью админа принимает/возвращает сдачу; возврат
обязательно с комментарием. Тип и состав адресатов в MVP неизменяемы после создания.
"""
from datetime import datetime
from typing import Literal

from pydantic import BaseModel, ConfigDict, Field, model_validator

from app.schemas.media import AttachmentOut


class TaskCreate(BaseModel):
    """Создание задачи. Для individual `assignee_ids` обязателен непустой
    (проверяется в эндпоинте — там же валидируется существование юзеров)."""

    type: Literal["common", "individual"]
    title: str
    body: str | None = None  # markdown
    kb_item_id: int | None = None
    deadline_at: datetime | None = None
    assignee_ids: list[int] = []
    # Медиа условия задачи (создаёт admin). Ассеты должны существовать.
    media_asset_ids: list[int] = []


class TaskUpdate(BaseModel):
    """Частичное обновление: применяем только переданные поля (exclude_unset).
    Тип и адресаты в MVP неизменяемы."""

    model_config = ConfigDict(extra="forbid")

    title: str | None = None
    body: str | None = None
    deadline_at: datetime | None = None
    kb_item_id: int | None = None
    # None — не трогаем набор медиа; список — ЗАМЕНЯЕТ весь набор целиком.
    media_asset_ids: list[int] | None = None


class TaskOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    type: str
    title: str
    body: str | None
    kb_item_id: int | None
    deadline_at: datetime | None
    created_by: int
    created_at: datetime
    attachments: list[AttachmentOut] = []


class TaskWithStatusOut(TaskOut):
    """Задача с состоянием для текущего юзера и агрегатами прогресса."""

    my_status: str | None  # None — для common юзер ещё не взаимодействовал
    late: bool
    deadline_soon: bool
    assignee_count: int | None  # только individual, иначе None
    submitted_count: int
    accepted_count: int


class ProgressOut(BaseModel):
    done: int
    total: int


class TaskListOut(BaseModel):
    items: list[TaskWithStatusOut]
    progress: ProgressOut
    attention_count: int


class SubmissionCreate(BaseModel):
    """Сдача задачи: текст и/или вложения (хоть что-то, как у сообщения)."""

    body: str | None = None
    attachment_ids: list[int] = []

    @model_validator(mode="after")
    def _must_carry_something(self) -> "SubmissionCreate":
        has_text = bool(self.body and self.body.strip())
        if not (has_text or self.attachment_ids):
            raise ValueError("Submission must carry text or attachments")
        return self


class SubmissionOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    assignment_id: int
    user_id: int
    body: str | None
    created_at: datetime
    attachments: list[AttachmentOut] = []


class TaskTrackOut(BaseModel):
    """Трек одного назначения: статус + все его сдачи (для экрана сдач)."""

    assignment_id: int
    user_id: int
    status: str
    late: bool
    reviewed_at: datetime | None
    submissions: list[SubmissionOut]


class ReviewRequest(BaseModel):
    """Ревью сдачи: принять или вернуть. Возврат — обязательно с комментарием."""

    action: Literal["accept", "return"]
    comment: str | None = None

    @model_validator(mode="after")
    def _return_requires_comment(self) -> "ReviewRequest":
        if self.action == "return" and not (self.comment and self.comment.strip()):
            raise ValueError("A comment is required when returning a submission")
        return self


class TaskCommentCreate(BaseModel):
    body: str = Field(min_length=1, max_length=4000)


class TaskCommentOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    submission_id: int
    author_id: int
    body: str
    created_at: datetime


class AdminAssignmentOut(BaseModel):
    """Строка админского экрана прогресса задачи."""

    assignment_id: int
    user_id: int
    status: str
    late: bool
    reviewed_at: datetime | None
    submission_count: int
