"""Загрузка и чтение медиа через MinIO (presigned URL).

Поток (SPEC §3.4, CLAUDE.md п.7): клиент запрашивает presigned-PUT, льёт файл НАПРЯМУЮ
в MinIO (минуя FastAPI), затем подтверждает — тогда создаётся строка `media_assets`.
Намерение загрузки между шагами живёт в Redis (эфемерное состояние). Реальный размер
берём из MinIO, клиенту не доверяем (§6.4). Чтение — presigned-GET после проверки прав.
"""
import json
from time import perf_counter
from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, status
from fastapi.concurrency import run_in_threadpool
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.deps import get_current_active_user
from app.core.config import settings
from app.core.metrics import log_media_metric, record_step
from app.core.redis import redis_client
from app.db.session import after_commit, get_session
from app.models.media import MediaAsset
from app.models.user import User
from app.schemas.media import (
    ConfirmRequest,
    MediaAssetOut,
    MediaUrlOut,
    UploadRequest,
    UploadTicket,
)
from app.services.media import (
    PRESIGN_EXPIRES,
    PRESIGN_GET_EXPIRES,
    assert_media_access,
    build_storage_key,
    generate_image_thumbnail,
    presigned_get_url,
    presigned_put_url,
    serving_key,
    stat_object,
)
from app.services.ratelimit import enforce_rate_limit
from app.services.transcode_queue import enqueue as enqueue_transcode

router = APIRouter(prefix="/api/media", tags=["media"])

# Разрешённые типы по виду медиа (§6.4): имя/тип клиента не считаем доверенными.
_ALLOWED_FILE_MIME = {
    "application/pdf",
    "application/zip",
    "text/plain",
    # Markdown — используется читалкой глав в базе знаний (см. KB.md).
    # Разные ОС/браузеры отдают разный тип для .md, поэтому оба варианта.
    "text/markdown",
    "text/x-markdown",
    "application/msword",
    "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    "application/vnd.ms-excel",
    "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
}


def _validate_content_type(kind: str, content_type: str) -> None:
    ok = (
        (kind == "image" and content_type.startswith("image/"))
        or (kind == "video" and content_type.startswith("video/"))
        or (kind == "audio" and content_type.startswith("audio/"))
        or (kind == "file" and content_type in _ALLOWED_FILE_MIME)
    )
    if not ok:
        raise HTTPException(
            status.HTTP_400_BAD_REQUEST,
            f"content_type {content_type!r} not allowed for kind {kind!r}",
        )


def _max_bytes_for(kind: str) -> int:
    """Потолок размера по виду медиа: у голосовых свой низкий лимит (§6.4)."""
    if kind == "audio":
        return settings.media_max_audio_bytes
    return settings.media_max_upload_bytes


def _intent_key(storage_key: str) -> str:
    return f"media:upload:{storage_key}"


async def _consume_client_thumbnail(
    user_id: int, bucket: str, thumb_storage_key: str
) -> str | None:
    """Проверить и «съесть» постер видео, залитый клиентом отдельным объектом.

    Ключ постера обязан иметь живое намерение загрузки в Redis того же пользователя и
    вида `image` (клиент получал ticket через `/api/media/uploads`, kind=image) — иначе
    thumb_key можно было бы указать на чужой/произвольный объект. Проверяем факт объекта
    в MinIO и гасим намерение (постер не станет отдельным media_assets). None — если
    что-то не сходится: тогда видео просто останется без постера, не роняем подтверждение.
    """
    raw = await redis_client.get(_intent_key(thumb_storage_key))
    if raw is None:
        return None
    intent = json.loads(raw)
    if intent["user_id"] != user_id or intent["kind"] != "image":
        return None
    size = await run_in_threadpool(stat_object, bucket, thumb_storage_key)
    if size is None:
        return None
    await redis_client.delete(_intent_key(thumb_storage_key))
    return thumb_storage_key


@router.post("/uploads", response_model=UploadTicket)
async def request_upload(
    body: UploadRequest,
    current_user: Annotated[User, Depends(get_current_active_user)],
) -> UploadTicket:
    """Выдать presigned-PUT после проверки типа/размера; запомнить намерение в Redis."""
    await enforce_rate_limit(
        f"rl:upload:{current_user.id}", settings.rate_limit_upload_per_minute
    )
    _validate_content_type(body.kind, body.content_type)
    max_size = _max_bytes_for(body.kind)
    if body.size > max_size:
        raise HTTPException(
            status.HTTP_400_BAD_REQUEST,
            f"File too large (max {max_size} bytes)",
        )

    bucket = settings.minio_bucket_media
    storage_key = build_storage_key(body.content_type)
    intent = {
        "kind": body.kind,
        "mime_type": body.content_type,
        "max_size": max_size,
        "user_id": current_user.id,
    }
    await redis_client.set(
        _intent_key(storage_key), json.dumps(intent), ex=PRESIGN_EXPIRES
    )

    upload_url = presigned_put_url(bucket, storage_key, body.content_type)
    return UploadTicket(
        upload_url=upload_url,
        bucket=bucket,
        storage_key=storage_key,
        expires_in=PRESIGN_EXPIRES,
    )


