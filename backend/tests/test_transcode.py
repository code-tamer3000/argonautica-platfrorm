"""Тесты серверного транскода видео (docs/FILES.md «Транскод видео»).

Реальные Postgres/Redis/MinIO из тестового стека, без моков. Полный путь:
confirm видео → джоба в очереди + строка в 'processing' → воркер (`process_one_job`)
качает из MinIO, гонит ffmpeg/ffprobe, заливает вариант+постер, обновляет БД и шлёт
WS-событие. Плюс fast-path (уже совместимое видео не перекодируется) и провал с
ретраями (битый файл → 'failed', оригинал остаётся).

Воркер дёргаем как `process_one_job()` (он самодостаточен: сам открывает сессию и
берёт джобу из очереди) — так тест детерминирован и не поднимает отдельный процесс.
Нужны ffmpeg/ffprobe в тестовом образе (есть, из backend/Dockerfile).
"""
import subprocess
from collections.abc import AsyncIterator, Callable
from pathlib import Path
from typing import Any

import httpx
import pytest
import pytest_asyncio
from httpx import AsyncClient
from httpx_ws import aconnect_ws
from httpx_ws.transport import ASGIWebSocketTransport
from sqlalchemy.ext.asyncio import AsyncSession

from app.main import app
from app.models.media import MediaAsset
from app.models.user import User
from app.services import transcode_queue as q
from app.services.media import ensure_buckets, serving_key
from app.services.transcode import _server_client
from app.worker.transcode import process_one_job

from .conftest import (
    AddMembership,
    MakeRoom,
    MakeUser,
    auth_headers,
    login,
)

ASSETS = Path(__file__).parent / "assets"


@pytest.fixture(scope="module", autouse=True)
def _buckets() -> None:
    ensure_buckets()


@pytest_asyncio.fixture(autouse=True)
async def _drain_queue() -> AsyncIterator[None]:
    """Между тестами чистим очередь транскода — состояние в Redis эфемерно и общее."""
    yield
    from app.core.redis import redis_client

    await redis_client.delete(q.PENDING_KEY, q.INFLIGHT_KEY, q.ATTEMPTS_KEY)


async def _headers(client: AsyncClient, user: User) -> dict[str, str]:
    tokens = await login(client, user.username, "initpass123")
    return auth_headers(tokens["access_token"])


async def _upload_video(
    client: AsyncClient, headers: dict[str, str], data: bytes
) -> dict[str, Any]:
    """Залить видео (presigned-PUT) и подтвердить — возвращает JSON ассета.
    Ассет создаётся в 'processing' и ставится в очередь транскода (as in prod)."""
    ticket = (
        await client.post(
            "/api/media/uploads",
            headers=headers,
            json={"content_type": "video/mp4", "size": len(data), "kind": "video"},
        )
    ).json()
    async with httpx.AsyncClient() as real:
        put = await real.put(
            ticket["upload_url"], content=data, headers={"Content-Type": "video/mp4"}
        )
        assert put.status_code == 200, put.text
    asset = (
        await client.post(
            "/api/media/assets",
            headers=headers,
            json={"storage_key": ticket["storage_key"]},
        )
    ).json()
    return asset


def _probe(path: str) -> dict[str, Any]:
    import json

    out = subprocess.run(
        ["ffprobe", "-v", "error", "-show_entries",
         "stream=codec_type,codec_name,height:format=format_name",
         "-of", "json", path],
        capture_output=True, text=True, timeout=60,
    )
    return json.loads(out.stdout)


def _moov_before_mdat(raw: bytes) -> bool:
    moov = raw.find(b"moov")
    mdat = raw.find(b"mdat")
    return moov != -1 and (mdat == -1 or moov < mdat)


# --- confirm ставит видео в processing + очередь ----------------------------


