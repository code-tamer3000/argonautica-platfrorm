"""Pydantic-схемы базы знаний (материалы).

Категории — вне MVP (DECISIONS.md), материалы плоские (`category_id` = NULL).
Файлы/видео загружаются обычным media-flow (`/api/media/...`) и линкуются к
материалу по `media_asset_id`.
"""
from datetime import datetime

from pydantic import BaseModel, ConfigDict


class KbItemCreate(BaseModel):
    """Создание материала. По умолчанию черновик (`published=False`)."""

    title: str
    body: str | None = None  # markdown
    published: bool = False
    media_asset_ids: list[int] = []


class KbItemUpdate(BaseModel):
    """Частичное обновление: применяем только переданные поля (exclude_unset)."""

    model_config = ConfigDict(extra="forbid")

    title: str | None = None
    body: str | None = None
    published: bool | None = None
    sort_order: int | None = None


class KbItemOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    category_id: int | None
    title: str
    body: str | None
    published: bool
    created_by: int
    sort_order: int
    created_at: datetime
    updated_at: datetime
    media_asset_ids: list[int] = []


class AttachMediaRequest(BaseModel):
    media_asset_ids: list[int]
