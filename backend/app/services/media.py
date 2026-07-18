"""Работа с медиа в MinIO (S3-совместимо) через boto3.

Принцип (CLAUDE.md, п.7): байты не гоняем через FastAPI. Клиент льёт/качает файлы
напрямую в MinIO по короткоживущим presigned-URL, которые бэкенд выдаёт ПОСЛЕ
проверки прав. Бакеты приватные. Смена бэкенда хранения (MinIO -> managed-S3)
трогает только этот модуль.

`generate_presigned_url` — локальная операция (подпись), сети не требует, поэтому
синхронный boto3 здесь приемлем. URL подписываются под публичным endpoint —
браузеру нужен адрес, до которого он реально достучится (см. MINIO_PUBLIC_ENDPOINT).
"""
import logging
import mimetypes
from datetime import UTC, datetime
from functools import lru_cache
from io import BytesIO
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
from app.schemas.media import AttachmentOut
from app.services.rooms import assert_room_access, load_room

logger = logging.getLogger(__name__)

# Presigned-URL для ЗАГРУЗКИ (PUT). Час, а не минуты: на медленном мобильном аплинке
# (~3–6 Mbps) крупное видео льётся дольше 15 мин, и подпись протухала ПРЯМО ВО ВРЕМЯ
# заливки — MinIO отвечал 400, отправитель терял и файл, и время (метрики прода: PUT
# на 164с/614с/2351с → 400). Тем же числом живёт Redis-намерение (иначе confirm после
# долгой заливки упрётся в «Unknown or expired upload»), поэтому значение общее. Час
# укладывается в лимит SigV4 (до 7 дней) и не даёт намерениям копиться в Redis.
PRESIGN_EXPIRES = 3600  # 60 минут
_PRESIGN_EXPIRES = PRESIGN_EXPIRES
# Presigned-URL для ЧТЕНИЯ (GET) — длинные: одинаковая подпись в пределах жизни ссылки
# = стабильный URL = браузер реально кэширует байты (Cache-Control на nginx). Для ~20
# доверенных участников суточная ссылка приемлема (SigV4 позволяет до 7 дней).
PRESIGN_GET_EXPIRES = 86_400  # 24 часа

# Превью: даунскейл до квадрата THUMB_MAX_PX по длинной стороне, WebP. Хватает для
# ленты и лайтбокса-заглушки; оригинал грузится только по клику.
THUMB_MAX_PX = 1024
THUMB_PREFIX = "thumbnails/"


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
    expires: int = PRESIGN_GET_EXPIRES,
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


def build_thumb_key(storage_key: str) -> str:
    """Ключ превью в том же бакете: `thumbnails/<storage_key>.webp`."""
    return f"{THUMB_PREFIX}{storage_key}.webp"


def _encode_webp_thumbnail(raw: bytes) -> bytes:
    """Ужать байты картинки до квадрата THUMB_MAX_PX и вернуть WebP-байты.

    Общий кодек для превью картинок и постеров видео (тот же формат/размер = одинаковая
    лёгкость в ленте). Учитывает поворот из EXIF и приводит режим к RGB/RGBA.
    """
    from PIL import Image, ImageOps  # локальный импорт: Pillow нужен только тут

    with Image.open(BytesIO(raw)) as src:
        img = ImageOps.exif_transpose(src) or src  # учесть поворот из EXIF
        img = img.convert("RGBA" if img.mode in ("RGBA", "LA", "P") else "RGB")
        img.thumbnail((THUMB_MAX_PX, THUMB_MAX_PX))
        buf = BytesIO()
        img.save(buf, format="WEBP", quality=80, method=4)
    return buf.getvalue()


def generate_image_thumbnail(bucket: str, key: str, mime_type: str) -> str | None:
    """Best-effort превью картинки: тянем оригинал из MinIO, ужимаем, кладём рядом.

    Возвращает ключ превью или None при любой ошибке — генерация превью НЕ должна
    ронять подтверждение загрузки (битый файл, не-картинка, чуть иной формат). Тяжёлая
    (сеть + декодирование), поэтому вызывать через run_in_threadpool. Единственное
    место, где байты проходят через бэкенд, и то один раз на загрузку, не на просмотр.
    """
    try:
        client = _server_client()
        obj = client.get_object(Bucket=bucket, Key=key)
        webp = _encode_webp_thumbnail(obj["Body"].read())
        thumb_key = build_thumb_key(key)
        client.put_object(
            Bucket=bucket, Key=thumb_key, Body=webp, ContentType="image/webp"
        )
        return thumb_key
    except Exception:
        logger.warning("thumbnail generation failed for %s/%s", bucket, key, exc_info=True)
        return None