async def test_confirm_video_marks_processing_and_enqueues(
    client: AsyncClient, make_user: MakeUser
) -> None:
    owner = await make_user()
    headers = await _headers(client, owner)
    asset = await _upload_video(client, headers, (ASSETS / "compliant.mp4").read_bytes())

    # confirm вернул processing, и attachment-payload в GET несёт это состояние.
    url_out = (await client.get(f"/api/media/{asset['id']}", headers=headers)).json()
    assert url_out["transcode_status"] == "processing"
    # Джоба реально попала в очередь.
    assert await _queue_has(asset["id"])


async def _queue_has(asset_id: int) -> bool:
    from app.core.redis import redis_client

    items = await redis_client.lrange(q.PENDING_KEY, 0, -1)
    return str(asset_id) in items


# --- полный happy-path: ворког транскодит 1080p → 720p ----------------------


async def test_worker_transcodes_to_720p_with_poster_and_ws(
    make_user: MakeUser,
    make_room: MakeRoom,
    add_membership: AddMembership,
) -> None:
    """1080p видео: воркер даёт H.264 720p faststart вариант + постер, обновляет БД,
    публикует WS attachment.updated в комнату, где висит сообщение с этим видео."""
    transport = ASGIWebSocketTransport(app)
    async with AsyncClient(transport=transport, base_url="http://test") as client:
        owner = await make_user()
        headers = await _headers(client, owner)
        room = await make_room(created_by=owner.id)
        await add_membership(room.id, owner.id, "owner")

        asset = await _upload_video(
            client, headers, (ASSETS / "needs_transcode.mp4").read_bytes()
        )
        # Прикрепляем видео к сообщению — воркер по нему найдёт комнату для WS.
        await client.post(
            f"/api/rooms/{room.id}/messages",
            headers=headers,
            json={"content": "видео", "attachment_ids": [asset["id"]]},
        )

        token = (await login(client, owner.username, "initpass123"))["access_token"]
        async with aconnect_ws(f"http://test/ws?token={token}", client) as ws:
            await ws.send_json({"type": "subscribe", "room_id": room.id})

            processed = await process_one_job()
            assert processed == asset["id"]

            event = await _wait(ws, lambda m: m.get("type") == "attachment.updated")
            assert event["room_id"] == room.id
            att = event["attachment"]
            assert att["asset_id"] == asset["id"]
            assert att["transcode_status"] == "done"

    # БД обновлена: вариант готов, ключ под префиксом видео-вариантов.
    from app.db.session import SessionLocal

    async with SessionLocal() as session:
        row = await session.get(MediaAsset, asset["id"])
        assert row is not None
        assert row.transcode_status == "done"
        assert row.variant_key and row.variant_key.startswith("video/720/")
        assert row.variant_mime == "video/mp4"
        assert row.thumb_key is not None  # постер сгенерирован
        # Отдаём именно вариант, не оригинал.
        assert serving_key(row) == row.variant_key

        # Скачиваем вариант из MinIO и проверяем ffprobe: h264, aac, faststart, ≤720.
        obj = _server_client().get_object(Bucket=row.bucket, Key=row.variant_key)
        variant_bytes = obj["Body"].read()
    # Пишем во временный файл (bind-mount tests/ только на чтение из контейнера).
    import tempfile

    with tempfile.NamedTemporaryFile(suffix=".mp4") as tmp:
        tmp.write(variant_bytes)
        tmp.flush()
        info = _probe(tmp.name)
    streams = {s["codec_type"]: s for s in info["streams"]}
    assert streams["video"]["codec_name"] == "h264"
    assert streams["audio"]["codec_name"] == "aac"
    assert int(streams["video"]["height"]) <= 720
    assert _moov_before_mdat(variant_bytes)  # faststart: moov перед mdat


# --- fast-path: уже совместимое видео не перекодируется ----------------------


