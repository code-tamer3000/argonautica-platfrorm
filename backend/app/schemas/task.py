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


class PairInput(BaseModel):
    """Одна пара при создании парного задания: ровно два разных участника."""

    user_ids: list[int] = Field(min_length=2, max_length=2)

    @model_validator(mode="after")
    def _distinct(self) -> "PairInput":
        if self.user_ids[0] == self.user_ids[1]:
            raise ValueError("A pair needs two distinct users")
        return self


class TaskCreate(BaseModel):
    """Создание задачи. Для individual `assignee_ids` обязателен непустой; для pair
    `pairs` обязателен непустой, каждый участник — максимум в одной паре (проверяется
    в эндпоинте, там же валидируется существование юзеров)."""

    type: Literal["common", "individual", "pair"]
    title: str
    body: str | None = None  # markdown
    kb_item_id: int | None = None
    deadline_at: datetime | None = None
    assignee_ids: list[int] = []
    # Пары для type='pair'. Организатор встречи выбирается сервером случайно.
    pairs: list[PairInput] = []
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
    pair_id: int | None = None  # set only on a cross-task (peer-learning)
    deadline_at: datetime | None
    created_by: int
    created_at: datetime
    attachments: list[AttachmentOut] = []


class PairMemberOut(BaseModel):
    """Один участник пары в глазах смотрящего + выданная им перекрёстная задача."""

    user_id: int
    is_meeting_organizer: bool
    # Перекрёстная задача, которую ЭТОТ участник выдал партнёру (если уже выдана).
    cross_task_id: int | None = None


class PairOut(BaseModel):
    """Пара для карточки парного задания. Участнику отдаётся только его пара;
    админу — любая. `viewer_user_id` — чьими глазами смотрим (для UI-разводки
    «моя задача» / «задача партнёра»); None у админа-неучастника."""

    pair_id: int
    members: list[PairMemberOut]
    meeting_at: datetime | None
    viewer_user_id: int | None
    can_manage_meeting: bool  # смотрящий — организатор встречи этой пары


class TaskWithStatusOut(TaskOut):
    """Задача с состоянием для текущего юзера и агрегатами прогресса."""

    my_status: str | None  # None — для common юзер ещё не взаимодействовал
    late: bool
    deadline_soon: bool
    assignee_count: int | None  # только individual, иначе None
    submitted_count: int
    accepted_count: int
    # Ждут проверки: сдано и ещё не отревьюено (статус 'submitted'). Для бейджа админа.
    unreviewed_count: int
    # Знаменатель прогресса «сдали X из Y»: individual → число адресатов;
    # common → число активных участников платформы (назначения ленивы).
    total_recipients: int
    # Только для type='pair': пара(ы) смотрящего. Участник видит одну свою пару;
    # админ — все пары задания. None/[] для обычных задач.
    pairs: list[PairOut] | None = None


class MeetingUpdate(BaseModel):
    """Назначить/перенести встречу (meeting_at) или отменить (null)."""

    meeting_at: datetime | None = None


class CrossTaskCreate(BaseModel):
    """Выдать задачу партнёру внутри пары. Получатель предопределён (партнёр).
    Полный набор полей обычной задачи; дедлайн опционален."""

    title: str
    body: str | None = None
    deadline_at: datetime | None = None
    media_asset_ids: list[int] = []


class CrossTaskUpdate(BaseModel):
    """Правка выданной перекрёстной задачи (пока нет сдач)."""

    model_config = ConfigDict(extra="forbid")

    title: str | None = None
    body: str | None = None
    deadline_at: datetime | None = None
    media_asset_ids: list[int] | None = None


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