def read_image_dimensions(bucket: str, key: str) -> tuple[int, int] | None:
    """Best-effort размеры картинки: тянем оригинал из MinIO, читаем через Pillow.

    Для бэкфилла легаси-строк (`backfill_image_dims.py`), у которых `width/height`
    не пришли от клиента. Возвращает `(width, height)` или `None` при любой ошибке
    (битый файл, объекта нет в хранилище) — как `generate_image_thumbnail`, не должно
    ронять прогон. Вызывать через run_in_threadpool (сеть + декодирование).
    """
    from PIL import Image  # локальный импорт: Pillow нужен только тут

    try:
        client = _server_client()
        obj = client.get_object(Bucket=bucket, Key=key)
        with Image.open(BytesIO(obj["Body"].read())) as img:
            width, height = img.size
        return width, height
    except Exception:
        logger.warning("dims read failed for %s/%s", bucket, key, exc_info=True)
        return None


def generate_video_poster(bucket: str, key: str) -> tuple[str | None, int | None]:
    """Постер-кадр + длительность для видео, залитого без клиентского постера (ffmpeg).

    Возвращает `(thumb_key | None, duration_seconds | None)`. Best-effort: любая ошибка
    (нет ffmpeg, битый файл, объекта нет) → `(None, None)`, ничего не роняем.

    ВНИМАНИЕ: тянет видеофайл на бэкенд — это против принципа «байты видео мимо FastAPI»
    (CLAUDE.md п.7). Отсюда — только офлайн-бэкфилл старых записей (постер новых видео
    снимает клиент при загрузке), НЕ горячий путь. Вызывать через run_in_threadpool.
    """
    import os
    import subprocess
    import tempfile

    tmp_path: str | None = None
    try:
        client = _server_client()
        obj = client.get_object(Bucket=bucket, Key=key)
        with tempfile.NamedTemporaryFile(suffix=".bin", delete=False) as tmp:
            tmp_path = tmp.name
            for chunk in obj["Body"].iter_chunks(1024 * 1024):
                tmp.write(chunk)

        duration = _ffprobe_duration(tmp_path)
        # Кадр берём на 1-й секунде (первый кадр часто чёрный/интро); для совсем коротких
        # клипов — с нуля. `-ss` до `-i` = быстрый seek по ключевым кадрам.
        seek = "0" if duration is not None and duration < 2 else "1"
        proc = subprocess.run(
            ["ffmpeg", "-v", "error", "-y", "-ss", seek, "-i", tmp_path,
             "-frames:v", "1", "-f", "image2pipe", "-vcodec", "png", "pipe:1"],
            capture_output=True, timeout=120,
        )
        if proc.returncode != 0 or not proc.stdout:
            logger.warning(
                "ffmpeg poster failed for %s/%s: %s",
                bucket, key, proc.stderr[:500].decode("utf-8", "replace"),
            )
            return None, duration

        webp = _encode_webp_thumbnail(proc.stdout)
        thumb_key = build_thumb_key(key)
        client.put_object(
            Bucket=bucket, Key=thumb_key, Body=webp, ContentType="image/webp"
        )
        return thumb_key, duration
    except Exception:
        logger.warning("video poster generation failed for %s/%s", bucket, key, exc_info=True)
        return None, None
    finally:
        if tmp_path and os.path.exists(tmp_path):
            os.unlink(tmp_path)


