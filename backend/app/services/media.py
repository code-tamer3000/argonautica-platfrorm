"""Работа с медиа в MinIO (S3-совместимо) через boto3.

Принцип (CLAUDE.md, п.7): байты не гоняем через FastAPI. Клиент льёт/качает файлы
напрямую в MinIO по короткоживущим presigned-URL, которые бэкенд выдаёт ПОСЛЕ
проверки прав. Бакеты приватные. Смена бэкенда хранения (MinIO -> managed-S3)
трогает только этот модуль.

`generate_presigned_url` — локальная операция (подпись), сети не требует, поэтому
синхронный boto3 здесь приемлем. URL подписываются под публичным endpoint —
браузеру нужен адрес, до которого он реально достучится (см. MINIO_PUBLIC_ENDPOINT).
"""
import mimetypes
from datetime import UTC, datetime
from functools import lru_cache
from uuid import uuid4

import boto3
from botocore.client import BaseClient, Config
from botocore.exceptions import ClientError
from fastapi import HTTPException, status
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import settings
from app.models.kb import KbItem, KbItemMedia
from app.models.media import MediaAsset
from app.models.message import Message, MessageAttachment
from app.models.user import User
from app.services.rooms import assert_room_access, load_room

# Presigned-URL должны указывать на публичный адрес MinIO (browser-facing).
PRESIGN_EXPIRES = 900  # 15 минут — короткоживущие ссылки
_PRESIGN_EXPIRES = PRESIGN_EXPIRES


def _build_client(endpoint: str) -> BaseClient:
    return boto3.client(
        "s3",
        endpoint_url=endpoint,
        aws_access_key_id=settings.minio_root_user,
        aws_secret_access_key=settings.minio_root_password,
        # s3v4 обязателен для MinIO presigned + поддержки range-запросов на GET.
        config=Config(signature_version="s3v4"),
        region_name="us-east-1",  # заглушка: MinIO не использует регион
    )


@lru_cache
def _presign_client() -> BaseClient:
    """Клиент для подписи URL — endpoint публичный (его увидит браузер)."""
    return _build_client(settings.minio_public_endpoint)


@lru_cache
def _server_client() -> BaseClient:
    """Клиент для server-side операций (ensure_buckets) — endpoint внутренний."""
    return _build_client(settings.minio_endpoint)


def presigned_put_url(
    bucket: str,
    key: str,
    content_type: str,
    expires: int = _PRESIGN_EXPIRES,
) -> str:
    """URL для прямой загрузки клиент->MinIO (PUT). Выдавать после проверки прав/типа/размера."""
    url: str = _presign_client().generate_presigned_url(
        ClientMethod="put_object",
        Params={"Bucket": bucket, "Key": key, "ContentType": content_type},
        ExpiresIn=expires,
    )
    return url


def presigned_get_url(
    bucket: str,
    key: str,
    expires: int = _PRESIGN_EXPIRES,
    download_name: str | None = None,
) -> str:
    """Короткоживущий URL для чтения (GET). MinIO поддерживает range-запросы (перемотка видео).

    `download_name` задаёт `Content-Disposition: attachment` — браузер СКАЧИВАЕТ файл
    (а не открывает инлайн). Кросс-доменный html-атрибут `download` игнорируется, поэтому
    скачивание форсим на стороне хранилища через подписанный response-параметр.
    """
    params: dict[str, str] = {"Bucket": bucket, "Key": key}
    if download_name is not None:
        params["ResponseContentDisposition"] = f'attachment; filename="{download_name}"'
    url: str = _presign_client().generate_presigned_url(
        ClientMethod="get_object",
        Params=params,
        ExpiresIn=expires,
    )
    return url


