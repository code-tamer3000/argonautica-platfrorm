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
    # Ключ постера видео: клиент сам снял кадр при загрузке и залил отдельным
    # объектом (тянуть видеофайл на бэкенд ради кадра дорого). Сервер лишь проверит
    # намерение загрузки и подхватит ключ как thumb_key. Для картинок не используется
    # (их превью генерит сам сервер).
    thumb_storage_key: str | None = None


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
    # Размеры (для video/image) — чтобы плеер зарезервировал коробку с верным
    # aspect-ratio ещё до загрузки медиа (без чёрного прямоугольника и скачка рамок).
    width: int | None = None
    height: int | None = None
    # Presigned-GET уменьшенного превью (картинки). None — превью нет, грузим оригинал.
    thumb_url: str | None = None
    # Средний дериват картинки для лайтбокса (см. AttachmentOut.preview_url). Нужен и
    # здесь: KB-вложения резолвятся через этот эндпоинт, а не через payload сообщения,
    # и без поля тот путь молча тянул бы оригинал.
    preview_url: str | None = None
    # Состояние серверного транскода видео (см. AttachmentOut). None — не видео/легаси.
    transcode_status: str | None = None


class AttachmentOut(BaseModel):
    """Вложение с уже готовыми presigned-URL — встраивается прямо в payload сообщения.

    Убирает per-attachment round-trip `GET /api/media/{id}`: клиент, получив ленту,
    сразу знает адреса медиа. Доступ уже проверен на уровне комнаты (кто видит
    сообщение — видит его вложения), поэтому отдельная проверка на ассет не нужна.
    """

    asset_id: int
    url: str  # presigned-GET отдаваемого объекта: у видео — вариант (если готов),
    # у остального — оригинал. Для видео это же лайтбокс/скачивание.
    thumb_url: str | None = None  # presigned-GET превью (лента); None — грузить оригинал
    # presigned-GET среднего WebP-деривата (≤1600px) — то, что открывает лайтбокс
    # вместо тяжёлого оригинала. Только у kind='image'; у остального None. None также
    # у легаси-строк, при неудачной генерации и когда дериват вышел не легче исходника.
    # Клиент показывает `preview_url ?? url`; для скачивания всегда берёт `url`.
    preview_url: str | None = None
    kind: MediaKind
    mime_type: str
    size: int
    width: int | None = None
    height: int | None = None
    duration: int | None = None
    # Состояние серверного транскода видео (docs/FILES.md, docs/MESSAGES.md). Только у
    # kind='video'; у остального None. None у видео = легаси/транскод неприменим —
    # клиент отдаёт как раньше (по url). 'processing' — вариант готовится (спиннер +
    # thumb_url-постер, url ведёт на оригинал как фолбэк); 'done' — url = вариант;
    # 'failed' — вариант не собрался, url = оригинал, клиент рисует «обработка не удалась».
    transcode_status: str | None = None
