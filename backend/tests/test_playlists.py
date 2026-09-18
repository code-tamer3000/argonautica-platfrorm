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
from .test_admin_intakes import create_intake


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


async def test_admin_can_rename_and_set_cover_on_someone_elses_playlist(
    client: AsyncClient, make_user: MakeUser, session: AsyncSession
) -> None:
    owner = await make_user()
    admin = await make_user(role="admin")
    owner_h = await _headers(client, owner)
    admin_h = await _headers(client, admin)
    a1 = await _make_audio_asset(session, owner.id, "one")
    playlist = await _create_playlist(client, owner_h, [a1.id])

    cover = MediaAsset(
        bucket="chat-media",
        storage_key="test/cover.png",
        kind="image",
        mime_type="image/png",
        size=10,
        created_by=admin.id,
    )
    session.add(cover)
    await session.commit()
    await session.refresh(cover)

    resp = await client.patch(
        f"/api/media/playlists/{playlist['id']}",
        headers=admin_h,
        json={"title": "Модерация", "cover_media_id": cover.id},
    )
    assert resp.status_code == 200, resp.text
    body = resp.json()
    assert body["title"] == "Модерация"
    assert body["cover_url"]


async def test_set_cover_rejects_non_image_asset(
    client: AsyncClient, make_user: MakeUser, session: AsyncSession
) -> None:
    owner = await make_user()
    headers = await _headers(client, owner)
    a1 = await _make_audio_asset(session, owner.id, "one")
    a2 = await _make_audio_asset(session, owner.id, "two")
    playlist = await _create_playlist(client, headers, [a1.id])

    resp = await client.patch(
        f"/api/media/playlists/{playlist['id']}",
        headers=headers,
        json={"cover_media_id": a2.id},
    )
    assert resp.status_code == 400


async def test_task_library_returns_playlist_for_edit_form(
    client: AsyncClient, make_user: MakeUser, session: AsyncSession
) -> None:
    """Регрессия: «База заданий» отдавала задачу без `playlist`, и форма
    редактирования (она инициализируется именно этим объектом) теряла уже
    прикреплённый плейлист."""
    admin = await make_user(role="admin")
    admin_h = await _headers(client, admin)
    a1 = await _make_audio_asset(session, admin.id, "one")
    playlist = await _create_playlist(client, admin_h, [a1.id])

    create = await client.post(
        "/api/tasks",
        headers=admin_h,
        json={"type": "common", "title": "Слушаем", "playlist_id": playlist["id"]},
    )
    assert create.status_code == 201, create.text
    task_id = create.json()["id"]

    lib = await client.get("/api/admin/tasks", headers=admin_h)
    assert lib.status_code == 200, lib.text
    row = next(i for i in lib.json()["items"] if i["id"] == task_id)
    assert row["playlist"]["id"] == playlist["id"]
    assert row["playlist"]["tracks"][0]["url"]


async def test_task_patch_attaches_replaces_and_detaches_playlist(
    client: AsyncClient, make_user: MakeUser, session: AsyncSession
) -> None:
    admin = await make_user(role="admin")
    admin_h = await _headers(client, admin)
    a1 = await _make_audio_asset(session, admin.id, "one")
    a2 = await _make_audio_asset(session, admin.id, "two")
    first = await _create_playlist(client, admin_h, [a1.id])
    second = await _create_playlist(client, admin_h, [a2.id])

    create = await client.post(
        "/api/tasks", headers=admin_h, json={"type": "common", "title": "Без музыки"}
    )
    assert create.status_code == 201, create.text
    task_id = create.json()["id"]
    assert create.json()["playlist"] is None

    attach = await client.patch(
        f"/api/tasks/{task_id}", headers=admin_h, json={"playlist_id": first["id"]}
    )
    assert attach.status_code == 200, attach.text
    assert attach.json()["playlist"]["id"] == first["id"]

    replace = await client.patch(
        f"/api/tasks/{task_id}", headers=admin_h, json={"playlist_id": second["id"]}
    )
    assert replace.status_code == 200, replace.text
    assert replace.json()["playlist"]["id"] == second["id"]

    # Поле не передано — плейлист не трогаем.
    untouched = await client.patch(
        f"/api/tasks/{task_id}", headers=admin_h, json={"title": "Другое имя"}
    )
    assert untouched.status_code == 200, untouched.text
    assert untouched.json()["playlist"]["id"] == second["id"]

    detach = await client.patch(
        f"/api/tasks/{task_id}", headers=admin_h, json={"playlist_id": None}
    )
    assert detach.status_code == 200, detach.text
    assert detach.json()["playlist"] is None