def ensure_buckets() -> None:
    """Идемпотентно создать приватные бакеты. Retry пока MinIO не станет доступен."""
    import time

    client = _server_client()
    for attempt in range(12):
        try:
            for bucket in (settings.minio_bucket_media, settings.minio_bucket_kb):
                try:
                    client.head_bucket(Bucket=bucket)
                except ClientError:
                    client.create_bucket(Bucket=bucket)
            return
        except Exception:
            if attempt == 11:
                raise
            time.sleep(5)


# Прогресс загрузки медиа на фронте тянет файл через `fetch` (нужен CORS на чтение
# тела и Content-Length). MinIO по умолчанию отдаёт `Access-Control-Allow-Origin: *`
# (env MINIO_API_CORS_ALLOW_ORIGIN, дефолт `*`), а Content-Length — CORS-safelisted,
# поэтому отдельная настройка бакета не нужна. Если origin в проде сузят — фронт мягко
# откатывается на прямой `<img src>` (см. useMediaProgress.failed).


def build_storage_key(content_type: str) -> str:
    """Серверный ключ объекта: `YYYY/MM/<uuid><ext>`. Имя клиента не используем (§6.4)."""
    now = datetime.now(UTC)
    ext = mimetypes.guess_extension(content_type) or ""
    return f"{now:%Y/%m}/{uuid4().hex}{ext}"


def stat_object(bucket: str, key: str) -> int | None:
    """Реальный размер объекта в MinIO (байты) или None, если объекта нет.

    Сетевой вызов (boto3 синхронный) — в эндпоинте оборачивать в run_in_threadpool.
    """
    try:
        head = _server_client().head_object(Bucket=bucket, Key=key)
    except ClientError:
        return None
    size: int = head["ContentLength"]
    return size


async def assert_media_access(
    session: AsyncSession, asset: MediaAsset, user: User
) -> None:
    """Доступ к чтению ассета (авторизация на каждом запросе, п.1).

    Разрешаем, если юзер его загрузил, либо ассет прикреплён к живому сообщению в
    комнате, к которой у юзера есть доступ, либо привязан к опубликованному
    материалу базы знаний (его медиа видит любой участник). Иначе — 403.
    """
    if asset.created_by == user.id:
        return

    # Медиа опубликованного материала базы знаний доступно любому участнику (§4.9).
    in_published_kb = await session.execute(
        select(KbItemMedia.kb_item_id)
        .join(KbItem, KbItem.id == KbItemMedia.kb_item_id)
        .where(
            KbItemMedia.media_asset_id == asset.id,
            KbItem.published.is_(True),
        )
        .limit(1)
    )
    if in_published_kb.first() is not None:
        return

    room_ids = (
        (
            await session.execute(
                select(Message.room_id)
                .join(
                    MessageAttachment, MessageAttachment.message_id == Message.id
                )
                .where(
                    MessageAttachment.media_asset_id == asset.id,
                    Message.deleted_at.is_(None),
                )
                .distinct()
            )
        )
        .scalars()
        .all()
    )
    for room_id in room_ids:
        try:
            room = await load_room(session, room_id)
            await assert_room_access(session, room, user)
            return
        except HTTPException:
            continue

    raise HTTPException(status.HTTP_403_FORBIDDEN, "No access to this media asset")


async def presign_asset_urls(
    session: AsyncSession, asset_ids: set[int]
) -> dict[int, str]:
    """`{asset_id: presigned-GET}` батчем для аватаров/стикеров.

    Подпись локальна (без сети) — N+1 по сети не создаёт. Картинки аватаров/стикеров
    видны любому активному участнику, поэтому подписываем без `assert_media_access`
    (вызывающие эндпоинты и так под аутентификацией).
    """
    if not asset_ids:
        return {}
    rows = await session.execute(
        select(MediaAsset.id, MediaAsset.bucket, MediaAsset.storage_key).where(
            MediaAsset.id.in_(asset_ids)
        )
    )
    return {
        asset_id: presigned_get_url(bucket, key)
        for asset_id, bucket, key in rows.all()
    }
