"""Web Push: настройки-фильтр (push_allowed), регистрация подписок, админ-рассылка.

Отправку самого push (pywebpush по сети) здесь не гоняем — в тестовом окружении
ключи VAPID не заданы, поэтому enqueue_push — no-op. Проверяем контракт вокруг:
идемпотентную подписку/отписку, 503 без ключей, и что рассылка кладёт строку
в ленту каждому пользователю (in-app), возвращая число адресатов.
"""
import pytest
from httpx import AsyncClient
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import settings
from app.models.notification import Notification
from app.models.push import PushSubscription
from app.models.user import User
from app.services import push as push_service
from app.services.notify_prefs import push_allowed

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


# ── push_allowed: чистая логика тумблеров ──────────────────────────────────


def test_push_allowed_defaults_to_true() -> None:
    # Пустые настройки / нет узла notifications → всё включено (opt-out модель).
    assert push_allowed(None, "dm") is True
    assert push_allowed({}, "news") is True
    assert push_allowed({"notifications": {}}, "reply") is True


def test_push_allowed_master_switch_off_blocks_everything() -> None:
    settings_off = {"notifications": {"push_enabled": False, "dm": True}}
    assert push_allowed(settings_off, "dm") is False
    assert push_allowed(settings_off, "cabin_granted") is False


def test_push_allowed_per_kind_toggle() -> None:
    s = {"notifications": {"push_enabled": True, "news": False}}
    assert push_allowed(s, "dm") is True
    assert push_allowed(s, "news") is False


# ── VAPID key endpoint ─────────────────────────────────────────────────────


@pytest.mark.asyncio
async def test_vapid_key_503_when_unconfigured(
    client: AsyncClient, make_user: MakeUser
) -> None:
    user = await make_user()
    headers = await _headers(client, user)
    resp = await client.get("/api/push/vapid-key", headers=headers)
    assert resp.status_code == 503


@pytest.mark.asyncio
async def test_vapid_key_returned_when_configured(
    client: AsyncClient, make_user: MakeUser, monkeypatch: pytest.MonkeyPatch
) -> None:
    monkeypatch.setattr(settings, "vapid_public_key", "PUBKEY")
    monkeypatch.setattr(settings, "vapid_private_key", "PRIVKEY")
    user = await make_user()
    headers = await _headers(client, user)
    resp = await client.get("/api/push/vapid-key", headers=headers)
    assert resp.status_code == 200
    assert resp.json() == {"public_key": "PUBKEY"}


# ── subscribe / unsubscribe ────────────────────────────────────────────────


def _sub_body(endpoint: str = "https://push.example/abc") -> dict:
    return {
        "endpoint": endpoint,
        "keys": {"p256dh": "p256dh-key", "auth": "auth-key"},
        "user_agent": "pytest",
    }


