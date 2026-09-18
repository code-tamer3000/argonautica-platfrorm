"""Плейлист-вложение (docs/FILES.md «Плейлист», ARG-139): создание, прикрепление
к сообщению/задаче/материалу КБ, авторизация чтения через носителя.
"""
import pytest
from httpx import AsyncClient
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.media import MediaAsset
from app.models.user import User
from app.services.media import ensure_buckets

from .conftest import AddMembership, MakeRoom, MakeUser, auth_headers, login


@pytest.fixture(scope="module", autouse=True)
def _buckets() -> None:
    ensure_buckets()


async def _headers(client: AsyncClient, user: User) -> dict[str, str]:
    tokens = await login(client, user.username, "initpass123")
    return auth_headers(tokens["access_token"])


async def _make_audio_asset(session: AsyncSession, owner_id: int, name: str) -> MediaAsset:
    asset = MediaAsset(
        bucket="chat-media",
        storage_key=f"test/{owner_id}-{name}.mp3",
        kind="audio",
        mime_type="audio/mpeg",
        size=1234,
        duration=180,
        created_by=owner_id,
    )
    session.add(asset)
    await session.commit()
    await session.refresh(asset)
    return asset


async def _create_playlist(
    client: AsyncClient, headers: dict[str, str], asset_ids: list[int]
) -> dict:
    resp = await client.post(
        "/api/media/playlists",
        headers=headers,
        json={
            "title": "Медитация недели",
            "tracks": [
                {"media_asset_id": aid, "title": f"Трек {i}", "artist": "Аноним"}
                for i, aid in enumerate(asset_ids)
            ],
        },
    )
    assert resp.status_code == 201, resp.text
    return resp.json()


async def test_create_playlist_shape(
    client: AsyncClient, make_user: MakeUser, session: AsyncSession
) -> None:
    author = await make_user()
    headers = await _headers(client, author)
    a1 = await _make_audio_asset(session, author.id, "one")
    a2 = await _make_audio_asset(session, author.id, "two")

    playlist = await _create_playlist(client, headers, [a1.id, a2.id])
    assert playlist["title"] == "Медитация недели"
    assert len(playlist["tracks"]) == 2
    # Порядок треков = порядок прикрепления.
    assert [t["position"] for t in playlist["tracks"]] == [0, 1]
    assert playlist["tracks"][0]["title"] == "Трек 0"
    assert playlist["tracks"][0]["url"]


async def test_create_playlist_rejects_non_audio_asset(
    client: AsyncClient, make_user: MakeUser, session: AsyncSession
) -> None:
    author = await make_user()
    headers = await _headers(client, author)
    image = MediaAsset(
        bucket="chat-media",
        storage_key="test/not-audio.png",
        kind="image",
        mime_type="image/png",
        size=10,
        created_by=author.id,
    )
    session.add(image)
    await session.commit()
    await session.refresh(image)

    resp = await client.post(
        "/api/media/playlists",
        headers=headers,
        json={"title": "X", "tracks": [{"media_asset_id": image.id, "title": "Трек"}]},
    )
    assert resp.status_code == 400


async def test_playlist_attached_to_message_visible_to_room_member(
    client: AsyncClient,
    make_user: MakeUser,
    make_room: MakeRoom,
    add_membership: AddMembership,
    session: AsyncSession,
) -> None:
    author = await make_user()
    member = await make_user()  # видит сообщение, но не автор плейлиста
    author_h = await _headers(client, author)
    member_h = await _headers(client, member)

    room = await make_room(created_by=author.id, type="group")
    await add_membership(room.id, author.id, role="owner")
    await add_membership(room.id, member.id)

    a1 = await _make_audio_asset(session, author.id, "one")
    a2 = await _make_audio_asset(session, author.id, "two")
    playlist = await _create_playlist(client, author_h, [a1.id, a2.id])

    send = await client.post(
        f"/api/rooms/{room.id}/messages",
        headers=author_h,
        json={"playlist_id": playlist["id"]},
    )
    assert send.status_code == 201, send.text
    message = send.json()
    assert message["playlist"]["id"] == playlist["id"]
    assert len(message["playlist"]["tracks"]) == 2

    # Другой участник комнаты читает ленту и получает presigned-URL треков — доступ
    # разрешён ЧЕРЕЗ носителя (сообщение → комната), а не через владение плейлистом.
    feed = await client.get(f"/api/rooms/{room.id}/messages", headers=member_h)
    assert feed.status_code == 200, feed.text
    got = next(m for m in feed.json() if m["id"] == message["id"])
    assert got["playlist"]["tracks"][0]["url"]

    # Прямой GET /api/media/{id} на трек тоже открыт участнику — та же цепочка.
    track_asset_id = got["playlist"]["tracks"][0]["asset_id"]
    direct = await client.get(f"/api/media/{track_asset_id}", headers=member_h)
    assert direct.status_code == 200, direct.text


async def test_playlist_track_not_accessible_to_outsider(
    client: AsyncClient,
    make_user: MakeUser,
    make_room: MakeRoom,
    add_membership: AddMembership,
    session: AsyncSession,
) -> None:
    author = await make_user()
    outsider = await make_user()  # не состоит в комнате
    author_h = await _headers(client, author)
    outsider_h = await _headers(client, outsider)

    room = await make_room(created_by=author.id, type="group")
    await add_membership(room.id, author.id, role="owner")

    a1 = await _make_audio_asset(session, author.id, "one")
    playlist = await _create_playlist(client, author_h, [a1.id])
    send = await client.post(
        f"/api/rooms/{room.id}/messages",
        headers=author_h,
        json={"playlist_id": playlist["id"]},
    )
    assert send.status_code == 201, send.text

    track_asset_id = playlist["tracks"][0]["asset_id"]
    resp = await client.get(f"/api/media/{track_asset_id}", headers=outsider_h)
    assert resp.status_code == 403