def _ffprobe_duration(path: str) -> int | None:
    """Длительность видео в секундах через ffprobe (округлённо) или None при ошибке."""
    import subprocess

    try:
        out = subprocess.run(
            ["ffprobe", "-v", "error", "-show_entries", "format=duration",
             "-of", "default=noprint_wrappers=1:nokey=1", path],
            capture_output=True, text=True, timeout=30,
        )
        val = out.stdout.strip()
        return round(float(val)) if val else None
    except Exception:
        return None


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

    # Медиа задач (условие задачи ИЛИ сдача): доступно тому, кто видит саму задачу
    # (common → любой активный участник; individual → адресат/админ). Импорт
    # локальный — избегаем цикла (services.tasks не должен тянуть services.media на
    # уровне модуля).
    from app.models.task import (
        Task,
        TaskAssignment,
        TaskMedia,
        TaskSubmission,
        TaskSubmissionMedia,
    )

    async def _visible_task(task: Task) -> bool:
        """Видит ли юзер задачу: common → любой; individual → админ/адресат."""
        if task.type == "common":
            return True
        if user.role == "admin":
            return True
        assignee = await session.scalar(
            select(TaskAssignment.id).where(
                TaskAssignment.task_id == task.id,
                TaskAssignment.user_id == user.id,
            )
        )
        return assignee is not None

    # Медиа условия задачи (task_media).
    attached_task_rows = await session.execute(
        select(Task)
        .join(TaskMedia, TaskMedia.task_id == Task.id)
        .where(
            TaskMedia.media_asset_id == asset.id,
            Task.deleted_at.is_(None),
        )
        .distinct()
    )
    for task in attached_task_rows.scalars().all():
        if await _visible_task(task):
            return

    # Медиа сдачи задачи (task_submission_media).
    task_rows = await session.execute(
        select(Task)
        .join(TaskAssignment, TaskAssignment.task_id == Task.id)
        .join(TaskSubmission, TaskSubmission.assignment_id == TaskAssignment.id)
        .join(
            TaskSubmissionMedia,
            TaskSubmissionMedia.submission_id == TaskSubmission.id,
        )
        .where(
            TaskSubmissionMedia.media_asset_id == asset.id,
            Task.deleted_at.is_(None),
        )
        .distinct()
    )
    for task in task_rows.scalars().all():
        if await _visible_task(task):
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


def serving_key(asset: MediaAsset) -> str:
    """Какой объект отдаём под `url`. Видео с готовым транскодом — вариант; всё
    остальное (не видео, транскод не готов/провалился/легаси) — оригинал. Так
    stale-клиент и упавший транскод всё равно получают воспроизводимый/скачиваемый
    оригинал (docs/FILES.md «Транскод видео», rollout с blue-green)."""
    if (
        asset.kind == "video"
        and asset.transcode_status == "done"
        and asset.variant_key
    ):
        return asset.variant_key
    return asset.storage_key


def build_attachment_out(asset: MediaAsset) -> AttachmentOut:
    """Вложение с готовыми presigned-URL (отдаваемый объект + превью). Подпись локальна.

    Для видео `url` ведёт на транскод-вариант, когда он готов (transcode_status='done'),
    иначе на оригинал; `transcode_status` уходит клиенту, чтобы рисовать processing/failed.
    """
    # Файлы (pdf/doc/zip) — форсим скачивание; картинки/видео — инлайн.
    download_name = asset.storage_key.rsplit("/", 1)[-1] if asset.kind == "file" else None
    url = presigned_get_url(asset.bucket, serving_key(asset), download_name=download_name)
    thumb_url = (
        presigned_get_url(asset.bucket, asset.thumb_key) if asset.thumb_key else None
    )
    return AttachmentOut(
        asset_id=asset.id,
        url=url,
        thumb_url=thumb_url,
        kind=asset.kind,
        mime_type=asset.mime_type,
        size=asset.size,
        width=asset.width,
        height=asset.height,
        duration=asset.duration,
        transcode_status=asset.transcode_status,
    )


async def resolve_attachments(
    session: AsyncSession, message_ids: list[int]
) -> dict[int, list[AttachmentOut]]:
    """`{message_id: [AttachmentOut, ...]}` батчем — без N+1 по сети и по БД.

    Два запроса на всю ленту: связи message↔asset и сами ассеты. Подпись presigned
    локальна. Доступ гейтится комнатой на уровне вызывающего эндпоинта (кто читает
    сообщение — читает и вложения), поэтому per-asset проверка тут не нужна.
    """
    if not message_ids:
        return {}
    rows = await session.execute(
        select(MessageAttachment.message_id, MessageAttachment.media_asset_id)
        .where(MessageAttachment.message_id.in_(message_ids))
        .order_by(MessageAttachment.media_asset_id)
    )
    per_message: dict[int, list[int]] = {}
    all_ids: set[int] = set()
    for message_id, asset_id in rows.all():
        per_message.setdefault(message_id, []).append(asset_id)
        all_ids.add(asset_id)
    if not all_ids:
        return {}
    assets = (
        (await session.execute(select(MediaAsset).where(MediaAsset.id.in_(all_ids))))
        .scalars()
        .all()
    )
    out_by_id = {asset.id: build_attachment_out(asset) for asset in assets}
    return {
        message_id: [out_by_id[aid] for aid in asset_ids if aid in out_by_id]
        for message_id, asset_ids in per_message.items()
    }


