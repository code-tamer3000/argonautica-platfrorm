"""Уведомления: личка → пиру, ответ в тред → автору корня, пост в новостях → всем;
себе не шлём; отметка прочитанными гасит счётчик."""
from httpx import AsyncClient
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.notification import Notification
from app.models.room import Room
from app.models.user import User

from .conftest import AddMembership, MakeRoom, MakeUser, auth_headers, login


async def _headers(client: AsyncClient, user: User) -> dict[str, str]:
    tokens = await login(client, user.username, "initpass123")
    return auth_headers(tokens["access_token"])


async def _send(
    client: AsyncClient, headers: dict[str, str], room_id: int, **body: object
) -> dict:
    resp = await client.post(
        f"/api/rooms/{room_id}/messages", headers=headers, json=body
    )
    assert resp.status_code == 201, resp.text
    return resp.json()


async def _notifications(client: AsyncClient, headers: dict[str, str]) -> dict:
    resp = await client.get("/api/notifications", headers=headers)
    assert resp.status_code == 200, resp.text
    return resp.json()


async def _db_count(session: AsyncSession, user_id: int) -> int:
    return (
        await session.execute(
            select(func.count())
            .select_from(Notification)
            .where(Notification.user_id == user_id)
        )
    ).scalar_one()


async def test_dm_message_notifies_peer(
    client: AsyncClient,
    make_user: MakeUser,
    make_room: MakeRoom,
    add_membership: AddMembership,
) -> None:
    a = await make_user()
    b = await make_user()
    room = await make_room(created_by=a.id, type="dm", name=None)
    await add_membership(room.id, a.id)
    await add_membership(room.id, b.id)

    await _send(client, await _headers(client, a), room.id, content="привет")

    data = await _notifications(client, await _headers(client, b))
    assert data["unread_count"] == 1
    assert len(data["items"]) == 1
    item = data["items"][0]
    assert item["kind"] == "dm"
    assert item["actor_id"] == a.id
    assert item["preview"] == "привет"

    # Автор себе уведомление не создаёт.
    a_data = await _notifications(client, await _headers(client, a))
    assert a_data["unread_count"] == 0


async def test_thread_reply_notifies_root_author(
    client: AsyncClient,
    make_user: MakeUser,
    make_room: MakeRoom,
    add_membership: AddMembership,
) -> None:
    a = await make_user()
    b = await make_user()
    room = await make_room(created_by=a.id)
    await add_membership(room.id, a.id, "owner")
    await add_membership(room.id, b.id)

    ha = await _headers(client, a)
    hb = await _headers(client, b)

    root = await _send(client, ha, room.id, content="root")
    # A отвечает на свой же корень — уведомления быть не должно.
    await _send(client, ha, room.id, content="self reply", reply_to_message_id=root["id"])
    # B отвечает на корень A — A получает 'reply'.
    await _send(client, hb, room.id, content="ответ", reply_to_message_id=root["id"])

    data = await _notifications(client, ha)
    assert data["unread_count"] == 1
    item = data["items"][0]
    assert item["kind"] == "reply"
    assert item["actor_id"] == b.id

    # Ответивший (B) себе уведомление не создаёт.
    b_data = await _notifications(client, hb)
    assert b_data["unread_count"] == 0


async def test_group_top_level_message_creates_no_notification(
    client: AsyncClient,
    make_user: MakeUser,
    make_room: MakeRoom,
    add_membership: AddMembership,
    session: AsyncSession,
) -> None:
    a = await make_user()
    b = await make_user()
    room = await make_room(created_by=a.id)
    await add_membership(room.id, a.id, "owner")
    await add_membership(room.id, b.id)

    await _send(client, await _headers(client, a), room.id, content="всем привет")

    # Верхнеуровневое сообщение в группе — только бейдж непрочитанных, не уведомление.
    assert await _db_count(session, b.id) == 0


async def test_news_post_notifies_participants(
    client: AsyncClient,
    make_user: MakeUser,
    session: AsyncSession,
) -> None:
    admin = await make_user(role="admin")
    participant = await make_user()

    # get-or-create новостного канала (singleton, uq_rooms_single_news).
    news = (
        await session.execute(select(Room).where(Room.is_news.is_(True)))
    ).scalar_one_or_none()
    if news is None:
        news = Room(type="channel", name="Новости", is_news=True, created_by=admin.id)
        session.add(news)
        await session.commit()
        await session.refresh(news)

    before = await _db_count(session, participant.id)
    await _send(client, await _headers(client, admin), news.id, content="Важный пост")

    data = await _notifications(client, await _headers(client, participant))
    news_items = [i for i in data["items"] if i["kind"] == "news"]
    assert news_items, data
    assert news_items[0]["actor_id"] == admin.id
    # Ровно одно новое уведомление участнику.
    assert await _db_count(session, participant.id) == before + 1
    # Админ-автор себе не шлёт.
    assert await _db_count(session, admin.id) == 0


async def test_mark_read_clears_unread(
    client: AsyncClient,
    make_user: MakeUser,
    make_room: MakeRoom,
    add_membership: AddMembership,
) -> None:
    a = await make_user()
    b = await make_user()
    room = await make_room(created_by=a.id, type="dm", name=None)
    await add_membership(room.id, a.id)
    await add_membership(room.id, b.id)
    await _send(client, await _headers(client, a), room.id, content="ping")

    hb = await _headers(client, b)
    assert (await _notifications(client, hb))["unread_count"] == 1

    resp = await client.post("/api/notifications/read", headers=hb, json={})
    assert resp.status_code == 200, resp.text
    assert resp.json()["unread_count"] == 0
    assert (await _notifications(client, hb))["unread_count"] == 0