async def test_task_patch_rejects_someone_elses_playlist(
    client: AsyncClient, make_user: MakeUser, session: AsyncSession
) -> None:
    """Анти-IDOR: чужой playlist_id нельзя прицепить и через PATCH."""
    admin = await make_user(role="admin")
    other_admin = await make_user(role="admin")
    admin_h = await _headers(client, admin)
    other_h = await _headers(client, other_admin)
    a1 = await _make_audio_asset(session, other_admin.id, "one")
    foreign = await _create_playlist(client, other_h, [a1.id])

    create = await client.post(
        "/api/tasks", headers=admin_h, json={"type": "common", "title": "Без музыки"}
    )
    task_id = create.json()["id"]
    resp = await client.patch(
        f"/api/tasks/{task_id}", headers=admin_h, json={"playlist_id": foreign["id"]}
    )
    assert resp.status_code == 404


async def test_republished_task_keeps_playlist(
    client: AsyncClient, make_user: MakeUser, session: AsyncSession
) -> None:
    """Клон из «Базы заданий» ссылается на тот же плейлист — доступ к трекам
    гейтится по задаче-носителю, переливать файлы не нужно."""
    admin = await make_user(role="admin")
    admin_h = await _headers(client, admin)
    a1 = await _make_audio_asset(session, admin.id, "one")
    playlist = await _create_playlist(client, admin_h, [a1.id])

    create = await client.post(
        "/api/tasks",
        headers=admin_h,
        json={"type": "common", "title": "Слушаем", "playlist_id": playlist["id"]},
    )
    task_id = create.json()["id"]

    intake = await create_intake(client, admin_h)
    resp = await client.post(
        f"/api/admin/tasks/{task_id}/republish",
        headers=admin_h,
        json={"intake_id": intake["id"]},
    )
    assert resp.status_code == 201, resp.text
    assert resp.json()["playlist"]["id"] == playlist["id"]


async def test_kb_patch_attaches_and_detaches_playlist(
    client: AsyncClient, make_user: MakeUser, session: AsyncSession
) -> None:
    admin = await make_user(role="admin")
    admin_h = await _headers(client, admin)
    a1 = await _make_audio_asset(session, admin.id, "one")
    playlist = await _create_playlist(client, admin_h, [a1.id])

    create = await client.post(
        "/api/kb/items", headers=admin_h, json={"title": "Материал", "published": True}
    )
    assert create.status_code == 201, create.text
    item_id = create.json()["id"]

    attach = await client.patch(
        f"/api/kb/items/{item_id}", headers=admin_h, json={"playlist_id": playlist["id"]}
    )
    assert attach.status_code == 200, attach.text
    assert attach.json()["playlist"]["id"] == playlist["id"]

    detach = await client.patch(
        f"/api/kb/items/{item_id}", headers=admin_h, json={"playlist_id": None}
    )
    assert detach.status_code == 200, detach.text
    assert detach.json()["playlist"] is None


