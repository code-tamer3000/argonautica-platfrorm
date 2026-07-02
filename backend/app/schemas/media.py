"""Pydantic-схемы загрузки/чтения медиа.

Поток (SPEC §3.4): UploadRequest → UploadTicket (presigned-PUT, клиент льёт в MinIO)
→ ConfirmRequest → MediaAssetOut (создана строка media_assets). Чтение —
MediaUrlOut (presigned-GET после проверки прав).
"""
from datetime import datetime
from typing import Literal

from pydantic import BaseModel, ConfigDict, Field

MediaKind = Literal["image", "video", "file", "audio"]


class UploadRequest(BaseModel):
    content_type: str
    size: int = Field(gt=0)
    kind: MediaKind


class UploadTicket(BaseModel):
    upload_url: str
    bucket: str
    storage_key: str
    expires_in: int


class ConfirmRequest(BaseModel):
    storage_key: str
    width: int | None = None
    height: int | None = None
    duration: int | None = None


class MediaAssetOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    bucket: str
    storage_key: str
    kind: str
    mime_type: str
    size: int
    width: int | None
    height: int | None
    duration: int | None
    created_at: datetime


class MediaUrlOut(BaseModel):
    url: str
    expires_in: int
    # Авторитетный вид медиа из media_assets — клиент не гадает по расширению URL
    # (webm/ogg неоднозначны между audio и video).
    kind: MediaKind
    duration: int | None = None