async def test_fast_path_skips_transcode(
    client: AsyncClient, make_user: MakeUser
) -> None:
    """Уже H.264/AAC/faststart/≤720 видео: транскод пропускается, вариант = оригинал,
    но постер всё равно генерится и статус становится 'done'."""
    owner = await make_user()
    headers = await _headers(client, owner)
    asset = await _upload_video(client, headers, (ASSETS / "compliant.mp4").read_bytes())

    processed = await process_one_job()
    assert processed == asset["id"]

    from app.db.session import SessionLocal

    async with SessionLocal() as session:
        row = await session.get(MediaAsset, asset["id"])
        assert row is not None
        assert row.transcode_status == "done"
        # Fast-path: вариант = сам оригинал (не создаём копию под video/720/).
        assert row.variant_key == row.storage_key
        assert row.thumb_key is not None


# --- провал: битый файл → ретраи → failed, оригинал цел ---------------------


async def test_corrupt_video_fails_after_retries(
    client: AsyncClient, make_user: MakeUser
) -> None:
    """Битые байты (ffprobe/ffmpeg падают): после исчерпания попыток статус 'failed',
    вариант не проставлен (отдаём оригинал). До лимита строка остаётся 'processing'."""
    owner = await make_user()
    headers = await _headers(client, owner)
    asset = await _upload_video(client, headers, b"not a real video" * 8)
    asset_id = asset["id"]

    from app.core.config import settings
    from app.db.session import SessionLocal

    # Каждый вызов = одна попытка. До последней — джоба возвращается в очередь,
    # строка всё ещё 'processing'.
    for _ in range(settings.transcode_max_attempts - 1):
        processed = await process_one_job()
        assert processed == asset_id
        async with SessionLocal() as session:
            row = await session.get(MediaAsset, asset_id)
            assert row is not None and row.transcode_status == "processing"

    # Последняя попытка → терминальный провал.
    processed = await process_one_job()
    assert processed == asset_id
    async with SessionLocal() as session:
        row = await session.get(MediaAsset, asset_id)
        assert row is not None
        assert row.transcode_status == "failed"
        assert row.variant_key is None
        # Оригинал остаётся отдаваемым (serving_key → оригинал, не вариант).
        assert serving_key(row) == row.storage_key

    # Attachment-payload отражает failed, url ведёт на оригинал (скачиваемый).
    url_out = (await client.get(f"/api/media/{asset_id}", headers=headers)).json()
    assert url_out["transcode_status"] == "failed"


@pytest.mark.asyncio
async def test_too_long_video_fails_without_retries(
    client: AsyncClient, make_user: MakeUser, monkeypatch: pytest.MonkeyPatch
) -> None:
    """Отказ по гардрейлу длительности терминален СРАЗУ, без ретраев.

    Регрессия: раньше гардрейл кидал обычный TranscodeError, поэтому джоба уходила
    на 3 попытки, КАЖДАЯ из которых заново скачивала оригинал из MinIO (на 700 МБ —
    2 ГБ лишнего трафика), чтобы гарантированно упереться в тот же лимит.
    """
    from app.core.config import settings
    from app.db.session import SessionLocal

    owner = await make_user()
    headers = await _headers(client, owner)
    asset = await _upload_video(
        client, headers, (ASSETS / "needs_transcode.mp4").read_bytes()
    )
    asset_id = asset["id"]

    # Лимит заведомо ниже длительности фикстуры → гарантированный отказ.
    monkeypatch.setattr(settings, "transcode_max_duration_seconds", 0.5)

    # ОДНОЙ попытки достаточно: статус сразу 'failed', а не 'processing'.
    processed = await process_one_job()
    assert processed == asset_id
    async with SessionLocal() as session:
        row = await session.get(MediaAsset, asset_id)
        assert row is not None
        assert row.transcode_status == "failed"
        assert row.variant_key is None
        # Оригинал не тронут и остаётся отдаваемым.
        assert serving_key(row) == row.storage_key

    # Очередь пуста — джобу не вернули на второй круг.
    assert await process_one_job() is None


# --- вспомогательное ждём WS-событие ----------------------------------------


async def _wait(
    ws: Any, predicate: Callable[[dict[str, Any]], bool], tries: int = 30
) -> dict[str, Any]:
    for _ in range(tries):
        msg = await ws.receive_json(timeout=5.0)
        if predicate(msg):
            return msg
    raise AssertionError("matching event not received")