@pytest.mark.asyncio
async def test_subscribe_persists_and_is_idempotent(
    client: AsyncClient,
    make_user: MakeUser,
    session: AsyncSession,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setattr(settings, "vapid_public_key", "PUBKEY")
    monkeypatch.setattr(settings, "vapid_private_key", "PRIVKEY")
    user = await make_user()
    headers = await _headers(client, user)

    r1 = await client.post("/api/push/subscribe", headers=headers, json=_sub_body())
    assert r1.status_code == 204
    r2 = await client.post("/api/push/subscribe", headers=headers, json=_sub_body())
    assert r2.status_code == 204  # тот же endpoint — не дубль

    count = await session.scalar(
        select(func.count())
        .select_from(PushSubscription)
        .where(PushSubscription.user_id == user.id)
    )
    assert count == 1


@pytest.mark.asyncio
async def test_unsubscribe_removes_only_own(
    client: AsyncClient,
    make_user: MakeUser,
    session: AsyncSession,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setattr(settings, "vapid_public_key", "PUBKEY")
    monkeypatch.setattr(settings, "vapid_private_key", "PRIVKEY")
    user = await make_user()
    headers = await _headers(client, user)
    endpoint = "https://push.example/mine"
    await client.post("/api/push/subscribe", headers=headers, json=_sub_body(endpoint))

    resp = await client.post(
        "/api/push/unsubscribe", headers=headers, json={"endpoint": endpoint}
    )
    assert resp.status_code == 204
    # Тестовая БД общая между тестами (нет отката) — считаем только свои строки.
    count = await session.scalar(
        select(func.count())
        .select_from(PushSubscription)
        .where(PushSubscription.user_id == user.id)
    )
    assert count == 0


@pytest.mark.asyncio
async def test_subscribe_requires_auth(client: AsyncClient) -> None:
    resp = await client.post("/api/push/subscribe", json=_sub_body())
    assert resp.status_code == 401


# ── admin broadcast ────────────────────────────────────────────────────────


@pytest.mark.asyncio
async def test_admin_broadcast_notifies_all_users(
    client: AsyncClient, make_user: MakeUser, session: AsyncSession
) -> None:
    admin = await make_user(role="admin")
    u1 = await make_user()
    u2 = await make_user()
    headers = await _headers(client, admin)

    resp = await client.post(
        "/api/admin/notifications/broadcast",
        headers=headers,
        json={"title": "Плановые работы", "body": "Сегодня в 22:00"},
    )
    assert resp.status_code == 202, resp.text
    # Тестовая БД общая (без отката), пользователей может быть больше — рассылка
    # идёт всем, поэтому адресатов не меньше наших трёх (включая самого админа).
    assert resp.json()["recipients"] >= 3

    for uid in (admin.id, u1.id, u2.id):
        row = await session.scalar(
            select(Notification).where(
                Notification.user_id == uid, Notification.kind == "admin"
            )
        )
        assert row is not None
        assert row.title == "Плановые работы"
        assert row.body == "Сегодня в 22:00"


@pytest.mark.asyncio
async def test_admin_broadcast_shows_in_feed_with_title(
    client: AsyncClient, make_user: MakeUser
) -> None:
    admin = await make_user(role="admin")
    recipient = await make_user()
    admin_headers = await _headers(client, admin)
    await client.post(
        "/api/admin/notifications/broadcast",
        headers=admin_headers,
        json={"title": "Важно", "body": "Текст объявления"},
    )

    headers = await _headers(client, recipient)
    feed = (await client.get("/api/notifications", headers=headers)).json()
    admin_items = [n for n in feed["items"] if n["kind"] == "admin"]
    assert len(admin_items) == 1
    assert admin_items[0]["title"] == "Важно"
    assert admin_items[0]["preview"] == "Текст объявления"


@pytest.mark.asyncio
async def test_admin_broadcast_forbidden_for_participant(
    client: AsyncClient, make_user: MakeUser
) -> None:
    user = await make_user()
    headers = await _headers(client, user)
    resp = await client.post(
        "/api/admin/notifications/broadcast",
        headers=headers,
        json={"title": "x", "body": "y"},
    )
    assert resp.status_code == 403


# ── push wiring: enqueue вызывается по новому сообщению с учётом тумблеров ────


@pytest.mark.asyncio
async def test_dm_enqueues_push_when_allowed(
    client: AsyncClient,
    make_user: MakeUser,
    make_room: MakeRoom,
    add_membership: AddMembership,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    calls: list[tuple[int, dict]] = []
    monkeypatch.setattr(
        push_service, "enqueue_push", lambda uid, payload: calls.append((uid, payload))
    )

    a = await make_user()
    b = await make_user()
    room = await make_room(created_by=a.id, type="dm", name=None)
    await add_membership(room.id, a.id)
    await add_membership(room.id, b.id)

    resp = await client.post(
        f"/api/rooms/{room.id}/messages",
        headers=await _headers(client, a),
        json={"content": "привет"},
    )
    assert resp.status_code == 201, resp.text

    # Push поставлен ровно получателю b (не автору a).
    assert [uid for uid, _ in calls] == [b.id]
    assert calls[0][1]["body"] == "привет"


@pytest.mark.asyncio
async def test_dm_skips_push_when_recipient_disabled_dm(
    client: AsyncClient,
    make_user: MakeUser,
    make_room: MakeRoom,
    add_membership: AddMembership,
    session: AsyncSession,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    calls: list[int] = []
    monkeypatch.setattr(
        push_service, "enqueue_push", lambda uid, payload: calls.append(uid)
    )

    a = await make_user()
    b = await make_user()
    # b выключил push на личные сообщения.
    b.settings = {"notifications": {"push_enabled": True, "dm": False}}
    await session.commit()

    room = await make_room(created_by=a.id, type="dm", name=None)
    await add_membership(room.id, a.id)
    await add_membership(room.id, b.id)

    resp = await client.post(
        f"/api/rooms/{room.id}/messages",
        headers=await _headers(client, a),
        json={"content": "привет"},
    )
    assert resp.status_code == 201, resp.text

    # In-app уведомление всё равно создано, а вот native push — нет.
    inapp = await session.scalar(
        select(func.count())
        .select_from(Notification)
        .where(Notification.user_id == b.id, Notification.kind == "dm")
    )
    assert inapp == 1
    assert calls == []
