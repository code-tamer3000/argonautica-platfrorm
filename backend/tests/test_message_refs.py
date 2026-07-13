"""Тесты ссылок-референсов из сообщений на материал КБ / задачу.

Отправка проверяет видимость цели отправителю (анти-IDOR, CLAUDE.md п.1): нельзя
сослаться на черновик КБ / чужую индивидуальную задачу. На чтении `ref.available`/
`ref.title` считаются для зрителя — снятая с публикации / чужая цель отдаётся как
недоступная и без заголовка. Ссылка живёт рядом с медиа (можно и то, и другое).
"""
from httpx import AsyncClient
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.media import MediaAsset
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


async def _send(
    client: AsyncClient, headers: dict[str, str], room_id: int, **body: object
) -> tuple[int, dict]:
    resp = await client.post(
        f"/api/rooms/{room_id}/messages", headers=headers, json=body
    )
    return resp.status_code, (resp.json() if resp.content else {})


async def _kb_item(
    client: AsyncClient, admin_h: dict[str, str], *, title: str, published: bool
) -> dict:
    resp = await client.post(
        "/api/kb/items", headers=admin_h, json={"title": title}
    )
    assert resp.status_code == 201, resp.text
    item = resp.json()
    if published:
        r = await client.patch(
            f"/api/kb/items/{item['id']}", headers=admin_h, json={"published": True}
        )
        assert r.status_code == 200, r.text
        item = r.json()
    return item


async def _task(
    client: AsyncClient, admin_h: dict[str, str], **body: object
) -> dict:
    resp = await client.post("/api/tasks", headers=admin_h, json=body)
    assert resp.status_code == 201, resp.text
    return resp.json()


async def _make_asset(session: AsyncSession, owner_id: int) -> MediaAsset:
    asset = MediaAsset(
        bucket="chat-media",
        storage_key="2026/07/x.png",
        kind="image",
        mime_type="image/png",
        size=10,
        created_by=owner_id,
    )
    session.add(asset)
    await session.commit()
    await session.refresh(asset)
    return asset


# --- отправка: видимость цели ----------------------------------------------


async def test_send_ref_to_published_kb_item(
    client: AsyncClient,
    make_user: MakeUser,
    make_room: MakeRoom,
    add_membership: AddMembership,
) -> None:
    admin = await make_user(role="admin")
    room = await make_room(created_by=admin.id)
    await add_membership(room.id, admin.id, "owner")
    admin_h = await _headers(client, admin)

    item = await _kb_item(client, admin_h, title="Материал", published=True)
    code, msg = await _send(
        client, admin_h, room.id, content="смотри", ref_kind="kb", ref_id=item["id"]
    )
    assert code == 201, msg
    assert msg["ref"] == {
        "kind": "kb",
        "id": item["id"],
        "title": "Материал",
        "url": f"/kb/{item['id']}",
        "available": True,
    }


async def test_send_ref_to_kb_draft_forbidden_for_participant(
    client: AsyncClient,
    make_user: MakeUser,
    make_room: MakeRoom,
    add_membership: AddMembership,
) -> None:
    admin = await make_user(role="admin")
    member = await make_user()
    room = await make_room(created_by=admin.id)
    await add_membership(room.id, admin.id, "owner")
    await add_membership(room.id, member.id, "member")
    admin_h = await _headers(client, admin)
    member_h = await _headers(client, member)

    draft = await _kb_item(client, admin_h, title="Черновик", published=False)
    code, _ = await _send(
        client, member_h, room.id, content="hi", ref_kind="kb", ref_id=draft["id"]
    )
    assert code == 404  # существование черновика не раскрываем


async def test_send_ref_to_common_task(
    client: AsyncClient,
    make_user: MakeUser,
    make_room: MakeRoom,
    add_membership: AddMembership,
) -> None:
    admin = await make_user(role="admin")
    member = await make_user()
    room = await make_room(created_by=admin.id)
    await add_membership(room.id, member.id, "member")
    admin_h = await _headers(client, admin)
    member_h = await _headers(client, member)

    task = await _task(client, admin_h, type="common", title="Общая")
    code, msg = await _send(
        client, member_h, room.id, content="задача", ref_kind="task", ref_id=task["id"]
    )
    assert code == 201, msg
    assert msg["ref"]["available"] is True
    assert msg["ref"]["title"] == "Общая"
    assert msg["ref"]["url"] == f"/tasks/{task['id']}"


async def test_send_ref_to_others_individual_task_forbidden(
    client: AsyncClient,
    make_user: MakeUser,
    make_room: MakeRoom,
    add_membership: AddMembership,
) -> None:
    admin = await make_user(role="admin")
    assignee = await make_user()
    outsider = await make_user()
    room = await make_room(created_by=admin.id)
    await add_membership(room.id, outsider.id, "member")
    admin_h = await _headers(client, admin)
    outsider_h = await _headers(client, outsider)

    task = await _task(
        client, admin_h, type="individual", title="Личная", assignee_ids=[assignee.id]
    )
    code, _ = await _send(
        client, outsider_h, room.id, content="x", ref_kind="task", ref_id=task["id"]
    )
    assert code == 404


