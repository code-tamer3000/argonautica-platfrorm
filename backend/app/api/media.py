"""Загрузка и чтение медиа через MinIO (presigned URL).

Поток (SPEC §3.4, CLAUDE.md п.7): клиент запрашивает presigned-PUT, льёт файл НАПРЯМУЮ
в MinIO (минуя FastAPI), затем подтверждает — тогда создаётся строка `media_assets`.
Намерение загрузки между шагами живёт в Redis (эфемерное состояние). Реальный размер
берём из MinIO, клиенту не доверяем (§6.4). Чтение — presigned-GET после проверки прав.
"""
import json
from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, status
from fastapi.concurrency import run_in_threadpool
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.deps import get_current_active_user
from app.core.config import settings
from app.core.redis import redis_client
from app.db.session import get_session
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
    assert_media_access,
    build_storage_key,
    presigned_get_url,
    presigned_put_url,
    stat_object,
)

router = APIRouter(prefix="/api/media", tags=["media"])

# Разрешённые типы по виду медиа (§6.4): имя/тип клиента не считаем доверенными.
_ALLOWED_FILE_MIME = {
    "application/pdf",
    "application/zip",
    "text/plain",
    "application/msword",
    "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    "application/vnd.ms-excel",
    "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
}


def _validate_content_type(kind: str, content_type: str) -> None:
    ok = (
        (kind == "image" and content_type.startswith("image/"))
        or (kind == "video" and content_type.startswith("video/"))
        or (kind == "file" and content_type in _ALLOWED_FILE_MIME)
    )
    if not ok:
        raise HTTPException(
            status.HTTP_400_BAD_REQUEST,
            f"content_type {content_type!r} not allowed for kind {kind!r}",
        )


def _intent_key(storage_key: str) -> str:
    return f"media:upload:{storage_key}"


@router.post("/uploads", response_model=UploadTicket)
async def request_upload(
    body: UploadRequest,
    current_user: Annotated[User, Depends(get_current_active_user)],
) -> UploadTicket:
    """Выдать presigned-PUT после проверки типа/размера; запомнить намерение в Redis."""
    _validate_content_type(body.kind, body.content_type)
    if body.size > settings.media_max_upload_bytes:
        raise HTTPException(
            status.HTTP_400_BAD_REQUEST,
            f"File too large (max {settings.media_max_upload_bytes} bytes)",
        )

    bucket = settings.minio_bucket_media
    storage_key = build_storage_key(body.content_type)
    intent = {
        "kind": body.kind,
        "mime_type": body.content_type,
        "max_size": settings.media_max_upload_bytes,
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
    size = await run_in_threadpool(stat_object, bucket, body.storage_key)
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
        created_by=current_user.id,
    )
    session.add(asset)
    await session.flush()
    await session.refresh(asset)
    await redis_client.delete(_intent_key(body.storage_key))
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

    url = presigned_get_url(asset.bucket, asset.storage_key)
    return MediaUrlOut(url=url, expires_in=PRESIGN_EXPIRES)
