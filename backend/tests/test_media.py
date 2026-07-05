"""Тесты медиа: валидация запроса загрузки, подтверждение (намерение + размер из
MinIO), presigned round-trip, авторизация чтения и владение вложением.

Round-trip ходит в реально поднятый MinIO (localhost:9000). Бакеты создаём фикстурой
(lifespan в тестах не запускается).
"""
import httpx
import pytest
from httpx import AsyncClient
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.media import MediaAsset
from app.models.user import User
from app.services.media import ensure_buckets

from .conftest import (
    AddMembership,
    MakeRoom,
    MakeUser,
    auth_headers,
    login,
)


@pytest.fixture(scope="module", autouse=True)
def _buckets() -> None:
    ensure_buckets()


async def _headers(client: AsyncClient, user: User) -> dict[str, str]:
    tokens = await login(client, user.username, "initpass123")
    return auth_headers(tokens["access_token"])


async def _make_asset(
    session: AsyncSession, owner_id: int, *, kind: str = "image"
) -> MediaAsset:
    """Готовый ассет в БД (без реальной загрузки) — для тестов авторизации/владения."""
    asset = MediaAsset(
        bucket="chat-media",
        storage_key=f"test/{owner_id}-{kind}.bin",
        kind=kind,
        mime_type="image/png",
        size=10,
        created_by=owner_id,
    )
    session.add(asset)
    await session.commit()
    await session.refresh(asset)
    return asset


# --- валидация запроса загрузки --------------------------------------------


async def test_request_upload_validation(
    client: AsyncClient, make_user: MakeUser
) -> None:
    user = await make_user()
    headers = await _headers(client, user)

    ok = await client.post(
        "/api/media/uploads",
        headers=headers,
        json={"content_type": "image/png", "size": 1234, "kind": "image"},
    )
    assert ok.status_code == 200, ok.text
    body = ok.json()
    assert body["upload_url"] and body["storage_key"]

    # Тип не соответствует виду.
    mismatch = await client.post(
        "/api/media/uploads",
        headers=headers,
        json={"content_type": "image/png", "size": 10, "kind": "file"},
    )
    assert mismatch.status_code == 400

    # Слишком большой файл.
    too_big = await client.post(
        "/api/media/uploads",
        headers=headers,
        json={"content_type": "image/png", "size": 10**12, "kind": "image"},
    )
    assert too_big.status_code == 400


async def test_confirm_requires_intent_and_owner(
    client: AsyncClient, make_user: MakeUser
) -> None:
    a = await make_user()
    b = await make_user()

    # Нет намерения для такого ключа.
    unknown = await client.post(
        "/api/media/assets",
        headers=await _headers(client, a),
        json={"storage_key": "nope/missing.png"},
    )
    assert unknown.status_code == 400

    # A запросил загрузку, B пытается подтвердить → 403 (чужое намерение).
    ticket = (
        await client.post(
            "/api/media/uploads",
            headers=await _headers(client, a),
            json={"content_type": "image/png", "size": 10, "kind": "image"},
        )
    ).json()
    by_b = await client.post(
        "/api/media/assets",
        headers=await _headers(client, b),
        json={"storage_key": ticket["storage_key"]},
    )
    assert by_b.status_code == 403


# --- голосовые сообщения (audio) -------------------------------------------


async def test_audio_upload_validation(
    client: AsyncClient, make_user: MakeUser
) -> None:
    user = await make_user()
    headers = await _headers(client, user)

    # audio-тип принимается для kind=audio.
    ok = await client.post(
        "/api/media/uploads",
        headers=headers,
        json={"content_type": "audio/webm", "size": 4096, "kind": "audio"},
    )
    assert ok.status_code == 200, ok.text

    # Не-audio тип под kind=audio отклоняется.
    mismatch = await client.post(
        "/api/media/uploads",
        headers=headers,
        json={"content_type": "video/mp4", "size": 4096, "kind": "audio"},
    )
    assert mismatch.status_code == 400

    # Крупное аудио проходит: аудиоматериалы (лекции/записи) легитимно большие,
    # аудиолимит поднят достаточно высоко, чтобы они не упирались в потолок.
    big_audio = await client.post(
        "/api/media/uploads",
        headers=headers,
        json={"content_type": "audio/webm", "size": 100 * 1024 * 1024, "kind": "audio"},
    )
    assert big_audio.status_code == 200, big_audio.text