async def test_playlist_picker_lists_own_and_accessible_only(
    client: AsyncClient,
    make_user: MakeUser,
    make_room: MakeRoom,
    add_membership: AddMembership,
    session: AsyncSession,
) -> None:
    """Пикер «прикрепить существующий» отдаёт свои плейлисты и те, что уже
    прикреплены к доступному носителю, — но НЕ чужие из комнат, куда нет доступа."""
    author = await make_user()
    member = await make_user()
    outsider = await make_user()
    author_h = await _headers(client, author)
    member_h = await _headers(client, member)
    outsider_h = await _headers(client, outsider)

    room = await make_room(created_by=author.id, type="group")
    await add_membership(room.id, author.id)
    await add_membership(room.id, member.id)

    a1 = await _make_audio_asset(session, author.id, "one")
    shared = await _create_playlist(client, author_h, [a1.id])
    resp = await client.post(
        f"/api/rooms/{room.id}/messages",
        headers=author_h,
        json={"playlist_id": shared["id"]},
    )
    assert resp.status_code == 201, resp.text

    # Свой — видно всегда, даже пока никуда не прикреплён.
    a2 = await _make_audio_asset(session, author.id, "two")
    unattached = await _create_playlist(client, author_h, [a2.id])

    listed_author = await client.get("/api/media/playlists", headers=author_h)
    assert listed_author.status_code == 200, listed_author.text
    author_ids = [p["id"] for p in listed_author.json()["items"]]
    assert shared["id"] in author_ids
    assert unattached["id"] in author_ids

    # Участник комнаты видит прикреплённый туда, но не «висящий» чужой черновик.
    listed_member = await client.get("/api/media/playlists", headers=member_h)
    member_ids = [p["id"] for p in listed_member.json()["items"]]
    assert shared["id"] in member_ids
    assert unattached["id"] not in member_ids

    # Посторонний не видит ни одного.
    listed_outsider = await client.get("/api/media/playlists", headers=outsider_h)
    outsider_ids = [p["id"] for p in listed_outsider.json()["items"]]
    assert shared["id"] not in outsider_ids
    assert unattached["id"] not in outsider_ids


async def test_member_can_reattach_playlist_he_can_see(
    client: AsyncClient,
    make_user: MakeUser,
    make_room: MakeRoom,
    add_membership: AddMembership,
    session: AsyncSession,
) -> None:
    """Главное послабление фичи: чужой, но ДОСТУПНЫЙ плейлист можно прикрепить
    к своему сообщению (раньше пускали только собственный)."""
    author = await make_user()
    member = await make_user()
    author_h = await _headers(client, author)
    member_h = await _headers(client, member)

    room = await make_room(created_by=author.id, type="group")
    await add_membership(room.id, author.id)
    await add_membership(room.id, member.id)

    a1 = await _make_audio_asset(session, author.id, "one")
    playlist = await _create_playlist(client, author_h, [a1.id])
    first = await client.post(
        f"/api/rooms/{room.id}/messages",
        headers=author_h,
        json={"playlist_id": playlist["id"]},
    )
    assert first.status_code == 201

    reattached = await client.post(
        f"/api/rooms/{room.id}/messages",
        headers=member_h,
        json={"playlist_id": playlist["id"]},
    )
    assert reattached.status_code == 201, reattached.text
    assert reattached.json()["playlist"]["id"] == playlist["id"]


async def test_outsider_still_cannot_attach_playlist_he_cannot_see(
    client: AsyncClient,
    make_user: MakeUser,
    make_room: MakeRoom,
    add_membership: AddMembership,
    session: AsyncSession,
) -> None:
    """Анти-IDOR не сломан: недоступный чужой playlist_id по-прежнему 404 —
    иначе подстановкой id музыка из чужой комнаты утекала бы в свою."""
    author = await make_user()
    outsider = await make_user()
    author_h = await _headers(client, author)
    outsider_h = await _headers(client, outsider)

    closed = await make_room(created_by=author.id, type="group")
    await add_membership(closed.id, author.id)
    own_room = await make_room(created_by=outsider.id, type="group")
    await add_membership(own_room.id, outsider.id)

    a1 = await _make_audio_asset(session, author.id, "one")
    playlist = await _create_playlist(client, author_h, [a1.id])
    assert (
        await client.post(
            f"/api/rooms/{closed.id}/messages",
            headers=author_h,
            json={"playlist_id": playlist["id"]},
        )
    ).status_code == 201

    resp = await client.post(
        f"/api/rooms/{own_room.id}/messages",
        headers=outsider_h,
        json={"playlist_id": playlist["id"]},
    )
    assert resp.status_code == 404


async def test_playlist_picker_search_by_title(
    client: AsyncClient, make_user: MakeUser, session: AsyncSession
) -> None:
    author = await make_user()
    author_h = await _headers(client, author)
    a1 = await _make_audio_asset(session, author.id, "one")
    playlist = await _create_playlist(client, author_h, [a1.id])

    hit = await client.get("/api/media/playlists?q=Медитация", headers=author_h)
    assert hit.status_code == 200, hit.text
    assert playlist["id"] in [p["id"] for p in hit.json()["items"]]

    miss = await client.get("/api/media/playlists?q=неттакого", headers=author_h)
    assert playlist["id"] not in [p["id"] for p in miss.json()["items"]]