async def test_attach_someone_elses_playlist_to_message_is_rejected(
    client: AsyncClient,
    make_user: MakeUser,
    make_room: MakeRoom,
    add_membership: AddMembership,
    session: AsyncSession,
) -> None:
    """Анти-IDOR: нельзя прикрепить чужой playlist_id к своему сообщению."""
    owner = await make_user()
    attacker = await make_user()
    owner_h = await _headers(client, owner)
    attacker_h = await _headers(client, attacker)

    room = await make_room(created_by=attacker.id, type="group")
    await add_membership(room.id, attacker.id, role="owner")

    a1 = await _make_audio_asset(session, owner.id, "one")
    playlist = await _create_playlist(client, owner_h, [a1.id])

    resp = await client.post(
        f"/api/rooms/{room.id}/messages",
        headers=attacker_h,
        json={"playlist_id": playlist["id"]},
    )
    assert resp.status_code == 404


async def test_playlist_attached_to_kb_item(
    client: AsyncClient, make_user: MakeUser, session: AsyncSession
) -> None:
    admin = await make_user(role="admin")
    participant = await make_user()
    admin_h = await _headers(client, admin)
    participant_h = await _headers(client, participant)

    a1 = await _make_audio_asset(session, admin.id, "one")
    playlist = await _create_playlist(client, admin_h, [a1.id])

    create = await client.post(
        "/api/kb/items",
        headers=admin_h,
        json={"title": "Материал с музыкой", "published": True, "playlist_id": playlist["id"]},
    )
    assert create.status_code == 201, create.text
    item = create.json()
    assert item["playlist"]["id"] == playlist["id"]

    # Опубликованный материал — виден любому участнику вместе с плейлистом.
    got = await client.get(f"/api/kb/items/{item['id']}", headers=participant_h)
    assert got.status_code == 200, got.text
    assert got.json()["playlist"]["tracks"][0]["url"]


async def test_playlist_attached_to_common_task(
    client: AsyncClient, make_user: MakeUser, session: AsyncSession
) -> None:
    admin = await make_user(role="admin")
    participant = await make_user()
    admin_h = await _headers(client, admin)
    participant_h = await _headers(client, participant)

    a1 = await _make_audio_asset(session, admin.id, "one")
    playlist = await _create_playlist(client, admin_h, [a1.id])

    create = await client.post(
        "/api/tasks",
        headers=admin_h,
        json={"type": "common", "title": "Слушаем", "playlist_id": playlist["id"]},
    )
    assert create.status_code == 201, create.text
    task = create.json()
    assert task["playlist"]["id"] == playlist["id"]

    got = await client.get(f"/api/tasks/{task['id']}", headers=participant_h)
    assert got.status_code == 200, got.text
    assert got.json()["playlist"]["tracks"][0]["url"]


async def test_owner_can_rename_playlist(
    client: AsyncClient, make_user: MakeUser, session: AsyncSession
) -> None:
    owner = await make_user()
    headers = await _headers(client, owner)
    a1 = await _make_audio_asset(session, owner.id, "one")
    playlist = await _create_playlist(client, headers, [a1.id])

    resp = await client.patch(
        f"/api/media/playlists/{playlist['id']}",
        headers=headers,
        json={"title": "Новое название"},
    )
    assert resp.status_code == 200, resp.text
    assert resp.json()["title"] == "Новое название"


async def test_non_owner_cannot_rename_playlist(
    client: AsyncClient, make_user: MakeUser, session: AsyncSession
) -> None:
    owner = await make_user()
    other = await make_user()
    owner_h = await _headers(client, owner)
    other_h = await _headers(client, other)
    a1 = await _make_audio_asset(session, owner.id, "one")
    playlist = await _create_playlist(client, owner_h, [a1.id])

    resp = await client.patch(
        f"/api/media/playlists/{playlist['id']}",
        headers=other_h,
        json={"title": "Чужое название"},
    )
    assert resp.status_code == 403


async def test_owner_can_remove_track_but_not_the_last_one(
    client: AsyncClient, make_user: MakeUser, session: AsyncSession
) -> None:
    owner = await make_user()
    headers = await _headers(client, owner)
    a1 = await _make_audio_asset(session, owner.id, "one")
    a2 = await _make_audio_asset(session, owner.id, "two")
    playlist = await _create_playlist(client, headers, [a1.id, a2.id])
    track_ids = [t["id"] for t in playlist["tracks"]]

    resp = await client.delete(
        f"/api/media/playlists/{playlist['id']}/tracks/{track_ids[0]}", headers=headers
    )
    assert resp.status_code == 200, resp.text
    remaining = resp.json()
    assert len(remaining["tracks"]) == 1

    # Последний трек убрать нельзя — плейлист не может остаться пустым.
    last_track_id = remaining["tracks"][0]["id"]
    resp2 = await client.delete(
        f"/api/media/playlists/{playlist['id']}/tracks/{last_track_id}", headers=headers
    )
    assert resp2.status_code == 400
