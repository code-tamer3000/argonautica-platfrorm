"""Работа с медиа в MinIO (S3-совместимо) через boto3.

Принцип (CLAUDE.md, п.7): байты не гоняем через FastAPI. Клиент льёт/качает файлы
напрямую в MinIO по короткоживущим presigned-URL, которые бэкенд выдаёт ПОСЛЕ
проверки прав. Бакеты приватные. Смена бэкенда хранения (MinIO -> managed-S3)
трогает только этот модуль.

`generate_presigned_url` — локальная операция (подпись), сети не требует, поэтому
синхронный boto3 здесь приемлем. URL подписываются под публичным endpoint —
браузеру нужен адрес, до которого он реально достучится (см. MINIO_PUBLIC_ENDPOINT).
"""
from functools import lru_cache

import boto3
from botocore.client import BaseClient, Config
from botocore.exceptions import ClientError

from app.core.config import settings

# Presigned-URL должны указывать на публичный адрес MinIO (browser-facing).
_PRESIGN_EXPIRES = 900  # 15 минут — короткоживущие ссылки


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
) -> str:
    """Короткоживущий URL для чтения (GET). MinIO поддерживает range-запросы (перемотка видео)."""
    url: str = _presign_client().generate_presigned_url(
        ClientMethod="get_object",
        Params={"Bucket": bucket, "Key": key},
        ExpiresIn=expires,
    )
    return url


def ensure_buckets() -> None:
    """Идемпотентно создать приватные бакеты для медиа и базы знаний."""
    client = _server_client()
    for bucket in (settings.minio_bucket_media, settings.minio_bucket_kb):
        try:
            client.head_bucket(Bucket=bucket)
        except ClientError:
            client.create_bucket(Bucket=bucket)
