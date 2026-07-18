"""Режим наблюдателя (users.is_observer): пассивный доступ «только к материалам».

Наблюдатель читает Новости (единственный канал в его /api/rooms) и НЕ пишет никуда;
Рубка (dm/группы), Задачи, Календарь, Динамика, Уведомления и Каюта ему закрыты (403).
Взаимоисключаем с ролью admin. См. docs/AUTH.md.
"""
import pytest
from httpx import AsyncClient
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.notification import Notification
from app.models.room import Room
from app.models.user import User

from .conftest import (
    AddMembership,
    MakeRoom,
    MakeUser,
    auth_headers,
    login,
)


async def _headers(client: AsyncClient, user: User) -> dict[str, str]:
    tokens = await login(client, user.username, "initpass123")
    return auth_headers(tokens["access_token"])


async def _news_channel(session: AsyncSession, admin: User) -> Room:
    """get-or-create новостного канала (singleton, uq_rooms_single_news)."""
    news = (
        await session.execute(select(Room).where(Room.is_news.is_(True)))
    ).scalar_one_or_none()
    if news is None:
        news = Room(type="channel", name="Новости", is_news=True, created_by=admin.id)
        session.add(news)
        await session.commit()
        await session.refresh(news)
    return news


# --- Чтение новостей: наблюдателю доступно ----------------------------------


async def test_observer_reads_news_channel(
    client: AsyncClient,
    make_user: MakeUser,
    session: AsyncSession,
) -> None:
    admin = await make_user(role="admin")
    observer = await make_user(is_observer=True)
    news = await _news_channel(session, admin)

    # Админ публикует пост, наблюдатель его читает.
    post = await client.post(
        f"/api/rooms/{news.id}/messages",
        headers=await _headers(client, admin),
        json={"content": "Важное объявление"},
    )
    assert post.status_code == 201, post.text

    feed = await client.get(
        f"/api/rooms/{news.id}/messages", headers=await _headers(client, observer)
    )
    assert feed.status_code == 200, feed.text
    assert any(m["content"] == "Важное объявление" for m in feed.json())


async def test_observer_room_list_is_news_only(
    client: AsyncClient,
    make_user: MakeUser,
    make_room: MakeRoom,
    add_membership: AddMembership,
    session: AsyncSession,
) -> None:
    admin = await make_user(role="admin")
    observer = await make_user(is_observer=True)
    news = await _news_channel(session, admin)

    # Даже если наблюдателя занесли в группу — в списке комнат её не видно.
    group = await make_room(created_by=admin.id)
    await add_membership(group.id, observer.id)

    resp = await client.get("/api/rooms", headers=await _headers(client, observer))
    assert resp.status_code == 200, resp.text
    ids = {r["id"] for r in resp.json()}
    assert ids == {news.id}


# --- Запись: наблюдателю запрещена везде ------------------------------------


async def test_observer_cannot_post_to_news(
    client: AsyncClient,
    make_user: MakeUser,
    session: AsyncSession,
) -> None:
    admin = await make_user(role="admin")
    observer = await make_user(is_observer=True)
    news = await _news_channel(session, admin)

    resp = await client.post(
        f"/api/rooms/{news.id}/messages",
        headers=await _headers(client, observer),
        json={"content": "не должен пройти"},
    )
    assert resp.status_code == 403, resp.text


async def test_observer_cannot_comment_in_news_thread(
    client: AsyncClient,
    make_user: MakeUser,
    session: AsyncSession,
) -> None:
    admin = await make_user(role="admin")
    observer = await make_user(is_observer=True)
    news = await _news_channel(session, admin)

    post = await client.post(
        f"/api/rooms/{news.id}/messages",
        headers=await _headers(client, admin),
        json={"content": "пост"},
    )
    root_id = post.json()["id"]

    # Комментарии (треды) обычным участникам разрешены, наблюдателю — нет.
    reply = await client.post(
        f"/api/rooms/{news.id}/messages",
        headers=await _headers(client, observer),
        json={"content": "коммент", "reply_to_message_id": root_id},
    )
    assert reply.status_code == 403, reply.text


async def test_observer_cannot_access_group(
    client: AsyncClient,
    make_user: MakeUser,
    make_room: MakeRoom,
    add_membership: AddMembership,
) -> None:
    admin = await make_user(role="admin")
    observer = await make_user(is_observer=True)
    group = await make_room(created_by=admin.id)
    await add_membership(group.id, observer.id)

    # Ни читать ленту, ни писать в группу наблюдатель не может (dm/group закрыты).
    feed = await client.get(
        f"/api/rooms/{group.id}/messages", headers=await _headers(client, observer)
    )
    assert feed.status_code == 403, feed.text
    send = await client.post(
        f"/api/rooms/{group.id}/messages",
        headers=await _headers(client, observer),
        json={"content": "hi"},
    )
    assert send.status_code == 403, send.text


