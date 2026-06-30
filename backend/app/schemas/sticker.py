"""Pydantic-схемы стикерпаков (§4.5). Картинки — media-ассеты (presigned на чтение)."""
from datetime import datetime

from pydantic import BaseModel, ConfigDict


class StickerpackCreate(BaseModel):
    name: str


class StickerCreate(BaseModel):
    image_media_id: int
    keyword: str | None = None
    sort_order: int = 0


class StickerOut(BaseModel):
    id: int
    pack_id: int
    image_url: str | None  # подписанный media-URL или legacy
    keyword: str | None
    sort_order: int


class StickerpackOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    name: str
    created_by: int
    created_at: datetime
    stickers: list[StickerOut] = []
