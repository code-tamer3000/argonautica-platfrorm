"""Pydantic-схемы базы знаний (материалы + категории).

Категории — плоские (один уровень): у материала одна категория или её нет
(`category_id` = NULL → секция «Без категории»). Создаёт/правит категории только
admin. Файлы/видео загружаются обычным media-flow (`/api/media/...`) и линкуются к
материалу по `media_asset_id`.
"""
from datetime import datetime

from pydantic import BaseModel, ConfigDict, Field


class KbCategoryCreate(BaseModel):
    """Создание категории (admin)."""

    title: str = Field(min_length=1, max_length=200)
    sort_order: int = 0


class KbCategoryUpdate(BaseModel):
    """Частичное обновление категории: применяем только переданные поля."""

    model_config = ConfigDict(extra="forbid")

    title: str | None = Field(default=None, min_length=1, max_length=200)
    sort_order: int | None = None


class KbCategoryOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    title: str
    sort_order: int


class KbItemCreate(BaseModel):
    """Создание материала. По умолчанию черновик (`published=False`)."""

    title: str
    body: str | None = None  # markdown
    published: bool = False
    category_id: int | None = None
    media_asset_ids: list[int] = []


class KbItemUpdate(BaseModel):
    """Частичное обновление: применяем только переданные поля (exclude_unset)."""

    model_config = ConfigDict(extra="forbid")

    title: str | None = None
    body: str | None = None
    published: bool | None = None
    category_id: int | None = None
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


class KbCommentCreate(BaseModel):
    """Новый комментарий под материалом."""

    body: str = Field(min_length=1, max_length=4000)


class KbCommentOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    kb_item_id: int
    author_id: int
    body: str
    created_at: datetime
