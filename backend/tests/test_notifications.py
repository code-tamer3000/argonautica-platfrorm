"""Уведомления: личка → пиру, ответ в тред → автору корня, пост в новостях → всем;
себе не шлём; отметка прочитанными гасит счётчик; незакрытый день дневника → системное."""
from datetime import UTC, datetime, timedelta

import pytest
from httpx import AsyncClient
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import settings
from app.models.journal import JournalPardon
from app.models.message import Message
from app.models.notification import Notification
from app.models.room import Room
from app.models.user import User

from .conftest import AddMembership, MakeRoom, MakeUser, auth_headers, login


async def _headers(client: AsyncClient, user: User) -> dict[str, str]:
    tokens = await login(client, user.username, "initpass123")
    return auth_headers(tokens["access_token"])


def _patch_timeline_start(monkeypatch: pytest.MonkeyPatch, start_date: object) -> None:
    """Заставить шкалу заданий стартовать в start_date с разделами focus/notes/film.

    program_start теперь берётся из БД-шкалы (сид-задание с 2026-07-03), а не из
    settings, поэтому тесты, которым нужен один завершённый день, подменяют шкалу.
    """
    from app.api import dynamics as dyn

    keys = ("focus", "notes", "film")
    version = dyn.ProgramVersion(
        starts_on=start_date,  # type: ignore[arg-type]
        keys=frozenset(keys),
        order={k: i for i, k in enumerate(keys)},
    )

    async def _fake(_session: object) -> list["dyn.ProgramVersion"]:
        return [version]

    monkeypatch.setattr(dyn, "load_timeline", _fake)


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


# --- незакрытый день дневника (journal_missed) -----------------------------


async def _make_personal(session: AsyncSession, user: User) -> Room:
    room = Room(type="channel", is_personal=True, created_by=user.id, name="Дневник")
    session.add(room)
    await session.commit()
    await session.refresh(room)
    return room


def _journal_msg(room_id: int, sender_id: int, cat: str, day) -> Message:
    return Message(
        room_id=room_id,
        sender_id=sender_id,
        content=f"<!--journal:{cat}-->запись",
        created_at=datetime(day.year, day.month, day.day, 12, tzinfo=UTC),
    )


async def test_journal_missed_notification_for_yesterday(
    client: AsyncClient,
    make_user: MakeUser,
    session: AsyncSession,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    today = datetime.now(UTC).date()
    yesterday = today - timedelta(days=1)
    monkeypatch.setattr(settings, "journal_program_start", today - timedelta(days=3))

    user = await make_user()
    await _make_personal(session, user)

    data = await _notifications(client, await _headers(client, user))
    missed = [i for i in data["items"] if i["kind"] == "journal_missed"]
    # Есть уведомление именно про вчерашний день, у него нет автора.
    y = next((i for i in missed if i["ref_date"] == yesterday.isoformat()), None)
    assert y is not None, data
    assert y["actor_id"] is None
    assert y["message_id"] is None
    assert y["preview"]


async def test_journal_missed_is_idempotent(
    client: AsyncClient,
    make_user: MakeUser,
    session: AsyncSession,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    today = datetime.now(UTC).date()
    monkeypatch.setattr(settings, "journal_program_start", today - timedelta(days=3))
    user = await make_user()
    await _make_personal(session, user)

    h = await _headers(client, user)
    await _notifications(client, h)
    first = (
        await session.execute(
            select(func.count())
            .select_from(Notification)
            .where(Notification.user_id == user.id, Notification.kind == "journal_missed")
        )
    ).scalar_one()
    # Повторный запрос не плодит дубли.
    await _notifications(client, h)
    second = (
        await session.execute(
            select(func.count())
            .select_from(Notification)
            .where(Notification.user_id == user.id, Notification.kind == "journal_missed")
        )
    ).scalar_one()
    assert first > 0
    assert first == second


async def test_journal_missed_skips_closed_day(
    client: AsyncClient,
    make_user: MakeUser,
    session: AsyncSession,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    today = datetime.now(UTC).date()
    yesterday = today - timedelta(days=1)
    # Программа стартовала вчера — единственный завершённый день = вчера.
    _patch_timeline_start(monkeypatch, yesterday)

    user = await make_user()
    room = await _make_personal(session, user)
    # Закрываем вчерашний день всеми тремя категориями.
    for cat in ("focus", "notes", "film"):
        session.add(_journal_msg(room.id, user.id, cat, yesterday))
    await session.commit()

    data = await _notifications(client, await _headers(client, user))
    assert [i for i in data["items"] if i["kind"] == "journal_missed"] == []


async def test_journal_missed_skips_pardoned_day(
    client: AsyncClient,
    make_user: MakeUser,
    session: AsyncSession,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    today = datetime.now(UTC).date()
    yesterday = today - timedelta(days=1)
    _patch_timeline_start(monkeypatch, yesterday)

    user = await make_user()
    await _make_personal(session, user)
    session.add(JournalPardon(user_id=user.id, date=yesterday))
    await session.commit()

    data = await _notifications(client, await _headers(client, user))
    assert [i for i in data["items"] if i["kind"] == "journal_missed"] == []
