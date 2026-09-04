"""Уведомления: личка → пиру, ответ в тред → автору корня, пост в новостях → всем;
себе не шлём; отметка прочитанными гасит счётчик."""
from datetime import UTC, datetime, timedelta

import pytest
from httpx import AsyncClient
from sqlalchemy import func, select, update
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.notification import Notification
from app.models.user import User
from app.services.rooms import ensure_news_channel
from app.services.visibility import CHEAP_TARIFF_NAME

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


async def _create_plan(client: AsyncClient, headers: dict[str, str], name: str) -> int:
    resp = await client.post(
        "/api/admin/plans", headers=headers, json={"name": name, "price": 1000}
    )
    assert resp.status_code == 201, resp.text
    return int(resp.json()["id"])


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

    # Новостной канал потока участника (ARG-104 — один на intake, не singleton).
    news = await ensure_news_channel(session, participant.intake_id)
    await session.commit()

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


_ZOOM_TEXT = "Эфир в 20:00\nhttps://us06web.zoom.us/j/86812929090?pwd=Zy533wnP"


async def test_news_notification_feed_redacts_zoom_link_for_cheap_tariff(
    client: AsyncClient,
    make_user: MakeUser,
    session: AsyncSession,
) -> None:
    """ARG-116: REST-лента уведомлений — тот же плейсхолдер, что в самой Рубке (ARG-115)."""
    admin = await make_user(role="admin")
    admin_h = await _headers(client, admin)
    news = await ensure_news_channel(session, admin.intake_id)
    await session.commit()

    cheap_plan = await _create_plan(client, admin_h, CHEAP_TARIFF_NAME)
    cheap_viewer = await make_user(intake_id=admin.intake_id, plan_id=cheap_plan)
    regular_viewer = await make_user(intake_id=admin.intake_id)

    await _send(client, admin_h, news.id, content=_ZOOM_TEXT)

    cheap_data = await _notifications(client, await _headers(client, cheap_viewer))
    cheap_news = next(i for i in cheap_data["items"] if i["kind"] == "news")
    assert "zoom.us" not in cheap_news["preview"]
    assert "Эфир в 20:00" in cheap_news["preview"]

    regular_data = await _notifications(client, await _headers(client, regular_viewer))
    regular_news = next(i for i in regular_data["items"] if i["kind"] == "news")
    assert "zoom.us" in regular_news["preview"]


