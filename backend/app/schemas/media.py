"""Pydantic-схемы загрузки/чтения медиа.

Поток (SPEC §3.4): UploadRequest → UploadTicket (presigned-PUT, клиент льёт в MinIO)
→ ConfirmRequest → MediaAssetOut (создана строка media_assets). Чтение —
MediaUrlOut (presigned-GET после проверки прав).
"""
from datetime import datetime
from typing import Literal

from pydantic import BaseModel, ConfigDict, Field, model_validator

MediaKind = Literal["image", "video", "file", "audio"]

# Плейлист — вложение из нескольких аудиотреков (docs/FILES.md «Плейлист»). Лимит —
# деталь реализации (Assumptions в ARG-139), не заявлена продуктом отдельно.
MAX_PLAYLIST_TRACKS = 30


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


class PlaylistTrackInput(BaseModel):
    """Один трек при создании плейлиста. `media_asset_id` — уже загруженный
    kind='audio' ассет (обычный upload-flow, POST /api/media/uploads + /assets).
    `title`/`artist`/`duration` — распознанное из ID3-тегов на клиенте, с фолбэком
    на имя файла; автор может поправить перед отправкой (docs/FILES.md «Плейлист»).
    """

    media_asset_id: int
    title: str = Field(min_length=1, max_length=300)
    artist: str | None = Field(default=None, max_length=300)
    duration: int | None = Field(default=None, ge=0)


class PlaylistCreateRequest(BaseModel):
    """Создание плейлиста. Порядок `tracks` = порядок воспроизведения (позиция в
    списке = порядок прикрепления, без drag&drop — см. Границы ARG-139). Плейлист
    не имеет собственного ACL: права читаются через носителя, к которому он будет
    прикреплён следующим запросом (сообщение / задача / материал КБ)."""

    title: str = Field(min_length=1, max_length=300)
    cover_media_id: int | None = None
    tracks: list[PlaylistTrackInput]

    @model_validator(mode="after")
    def _validate(self) -> "PlaylistCreateRequest":
        if not self.tracks:
            raise ValueError("A playlist needs at least one track")
        if len(self.tracks) > MAX_PLAYLIST_TRACKS:
            raise ValueError(f"At most {MAX_PLAYLIST_TRACKS} tracks per playlist")
        return self


class PlaylistTrackOut(BaseModel):
    """Трек с готовым presigned-URL — как AttachmentOut, но со своими метаданными."""

    # id самой playlist_tracks-строки (НЕ media_asset_id) — нужен, чтобы убрать
    # именно этот трек через DELETE .../tracks/{track_id} (ARG-139).
    id: int
    asset_id: int
    position: int
    title: str
    artist: str | None
    duration: int | None
    url: str
    mime_type: str
    size: int


class PlaylistOut(BaseModel):
    """Плейлист-вложение с уже готовыми presigned-URL всех треков и обложки.

    Как AttachmentOut, встраивается прямо в payload сообщения/задачи/материала —
    без отдельного round-trip. Неизменяем после отправки (docs/FILES.md «Плейлист»).
    """

    id: int
    title: str
    cover_url: str | None = None
    created_by: int
    created_at: datetime
    tracks: list[PlaylistTrackOut]


class PlaylistRenameRequest(BaseModel):
    """Переименование плейлиста — единственная правка после отправки, доступная
    автору (ARG-139, отзыв после ревью). Состав/порядок треков неизменны."""

    title: str = Field(min_length=1, max_length=300)