async def test_media_url_reports_kind_and_duration(
    client: AsyncClient, session: AsyncSession, make_user: MakeUser
) -> None:
    """GET /api/media/{id} отдаёт авторитетный kind и duration (для плеера)."""
    owner = await make_user()
    asset = MediaAsset(
        bucket="chat-media",
        storage_key=f"test/{owner.id}-voice.webm",
        kind="audio",
        mime_type="audio/webm",
        size=2048,
        duration=7,
        created_by=owner.id,
    )
    session.add(asset)
    await session.commit()
    await session.refresh(asset)

    resp = await client.get(
        f"/api/media/{asset.id}", headers=await _headers(client, owner)
    )
    assert resp.status_code == 200, resp.text
    body = resp.json()
    assert body["kind"] == "audio"
    assert body["duration"] == 7


# --- полный presigned round-trip (реальный MinIO) --------------------------


async def test_upload_roundtrip(client: AsyncClient, make_user: MakeUser) -> None:
    user = await make_user()
    headers = await _headers(client, user)
    data = b"\x89PNG\r\n\x1a\n test image bytes"

    ticket = (
        await client.post(
            "/api/media/uploads",
            headers=headers,
            json={"content_type": "image/png", "size": len(data), "kind": "image"},
        )
    ).json()

    async with httpx.AsyncClient() as real:
        # Клиент льёт файл напрямую в MinIO по presigned-PUT.
        put = await real.put(
            ticket["upload_url"], content=data, headers={"Content-Type": "image/png"}
        )
        assert put.status_code == 200, put.text

    confirm = await client.post(
        "/api/media/assets",
        headers=headers,
        json={"storage_key": ticket["storage_key"]},
    )
    assert confirm.status_code == 201, confirm.text
    asset = confirm.json()
    assert asset["size"] == len(data)  # размер взят из MinIO, не от клиента
    assert asset["kind"] == "image"

    url_resp = await client.get(f"/api/media/{asset['id']}", headers=headers)
    assert url_resp.status_code == 200
    async with httpx.AsyncClient() as real:
        got = await real.get(url_resp.json()["url"])
        assert got.status_code == 200
        assert got.content == data


# --- авторизация чтения -----------------------------------------------------


async def test_media_read_authorization(
    client: AsyncClient,
    session: AsyncSession,
    make_user: MakeUser,
    make_room: MakeRoom,
    add_membership: AddMembership,
) -> None:
    owner = await make_user()
    member = await make_user()
    outsider = await make_user()
    room = await make_room(created_by=owner.id)
    await add_membership(room.id, owner.id, "owner")
    await add_membership(room.id, member.id, "member")

    asset = await _make_asset(session, owner.id)

    # Загрузивший всегда может получить ссылку.
    own = await client.get(
        f"/api/media/{asset.id}", headers=await _headers(client, owner)
    )
    assert own.status_code == 200

    # Пока ассет ни к чему не привязан — посторонний не видит.
    before = await client.get(
        f"/api/media/{asset.id}", headers=await _headers(client, member)
    )
    assert before.status_code == 403

    # Owner прикрепляет ассет к сообщению в комнате.
    posted = await client.post(
        f"/api/rooms/{room.id}/messages",
        headers=await _headers(client, owner),
        json={"content": "see attachment", "attachment_ids": [asset.id]},
    )
    assert posted.status_code == 201

    # Теперь участник комнаты видит ассет, а посторонний — нет.
    member_resp = await client.get(
        f"/api/media/{asset.id}", headers=await _headers(client, member)
    )
    assert member_resp.status_code == 200
    outsider_resp = await client.get(
        f"/api/media/{asset.id}", headers=await _headers(client, outsider)
    )
    assert outsider_resp.status_code == 403


async def test_cannot_attach_someone_elses_asset(
    client: AsyncClient,
    session: AsyncSession,
    make_user: MakeUser,
    make_room: MakeRoom,
    add_membership: AddMembership,
) -> None:
    a = await make_user()
    b = await make_user()
    room = await make_room(created_by=b.id)
    await add_membership(room.id, b.id, "owner")

    foreign = await _make_asset(session, a.id)  # ассет A
    own = await _make_asset(session, b.id)  # ассет B
    headers = await _headers(client, b)

    # B не может прикрепить чужой ассет.
    bad = await client.post(
        f"/api/rooms/{room.id}/messages",
        headers=headers,
        json={"content": "x", "attachment_ids": [foreign.id]},
    )
    assert bad.status_code == 404

    # Свой — можно.
    good = await client.post(
        f"/api/rooms/{room.id}/messages",
        headers=headers,
        json={"content": "x", "attachment_ids": [own.id]},
    )
    assert good.status_code == 201
    assert good.json()["attachment_ids"] == [own.id]