async def test_news_notification_live_event_redacts_only_for_cheap_tariff_recipient(
    client: AsyncClient,
    make_user: MakeUser,
    session: AsyncSession,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """ARG-116: живая рассылка (on_new_message) считает preview один раз на все
    получателей — регресс-тест на то, что per-получателю всё равно расходится
    правильно (WS notification.new к дешёвому тарифу редактирован, к обычному — нет)."""
    admin = await make_user(role="admin")
    admin_h = await _headers(client, admin)
    news = await ensure_news_channel(session, admin.intake_id)
    await session.commit()

    cheap_plan = await _create_plan(client, admin_h, CHEAP_TARIFF_NAME)
    cheap_viewer = await make_user(intake_id=admin.intake_id, plan_id=cheap_plan)
    regular_viewer = await make_user(intake_id=admin.intake_id)

    published: list[tuple[int, dict[str, object]]] = []

    async def _spy(user_id: int, event: dict[str, object]) -> None:
        published.append((user_id, event))

    monkeypatch.setattr("app.services.notifications.publish_user_event", _spy)

    await _send(client, admin_h, news.id, content=_ZOOM_TEXT)

    by_user = {uid: event for uid, event in published}
    cheap_preview = by_user[cheap_viewer.id]["notification"]["preview"]
    regular_preview = by_user[regular_viewer.id]["notification"]["preview"]
    assert "zoom.us" not in cheap_preview
    assert "zoom.us" in regular_preview


async def test_mention_notifies_group_member(
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

    await _send(
        client, await _headers(client, a), room.id, content=f"эй @{b.username} глянь"
    )

    data = await _notifications(client, await _headers(client, b))
    assert data["unread_count"] == 1
    item = data["items"][0]
    assert item["kind"] == "mention"
    assert item["actor_id"] == a.id
    assert item["room_id"] == room.id


async def test_mention_is_case_insensitive(
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

    # Ник в верхнем регистре в тексте — совпадение регистронезависимо.
    await _send(
        client, await _headers(client, a), room.id, content=f"привет @{b.username.upper()}"
    )

    data = await _notifications(client, await _headers(client, b))
    assert data["unread_count"] == 1
    assert data["items"][0]["kind"] == "mention"


async def test_mention_of_non_member_is_ignored(
    client: AsyncClient,
    make_user: MakeUser,
    make_room: MakeRoom,
    add_membership: AddMembership,
    session: AsyncSession,
) -> None:
    a = await make_user()
    b = await make_user()
    outsider = await make_user()
    room = await make_room(created_by=a.id)
    await add_membership(room.id, a.id, "owner")
    await add_membership(room.id, b.id)

    await _send(
        client, await _headers(client, a), room.id, content=f"@{outsider.username} ау"
    )

    # Аутсайдер не в комнате — уведомление ему не уходит (IDOR).
    assert await _db_count(session, outsider.id) == 0


async def test_self_mention_creates_no_notification(
    client: AsyncClient,
    make_user: MakeUser,
    make_room: MakeRoom,
    add_membership: AddMembership,
    session: AsyncSession,
) -> None:
    a = await make_user()
    room = await make_room(created_by=a.id)
    await add_membership(room.id, a.id, "owner")

    await _send(
        client, await _headers(client, a), room.id, content=f"напоминалка @{a.username}"
    )

    assert await _db_count(session, a.id) == 0


async def test_reply_wins_over_mention_no_double_notify(
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

    ha = await _headers(client, a)
    hb = await _headers(client, b)
    root = await _send(client, ha, room.id, content="root")
    before = await _db_count(session, a.id)
    # B отвечает на корень A и заодно упоминает A в тексте — ровно одно уведомление,
    # вид 'reply' (приоритетнее mention).
    await _send(
        client, hb, room.id, content=f"@{a.username} вот", reply_to_message_id=root["id"]
    )

    data = await _notifications(client, ha)
    assert data["items"][0]["kind"] == "reply"
    assert await _db_count(session, a.id) == before + 1


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


async def test_feed_drops_notifications_read_over_48h_ago(
    client: AsyncClient,
    make_user: MakeUser,
    make_room: MakeRoom,
    add_membership: AddMembership,
    session: AsyncSession,
) -> None:
    a = await make_user()
    b = await make_user()
    room = await make_room(created_by=a.id, type="dm", name=None)
    await add_membership(room.id, a.id)
    await add_membership(room.id, b.id)

    ha = await _headers(client, a)
    hb = await _headers(client, b)

    # Старое: b получает уведомление, читает его прямо сейчас, но помечаем read_at
    # так, будто это случилось больше 48 часов назад.
    await _send(client, ha, room.id, content="old ping")
    old_id = (await _notifications(client, hb))["items"][0]["id"]
    await client.post("/api/notifications/read", headers=hb, json={"up_to_id": old_id})
    stale_read_at = datetime.now(UTC) - timedelta(hours=49)
    await session.execute(
        update(Notification).where(Notification.id == old_id).values(read_at=stale_read_at)
    )
    await session.commit()

    # Свежее: новое уведомление, прочитанное только что.
    await _send(client, ha, room.id, content="fresh ping")
    fresh_id = (await _notifications(client, hb))["items"][0]["id"]
    await client.post("/api/notifications/read", headers=hb, json={"up_to_id": fresh_id})

    data = await _notifications(client, hb)
    ids = [item["id"] for item in data["items"]]
    assert fresh_id in ids
    assert old_id not in ids
    assert data["unread_count"] == 0

    # Строка никуда не делась из БД — фильтр только в выдаче.
    assert await session.scalar(
        select(func.count()).select_from(Notification).where(Notification.id == old_id)
    ) == 1


async def test_preview_strips_inline_formatting_marks(
    client: AsyncClient,
    make_user: MakeUser,
    make_room: MakeRoom,
    add_membership: AddMembership,
) -> None:
    """Превью в колокольчике/push — обычный текст: маркеры **/*/++ панели
    форматирования (frontend/src/features/chat/useTextFormatting.tsx) не рендерятся
    нигде на бэкенде, значит не должны утекать в превью как сырые символы."""
    a = await make_user()
    b = await make_user()
    room = await make_room(created_by=a.id, type="dm", name=None)
    await add_membership(room.id, a.id)
    await add_membership(room.id, b.id)

    await _send(
        client,
        await _headers(client, a),
        room.id,
        content="**жирный** и *курсив* и ++подчёркнутый++ текст",
    )

    data = await _notifications(client, await _headers(client, b))
    item = data["items"][0]
    assert item["preview"] == "жирный и курсив и подчёркнутый текст"


async def test_bold_mention_still_notifies(
    client: AsyncClient,
    make_user: MakeUser,
    make_room: MakeRoom,
    add_membership: AddMembership,
) -> None:
    """@упоминание внутри жирного (**@user**) — маркер стоит впритык к @, серверный
    парсер упоминаний (_MENTION_RE) требует лишь «не словесный символ перед @», а `*`
    им не является — регрессия не должна возникнуть при добавлении разметки."""
    a = await make_user()
    b = await make_user()
    room = await make_room(created_by=a.id)
    await add_membership(room.id, a.id, "owner")
    await add_membership(room.id, b.id)

    await _send(
        client, await _headers(client, a), room.id, content=f"**@{b.username}** глянь"
    )

    data = await _notifications(client, await _headers(client, b))
    assert data["unread_count"] == 1
    item = data["items"][0]
    assert item["kind"] == "mention"
    assert item["actor_id"] == a.id