async def message_targets_for_asset(
    session: AsyncSession, asset_id: int
) -> list[tuple[int, int]]:
    """`[(room_id, message_id), ...]` — все живые сообщения чата, к которым прикреплён
    ассет (одно видео может попасть в несколько через repost). Нужно транскод-воркеру,
    чтобы разослать WS-событие `attachment.updated` в нужные комнаты. Задачи/БЗ сюда не
    попадают — у них нет room-канала; там вариант подхватится при следующем чтении."""
    rows = await session.execute(
        select(Message.room_id, Message.id)
        .join(MessageAttachment, MessageAttachment.message_id == Message.id)
        .where(
            MessageAttachment.media_asset_id == asset_id,
            Message.deleted_at.is_(None),
        )
    )
    return [(room_id, message_id) for room_id, message_id in rows.all()]


async def resolve_submission_attachments(
    session: AsyncSession, submission_ids: list[int]
) -> dict[int, list[AttachmentOut]]:
    """`{submission_id: [AttachmentOut, ...]}` батчем — зеркало resolve_attachments,
    но по связи task_submission_media. Доступ гейтится видимостью задачи на уровне
    вызывающего эндпоинта (кто видит сдачу — видит её вложения).
    """
    from app.models.task import TaskSubmissionMedia

    if not submission_ids:
        return {}
    rows = await session.execute(
        select(
            TaskSubmissionMedia.submission_id, TaskSubmissionMedia.media_asset_id
        )
        .where(TaskSubmissionMedia.submission_id.in_(submission_ids))
        .order_by(TaskSubmissionMedia.media_asset_id)
    )
    per_submission: dict[int, list[int]] = {}
    all_ids: set[int] = set()
    for submission_id, asset_id in rows.all():
        per_submission.setdefault(submission_id, []).append(asset_id)
        all_ids.add(asset_id)
    if not all_ids:
        return {}
    assets = (
        (await session.execute(select(MediaAsset).where(MediaAsset.id.in_(all_ids))))
        .scalars()
        .all()
    )
    out_by_id = {asset.id: build_attachment_out(asset) for asset in assets}
    return {
        submission_id: [out_by_id[aid] for aid in asset_ids if aid in out_by_id]
        for submission_id, asset_ids in per_submission.items()
    }


async def resolve_task_attachments(
    session: AsyncSession, task_ids: list[int]
) -> dict[int, list[AttachmentOut]]:
    """`{task_id: [AttachmentOut, ...]}` батчем — зеркало resolve_submission_attachments,
    но по связи task_media (медиа самого условия задачи). Доступ гейтится видимостью
    задачи на уровне вызывающего эндпоинта (кто видит задачу — видит её медиа).
    """
    from app.models.task import TaskMedia

    if not task_ids:
        return {}
    rows = await session.execute(
        select(TaskMedia.task_id, TaskMedia.media_asset_id)
        .where(TaskMedia.task_id.in_(task_ids))
        .order_by(TaskMedia.media_asset_id)
    )
    per_task: dict[int, list[int]] = {}
    all_ids: set[int] = set()
    for task_id, asset_id in rows.all():
        per_task.setdefault(task_id, []).append(asset_id)
        all_ids.add(asset_id)
    if not all_ids:
        return {}
    assets = (
        (await session.execute(select(MediaAsset).where(MediaAsset.id.in_(all_ids))))
        .scalars()
        .all()
    )
    out_by_id = {asset.id: build_attachment_out(asset) for asset in assets}
    return {
        task_id: [out_by_id[aid] for aid in asset_ids if aid in out_by_id]
        for task_id, asset_ids in per_task.items()
    }
