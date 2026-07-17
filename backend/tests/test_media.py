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

    # Markdown (kind=file) разрешён — используется читалкой глав в базе знаний,
    # а ключ объекта получает расширение .md (нужно для распознавания читалкой).
    md = await client.post(
        "/api/media/uploads",
        headers=headers,
        json={"content_type": "text/markdown", "size": 2048, "kind": "file"},
    )
    assert md.status_code == 200, md.text
    assert md.json()["storage_key"].endswith(".md")


async def test_upload_ticket_ttl_survives_slow_mobile_upload(
    client: AsyncClient, make_user: MakeUser
) -> None:
    """presigned-PUT должен жить достаточно долго для медленного мобильного аплинка.

    Регрессия: TTL был 15 мин, и крупное видео на канале ~3–6 Mbps не успевало
    залиться — подпись протухала во время PUT, MinIO рвал с 400/403, отправитель
    терял файл (метрики прода: PUT на 164с/614с/2351с → 400). TTL подняли до часа;
    тот же час живёт Redis-намерение (иначе confirm упрётся в «expired upload»),
    поэтому `expires_in` тикета — прокси для обоих. Порог 30 мин: заведомо больше
    старых 15 мин (тест падал бы до фикса), с запасом ниже часа.
    """
    user = await make_user()
    headers = await _headers(client, user)

    ticket = await client.post(
        "/api/media/uploads",
        headers=headers,
        json={"content_type": "video/mp4", "size": 50_000_000, "kind": "video"},
    )
    assert ticket.status_code == 200, ticket.text
    assert ticket.json()["expires_in"] >= 30 * 60


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


# --- превью + presigned-URL прямо в ленте (быстрая доставка) ----------------


async def test_image_thumbnail_and_attachment_in_feed(
    client: AsyncClient,
    make_user: MakeUser,
    make_room: MakeRoom,
    add_membership: AddMembership,
) -> None:
    """Реальная картинка: при подтверждении генерится превью (thumb_url), а лента
    отдаёт вложение с готовыми presigned-URL — без per-asset round-trip.
    """
    from io import BytesIO

    from PIL import Image

    owner = await make_user()
    headers = await _headers(client, owner)
    room = await make_room(created_by=owner.id)
    await add_membership(room.id, owner.id, "owner")

    buf = BytesIO()
    Image.new("RGB", (1200, 800), (100, 140, 200)).save(buf, format="PNG")
    data = buf.getvalue()

    ticket = (
        await client.post(
            "/api/media/uploads",
            headers=headers,
            json={"content_type": "image/png", "size": len(data), "kind": "image"},
        )
    ).json()
    async with httpx.AsyncClient() as real:
        put = await real.put(
            ticket["upload_url"], content=data, headers={"Content-Type": "image/png"}
        )
        assert put.status_code == 200, put.text

    asset = (
        await client.post(
            "/api/media/assets",
            headers=headers,
            json={"storage_key": ticket["storage_key"], "width": 1200, "height": 800},
        )
    ).json()

    # Превью сгенерировалось и отдаётся отдельным presigned-URL.
    url_out = (await client.get(f"/api/media/{asset['id']}", headers=headers)).json()
    assert url_out["thumb_url"] is not None
    async with httpx.AsyncClient() as real:
        thumb = await real.get(url_out["thumb_url"])
        assert thumb.status_code == 200
        assert thumb.headers["content-type"] == "image/webp"

    # Лента несёт вложение с готовыми ссылками — клиенту не нужен запрос на ассет.
    await client.post(
        f"/api/rooms/{room.id}/messages",
        headers=headers,
        json={"content": "фото", "attachment_ids": [asset["id"]]},
    )
    feed = (
        await client.get(f"/api/rooms/{room.id}/messages", headers=headers)
    ).json()
    att = feed[0]["attachments"][0]
    assert att["asset_id"] == asset["id"]
    assert att["kind"] == "image"
    assert att["url"] and att["thumb_url"]
    assert att["width"] == 1200 and att["height"] == 800


async def test_video_client_poster_becomes_thumb(
    client: AsyncClient,
    make_user: MakeUser,
) -> None:
    """Видео: клиент отдельным объектом заливает постер-кадр и передаёт его ключ в
    confirm как thumb_storage_key — сервер подхватывает его как thumb_url (видеофайл
    на бэкенд не тянется). Постер своего media_assets не получает.
    """
    from io import BytesIO

    from PIL import Image

    owner = await make_user()
    headers = await _headers(client, owner)

    # 1) Заливаем «видео» (байты произвольные — сервер их не декодирует).
    video_bytes = b"\x00\x01\x02\x03" * 64
    vticket = (
        await client.post(
            "/api/media/uploads",
            headers=headers,
            json={"content_type": "video/mp4", "size": len(video_bytes), "kind": "video"},
        )
    ).json()
    async with httpx.AsyncClient() as real:
        put = await real.put(
            vticket["upload_url"],
            content=video_bytes,
            headers={"Content-Type": "video/mp4"},
        )
        assert put.status_code == 200, put.text

    # 2) Заливаем постер (как это делает клиент) — БЕЗ подтверждения /assets.
    buf = BytesIO()
    Image.new("RGB", (640, 360), (30, 30, 30)).save(buf, format="WEBP")
    poster = buf.getvalue()
    pticket = (
        await client.post(
            "/api/media/uploads",
            headers=headers,
            json={"content_type": "image/webp", "size": len(poster), "kind": "image"},
        )
    ).json()
    async with httpx.AsyncClient() as real:
        put = await real.put(
            pticket["upload_url"],
            content=poster,
            headers={"Content-Type": "image/webp"},
        )
        assert put.status_code == 200, put.text

    # 3) Подтверждаем видео, передавая ключ постера.
    asset = (
        await client.post(
            "/api/media/assets",
            headers=headers,
            json={
                "storage_key": vticket["storage_key"],
                "width": 640,
                "height": 360,
                "thumb_storage_key": pticket["storage_key"],
            },
        )
    ).json()

    url_out = (await client.get(f"/api/media/{asset['id']}", headers=headers)).json()
    assert url_out["kind"] == "video"
    assert url_out["thumb_url"] is not None
    async with httpx.AsyncClient() as real:
        thumb = await real.get(url_out["thumb_url"])
        assert thumb.status_code == 200


