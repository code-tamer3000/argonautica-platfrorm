"""Pydantic-схемы FAQ раздела «Поддержка»."""
from datetime import datetime

from pydantic import BaseModel, ConfigDict, Field


class FaqItemCreate(BaseModel):
    """Новая запись FAQ (создаёт админ)."""

    question: str = Field(min_length=1, max_length=500)
    answer: str = Field(min_length=1, max_length=8000)
    sort_order: int = 0


class FaqItemUpdate(BaseModel):
    """Частичное обновление записи FAQ."""

    model_config = ConfigDict(extra="forbid")

    question: str | None = Field(default=None, min_length=1, max_length=500)
    answer: str | None = Field(default=None, min_length=1, max_length=8000)
    sort_order: int | None = None


class FaqItemOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    question: str
    answer: str
    sort_order: int
    created_at: datetime
    updated_at: datetime
