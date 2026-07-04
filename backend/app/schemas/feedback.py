"""Pydantic-схемы раздела «Поддержка»."""
from datetime import datetime
from typing import Literal

from pydantic import BaseModel, Field

FeedbackKind = Literal["improvement", "bug"]


class FeedbackCreate(BaseModel):
    """Обращение от пользователя: тип + текст."""

    kind: FeedbackKind
    body: str = Field(min_length=1, max_length=4000)


class FeedbackOut(BaseModel):
    """Обращение для админской ленты. user_name кладём сразу — список без догрузки."""

    id: int
    kind: FeedbackKind
    body: str
    user_id: int
    user_name: str | None
    created_at: datetime
    resolved_at: datetime | None


class FeedbackListOut(BaseModel):
    items: list[FeedbackOut]
    unresolved_count: int


class FeedbackResolveRequest(BaseModel):
    """Отметить разобранным (resolved=True) или вернуть в работу (False)."""

    resolved: bool