async def test_backfill_image_dims_fills_legacy_rows(
    client: AsyncClient,
    session: AsyncSession,
    make_user: MakeUser,
    make_room: MakeRoom,
    add_membership: AddMembership,
) -> None:
    """Легаси-картинка (width/height = NULL, как до того, как клиент начал их слать)
    получает размеры после прогона backfill_image_dims — и они доезжают до ленты через
    resolve_attachments (AttachmentOut.width/height).
    """
    from io import BytesIO

    from PIL import Image

    from app.services.media import resolve_attachments
    from scripts.backfill_image_dims import main as run_backfill

    owner = await make_user()
    headers = await _headers(client, owner)
    room = await make_room(created_by=owner.id)
    await add_membership(room.id, owner.id, "owner")

    buf = BytesIO()
    Image.new("RGB", (300, 150), (10, 20, 30)).save(buf, format="PNG")
    data = buf.getvalue()

    ticket = (
        await client.post(
            "/api/media/uploads",
            headers=headers,
            json={"content_type": "image/png", "size": len(data), "kind": "image"},
        )
    ).json()
    async with httpx.AsyncClient() as real:
        put = await real.put(
            ticket["upload_url"], content=data, headers={"Content-Type": "image/png"}
        )
        assert put.status_code == 200, put.text

    # Подтверждаем БЕЗ width/height — имитирует легаси-строку, залитую до того, как
    # клиент начал слать размеры.
    asset = (
        await client.post(
            "/api/media/assets",
            headers=headers,
            json={"storage_key": ticket["storage_key"]},
        )
    ).json()
    assert asset["width"] is None and asset["height"] is None

    posted = await client.post(
        f"/api/rooms/{room.id}/messages",
        headers=headers,
        json={"content": "фото", "attachment_ids": [asset["id"]]},
    )
    assert posted.status_code == 201, posted.text
    message_id = posted.json()["id"]

    await run_backfill()

    refreshed = await session.get(MediaAsset, asset["id"])
    assert refreshed is not None
    assert refreshed.width == 300 and refreshed.height == 150

    # Повторный прогон идемпотентен — не трогает уже заполненную строку.
    await run_backfill()
    await session.refresh(refreshed)
    assert refreshed.width == 300 and refreshed.height == 150

    attachments = await resolve_attachments(session, [message_id])
    out = attachments[message_id][0]
    assert out.width == 300 and out.height == 150


async def test_video_poster_key_from_other_user_ignored(
    client: AsyncClient,
    make_user: MakeUser,
) -> None:
    """thumb_storage_key нельзя указать на чужой объект: намерение загрузки постера
    принадлежит другому пользователю → сервер его не подхватывает (thumb_url = None).
    """
    attacker = await make_user()
    victim = await make_user()
    a_headers = await _headers(client, attacker)
    v_headers = await _headers(client, victim)

    # Жертва заливает картинку (создаёт намерение под своим user_id).
    from io import BytesIO

    from PIL import Image

    buf = BytesIO()
    Image.new("RGB", (10, 10), (0, 0, 0)).save(buf, format="WEBP")
    poster = buf.getvalue()
    vp = (
        await client.post(
            "/api/media/uploads",
            headers=v_headers,
            json={"content_type": "image/webp", "size": len(poster), "kind": "image"},
        )
    ).json()

    # Атакующий заливает своё видео и пытается присвоить ему чужой ключ постера.
    video_bytes = b"\x00" * 128
    vt = (
        await client.post(
            "/api/media/uploads",
            headers=a_headers,
            json={"content_type": "video/mp4", "size": len(video_bytes), "kind": "video"},
        )
    ).json()
    async with httpx.AsyncClient() as real:
        await real.put(
            vt["upload_url"], content=video_bytes, headers={"Content-Type": "video/mp4"}
        )

    asset = (
        await client.post(
            "/api/media/assets",
            headers=a_headers,
            json={
                "storage_key": vt["storage_key"],
                "thumb_storage_key": vp["storage_key"],
            },
        )
    ).json()
    url_out = (await client.get(f"/api/media/{asset['id']}", headers=a_headers)).json()
    assert url_out["thumb_url"] is None