@router.post("/assets", response_model=MediaAssetOut, status_code=201)
async def confirm_upload(
    body: ConfirmRequest,
    current_user: Annotated[User, Depends(get_current_active_user)],
    session: Annotated[AsyncSession, Depends(get_session)],
) -> MediaAsset:
    """Подтвердить загрузку: проверить факт/размер в MinIO и создать media_assets."""
    raw = await redis_client.get(_intent_key(body.storage_key))
    if raw is None:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "Unknown or expired upload")
    intent = json.loads(raw)
    if intent["user_id"] != current_user.id:
        raise HTTPException(status.HTTP_403_FORBIDDEN, "Not your upload")

    bucket = settings.minio_bucket_media
    # Тайминг: клиент ждёт confirm целиком, а внутри — сетевой head_object и (для
    # картинок) синхронная генерация превью. Меряем шаги отдельно, чтобы видеть,
    # что из них — узкое место «долгой отправки» (docs/FILES.md «Сбор метрик»).
    _t_stat = perf_counter()
    size = await run_in_threadpool(stat_object, bucket, body.storage_key)
    stat_ms = (perf_counter() - _t_stat) * 1000
    if size is None:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "Object not found in storage")
    if size > intent["max_size"]:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "Uploaded file exceeds limit")

    asset = MediaAsset(
        bucket=bucket,
        storage_key=body.storage_key,
        kind=intent["kind"],
        mime_type=intent["mime_type"],
        size=size,
        width=body.width,
        height=body.height,
        duration=body.duration,
        # Видео уходит в фоновый транскод (H.264 720p + faststart). Помечаем
        # 'processing' сразу: attachment-payload вернёт это состояние, клиент покажет
        # спиннер/постер, а по готовности воркер сменит на 'done' и пришлёт WS-событие.
        # Оригинал заливается как есть — никакого сжатия в браузере (docs/FILES.md).
        transcode_status="processing" if intent["kind"] == "video" else None,
        created_by=current_user.id,
    )
    session.add(asset)
    await session.flush()
    await session.refresh(asset)

    # Превью, чтобы лента отдавала лёгкий thumbnail, а не оригинал. Best-effort —
    # неудача превью не должна ронять подтверждение загрузки:
    #  - картинки: сервер сам тянет оригинал из MinIO и ужимает;
    #  - видео: постер-кадр снял клиент при загрузке и залил отдельным объектом,
    #    сервер лишь проверяет намерение и подхватывает его ключ (тянуть видео на
    #    бэкенд ради одного кадра дорого и против принципа «байты мимо FastAPI»).
    thumb_key: str | None = None
    thumb_ms = 0.0
    if asset.kind == "image":
        _t_thumb = perf_counter()
        thumb_key = await run_in_threadpool(
            generate_image_thumbnail, bucket, body.storage_key, intent["mime_type"]
        )
        thumb_ms = (perf_counter() - _t_thumb) * 1000
    elif asset.kind == "video" and body.thumb_storage_key:
        thumb_key = await _consume_client_thumbnail(
            current_user.id, bucket, body.thumb_storage_key
        )
    if thumb_key is not None:
        asset.thumb_key = thumb_key
        await session.flush()

    # Видео → фоновый транскод. Ставим в очередь ТОЛЬКО после успешного commit (иначе
    # воркер может забрать джобу до того, как строка появится в БД — «нашёл, а её нет»).
    # Клиентский постер (thumb_key выше) даёт мгновенное превью, пока вариант готовится.
    if asset.kind == "video":
        asset_id = asset.id
        after_commit(session, lambda: enqueue_transcode(asset_id))

    await redis_client.delete(_intent_key(body.storage_key))

    # Серверная разбивка confirm (best-effort, не роняет ответ): сколько заняли
    # head_object и генерация превью. Копим в те же агрегаты, source="server".
    log_media_metric(
        {
            "op": "upload",
            "kind": asset.kind,
            "source": "server",
            "size": size,
            "steps": {"stat_ms": round(stat_ms), "thumbnail_ms": round(thumb_ms)},
            "user_id": current_user.id,
        }
    )
    await record_step("upload", asset.kind, "server", "stat", stat_ms)
    if asset.kind == "image":
        await record_step("upload", asset.kind, "server", "thumbnail", thumb_ms)

    return asset


@router.get("/{asset_id}", response_model=MediaUrlOut)
async def get_media_url(
    asset_id: int,
    current_user: Annotated[User, Depends(get_current_active_user)],
    session: Annotated[AsyncSession, Depends(get_session)],
) -> MediaUrlOut:
    """Выдать presigned-GET после проверки прав (авторизация на каждом запросе, п.1)."""
    asset = await session.get(MediaAsset, asset_id)
    if asset is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Media asset not found")
    await assert_media_access(session, asset, current_user)

    # Файлы (pdf/doc/zip) — форсим скачивание; картинки/видео — инлайн (рендер в <img>/<video>).
    # Видео с готовым транскодом отдаём вариантом (H.264 720p faststart), иначе оригинал.
    download_name = asset.storage_key.rsplit("/", 1)[-1] if asset.kind == "file" else None
    url = presigned_get_url(asset.bucket, serving_key(asset), download_name=download_name)
    thumb_url = (
        presigned_get_url(asset.bucket, asset.thumb_key) if asset.thumb_key else None
    )
    return MediaUrlOut(
        url=url,
        expires_in=PRESIGN_GET_EXPIRES,
        kind=asset.kind,
        duration=asset.duration,
        width=asset.width,
        height=asset.height,
        thumb_url=thumb_url,
        transcode_status=asset.transcode_status,
    )