# --- валидация тела ---------------------------------------------------------


async def test_ref_kind_without_id_is_422(
    client: AsyncClient,
    make_user: MakeUser,
    make_room: MakeRoom,
    add_membership: AddMembership,
) -> None:
    admin = await make_user(role="admin")
    room = await make_room(created_by=admin.id)
    await add_membership(room.id, admin.id, "owner")
    admin_h = await _headers(client, admin)

    resp = await client.post(
        f"/api/rooms/{room.id}/messages",
        headers=admin_h,
        json={"content": "hi", "ref_kind": "kb"},
    )
    assert resp.status_code == 422


async def test_ref_only_message_carries_something(
    client: AsyncClient,
    make_user: MakeUser,
    make_room: MakeRoom,
    add_membership: AddMembership,
) -> None:
    """Ссылка без текста — валидное сообщение (несёт ref)."""
    admin = await make_user(role="admin")
    room = await make_room(created_by=admin.id)
    await add_membership(room.id, admin.id, "owner")
    admin_h = await _headers(client, admin)

    item = await _kb_item(client, admin_h, title="Только ссылка", published=True)
    code, msg = await _send(client, admin_h, room.id, ref_kind="kb", ref_id=item["id"])
    assert code == 201, msg
    assert msg["content"] is None
    assert msg["ref"]["id"] == item["id"]


# --- ссылка + медиа вместе --------------------------------------------------


async def test_ref_and_media_together(
    client: AsyncClient,
    make_user: MakeUser,
    make_room: MakeRoom,
    add_membership: AddMembership,
    session: AsyncSession,
) -> None:
    admin = await make_user(role="admin")
    room = await make_room(created_by=admin.id)
    await add_membership(room.id, admin.id, "owner")
    admin_h = await _headers(client, admin)

    item = await _kb_item(client, admin_h, title="M", published=True)
    asset = await _make_asset(session, admin.id)
    code, msg = await _send(
        client,
        admin_h,
        room.id,
        content="и файл, и ссылка",
        ref_kind="kb",
        ref_id=item["id"],
        attachment_ids=[asset.id],
    )
    assert code == 201, msg
    assert msg["ref"]["id"] == item["id"]
    assert msg["attachment_ids"] == [asset.id]


# --- чтение: видимость на зрителя -------------------------------------------


async def test_unpublished_after_send_reads_as_unavailable(
    client: AsyncClient,
    make_user: MakeUser,
    make_room: MakeRoom,
    add_membership: AddMembership,
) -> None:
    admin = await make_user(role="admin")
    member = await make_user()
    room = await make_room(created_by=admin.id)
    await add_membership(room.id, admin.id, "owner")
    await add_membership(room.id, member.id, "member")
    admin_h = await _headers(client, admin)
    member_h = await _headers(client, member)

    item = await _kb_item(client, admin_h, title="Секрет", published=True)
    await _send(client, admin_h, room.id, content="ref", ref_kind="kb", ref_id=item["id"])

    # Сняли с публикации.
    r = await client.patch(
        f"/api/kb/items/{item['id']}", headers=admin_h, json={"published": False}
    )
    assert r.status_code == 200, r.text

    # Участник видит сообщение, но ссылка недоступна и без заголовка.
    feed = await client.get(f"/api/rooms/{room.id}/messages", headers=member_h)
    assert feed.status_code == 200, feed.text
    (item_msg,) = [m for m in feed.json() if m["ref"] is not None]
    assert item_msg["ref"]["available"] is False
    assert item_msg["ref"]["title"] == "Недоступно"
    # Админ (автор) по-прежнему видит заголовок.
    feed_admin = await client.get(f"/api/rooms/{room.id}/messages", headers=admin_h)
    (admin_msg,) = [m for m in feed_admin.json() if m["ref"] is not None]
    assert admin_msg["ref"]["available"] is True
    assert admin_msg["ref"]["title"] == "Секрет"


# --- репост переносит ссылку ------------------------------------------------


async def test_repost_carries_ref(
    client: AsyncClient,
    make_user: MakeUser,
    make_room: MakeRoom,
    add_membership: AddMembership,
) -> None:
    admin = await make_user(role="admin")
    room = await make_room(created_by=admin.id)
    await add_membership(room.id, admin.id, "owner")
    admin_h = await _headers(client, admin)

    item = await _kb_item(client, admin_h, title="Репостнутый", published=True)
    _, msg = await _send(
        client, admin_h, room.id, content="src", ref_kind="kb", ref_id=item["id"]
    )
    resp = await client.post(
        f"/api/rooms/{room.id}/messages/{msg['id']}/repost", headers=admin_h
    )
    assert resp.status_code == 201, resp.text
    reposted = resp.json()
    assert reposted["ref"]["id"] == item["id"]
    assert reposted["ref"]["kind"] == "kb"
    assert reposted["ref"]["available"] is True