# --- Закрытые разделы (router-level require_participant) ---------------------


@pytest.mark.parametrize(
    "path",
    [
        "/api/tasks",
        "/api/calendar/events",
        "/api/dynamics/my-stats",
        "/api/notifications",
    ],
)
async def test_observer_sections_forbidden(
    client: AsyncClient,
    make_user: MakeUser,
    path: str,
) -> None:
    observer = await make_user(is_observer=True)
    resp = await client.get(path, headers=await _headers(client, observer))
    assert resp.status_code == 403, f"{path}: {resp.text}"


async def test_participant_sections_allowed(
    client: AsyncClient,
    make_user: MakeUser,
) -> None:
    """Контроль: обычному участнику те же разделы доступны (не сломали остальным)."""
    participant = await make_user()
    for path in ("/api/tasks", "/api/calendar/events", "/api/notifications"):
        resp = await client.get(path, headers=await _headers(client, participant))
        assert resp.status_code == 200, f"{path}: {resp.text}"


async def test_observer_cabin_forbidden_even_if_granted(
    client: AsyncClient,
    make_user: MakeUser,
) -> None:
    observer = await make_user(is_observer=True, can_access_cabin=True)
    resp = await client.get(
        "/api/cabin/diary", headers=await _headers(client, observer)
    )
    assert resp.status_code == 403, resp.text


# --- Уведомления: наблюдатель не адресуется ---------------------------------


async def test_news_post_does_not_notify_observer(
    client: AsyncClient,
    make_user: MakeUser,
    session: AsyncSession,
) -> None:
    admin = await make_user(role="admin")
    observer = await make_user(is_observer=True)
    news = await _news_channel(session, admin)

    await client.post(
        f"/api/rooms/{news.id}/messages",
        headers=await _headers(client, admin),
        json={"content": "новость"},
    )

    count = (
        await session.execute(
            select(func.count())
            .select_from(Notification)
            .where(Notification.user_id == observer.id)
        )
    ).scalar_one()
    assert count == 0


# --- Admin-провижининг флага -------------------------------------------------


async def test_admin_toggles_observer_flag(
    client: AsyncClient,
    make_user: MakeUser,
    session: AsyncSession,
) -> None:
    admin = await make_user(role="admin")
    user = await make_user()

    resp = await client.patch(
        f"/api/admin/users/{user.id}",
        headers=await _headers(client, admin),
        json={"is_observer": True},
    )
    assert resp.status_code == 200, resp.text
    assert resp.json()["is_observer"] is True

    await session.refresh(user)
    assert user.is_observer is True


async def test_admin_cannot_be_observer(
    client: AsyncClient,
    make_user: MakeUser,
) -> None:
    admin = await make_user(role="admin")
    target = await make_user(role="admin")

    # Наблюдатель и админ взаимоисключаемы — 400.
    resp = await client.patch(
        f"/api/admin/users/{target.id}",
        headers=await _headers(client, admin),
        json={"is_observer": True},
    )
    assert resp.status_code == 400, resp.text


async def test_promoting_observer_to_admin_requires_clearing_flag(
    client: AsyncClient,
    make_user: MakeUser,
) -> None:
    admin = await make_user(role="admin")
    observer = await make_user(is_observer=True)

    # role=admin при оставшемся is_observer=true → 400 (итоговое состояние противоречиво).
    conflict = await client.patch(
        f"/api/admin/users/{observer.id}",
        headers=await _headers(client, admin),
        json={"role": "admin"},
    )
    assert conflict.status_code == 400, conflict.text

    # Снять флаг и повысить в одном запросе — ок.
    ok = await client.patch(
        f"/api/admin/users/{observer.id}",
        headers=await _headers(client, admin),
        json={"role": "admin", "is_observer": False},
    )
    assert ok.status_code == 200, ok.text
    assert ok.json()["role"] == "admin"
    assert ok.json()["is_observer"] is False


async def test_me_exposes_is_observer(
    client: AsyncClient,
    make_user: MakeUser,
) -> None:
    observer = await make_user(is_observer=True)
    resp = await client.get("/api/auth/me", headers=await _headers(client, observer))
    assert resp.status_code == 200, resp.text
    assert resp.json()["is_observer"] is True
