"""Тесты сообщений и тредов: плоскость, denorm reply_count, лента, доступ,
мягкое удаление, статусы прочтения и ленивое членство в каналах."""
from httpx import AsyncClient
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.media import MediaAsset
from app.models.message import MessageAttachment
from app.models.room import Room, RoomMember
from app.models.sticker import Sticker, Stickerpack
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
) -> dict:
    resp = await client.post(
        f"/api/rooms/{room_id}/messages", headers=headers, json=body
    )
    assert resp.status_code == 201, resp.text
    return resp.json()


async def _membership_count(
    session: AsyncSession, room_id: int, user_id: int
) -> int:
    return (
        await session.execute(
            select(func.count())
            .select_from(RoomMember)
            .where(RoomMember.room_id == room_id, RoomMember.user_id == user_id)
        )
    ).scalar_one()


# --- треды -----------------------------------------------------------------


async def test_thread_reply_is_flat(
    client: AsyncClient,
    make_user: MakeUser,
    make_room: MakeRoom,
    add_membership: AddMembership,
) -> None:
    owner = await make_user()
    room = await make_room(created_by=owner.id)
    await add_membership(room.id, owner.id, "owner")
    headers = await _headers(client, owner)

    root = await _send(client, headers, room.id, content="root")
    reply = await _send(
        client, headers, room.id, content="reply", reply_to_message_id=root["id"]
    )
    assert reply["thread_root_id"] == root["id"]

    # Ответ на ОТВЕТ привязывается к КОРНЮ, а не к id ответа (плоскость).
    nested = await _send(
        client, headers, room.id, content="nested", reply_to_message_id=reply["id"]
    )
    assert nested["thread_root_id"] == root["id"]


async def test_reply_count_grows(
    client: AsyncClient,
    make_user: MakeUser,
    make_room: MakeRoom,
    add_membership: AddMembership,
) -> None:
    owner = await make_user()
    room = await make_room(created_by=owner.id)
    await add_membership(room.id, owner.id, "owner")
    headers = await _headers(client, owner)

    root = await _send(client, headers, room.id, content="root")
    await _send(client, headers, room.id, content="r1", reply_to_message_id=root["id"])
    await _send(client, headers, room.id, content="r2", reply_to_message_id=root["id"])

    resp = await client.get(
        f"/api/rooms/{room.id}/messages/{root['id']}/thread", headers=headers
    )
    assert resp.status_code == 200
    body = resp.json()
    assert body["root"]["reply_count"] == 2
    assert body["root"]["last_reply_at"] is not None
    assert len(body["replies"]) == 2


async def test_unread_reply_count_in_feed(
    client: AsyncClient,
    make_user: MakeUser,
    make_room: MakeRoom,
    add_membership: AddMembership,
) -> None:
    owner = await make_user()
    reader = await make_user()
    room = await make_room(created_by=owner.id)
    await add_membership(room.id, owner.id, "owner")
    await add_membership(room.id, reader.id, "member")
    oh = await _headers(client, owner)
    rh = await _headers(client, reader)

    root = await _send(client, oh, room.id, content="root")
    r1 = await _send(client, oh, room.id, content="r1", reply_to_message_id=root["id"])

    # reader ставит курсор прочтения на первый ответ → он не «новый».
    resp = await client.post(
        f"/api/rooms/{room.id}/read",
        headers=rh,
        json={"last_read_message_id": r1["id"]},
    )
    assert resp.status_code == 200

    # Ещё два ответа приходят после курсора reader'а — их и считаем новыми.
    await _send(client, oh, room.id, content="r2", reply_to_message_id=root["id"])
    r3 = await _send(client, oh, room.id, content="r3", reply_to_message_id=root["id"])

    feed = await client.get(f"/api/rooms/{room.id}/messages", headers=rh)
    assert feed.status_code == 200
    root_item = next(m for m in feed.json() if m["id"] == root["id"])
    assert root_item["reply_count"] == 3
    assert root_item["unread_reply_count"] == 2

    # После прочтения вплоть до последнего ответа — непрочитанных не остаётся.
    all_read = await client.post(
        f"/api/rooms/{room.id}/read",
        headers=rh,
        json={"last_read_message_id": r3["id"]},
    )
    assert all_read.status_code == 200
    feed2 = await client.get(f"/api/rooms/{room.id}/messages", headers=rh)
    root_item2 = next(m for m in feed2.json() if m["id"] == root["id"])
    assert root_item2["unread_reply_count"] == 0


# --- лента -----------------------------------------------------------------


async def test_feed_excludes_deleted_and_thread_replies(
    client: AsyncClient,
    make_user: MakeUser,
    make_room: MakeRoom,
    add_membership: AddMembership,
) -> None:
    owner = await make_user()
    room = await make_room(created_by=owner.id)
    await add_membership(room.id, owner.id, "owner")
    headers = await _headers(client, owner)

    root1 = await _send(client, headers, room.id, content="root1")
    root2 = await _send(client, headers, room.id, content="root2")
    await _send(client, headers, room.id, content="reply", reply_to_message_id=root1["id"])

    # Удаляем root2 — он не должен попасть в ленту.
    deleted = await client.delete(
        f"/api/rooms/{room.id}/messages/{root2['id']}", headers=headers
    )
    assert deleted.status_code == 204

    resp = await client.get(f"/api/rooms/{room.id}/messages", headers=headers)
    assert resp.status_code == 200
    ids = {m["id"] for m in resp.json()}
    assert ids == {root1["id"]}  # без удалённого root2 и без тред-ответа


# --- доступ ----------------------------------------------------------------


async def test_outsider_cannot_read_private_room(
    client: AsyncClient,
    make_user: MakeUser,
    make_room: MakeRoom,
    add_membership: AddMembership,
) -> None:
    owner = await make_user()
    outsider = await make_user()
    room = await make_room(created_by=owner.id)
    await add_membership(room.id, owner.id, "owner")

    resp = await client.get(
        f"/api/rooms/{room.id}/messages", headers=await _headers(client, outsider)
    )
    assert resp.status_code == 403

    posted = await client.post(
        f"/api/rooms/{room.id}/messages",
        headers=await _headers(client, outsider),
        json={"content": "sneaky"},
    )
    assert posted.status_code == 403


# --- прочтения -------------------------------------------------------------


async def test_read_moves_only_forward(
    client: AsyncClient,
    make_user: MakeUser,
    make_room: MakeRoom,
    add_membership: AddMembership,
) -> None:
    owner = await make_user()
    reader = await make_user()
    room = await make_room(created_by=owner.id)
    await add_membership(room.id, owner.id, "owner")
    await add_membership(room.id, reader.id, "member")
    owner_headers = await _headers(client, owner)
    reader_headers = await _headers(client, reader)

    m1 = await _send(client, owner_headers, room.id, content="m1")
    m2 = await _send(client, owner_headers, room.id, content="m2")

    fwd = await client.post(
        f"/api/rooms/{room.id}/read",
        headers=reader_headers,
        json={"last_read_message_id": m2["id"]},
    )
    assert fwd.status_code == 200
    assert fwd.json()["last_read_message_id"] == m2["id"]

    # Попытка откатить назад — игнорируется, остаётся m2.
    back = await client.post(
        f"/api/rooms/{room.id}/read",
        headers=reader_headers,
        json={"last_read_message_id": m1["id"]},
    )
    assert back.status_code == 200
    assert back.json()["last_read_message_id"] == m2["id"]


async def test_channel_membership_created_lazily_on_read(
    client: AsyncClient,
    session: AsyncSession,
    make_user: MakeUser,
    make_room: MakeRoom,
) -> None:
    admin = await make_user(role="admin")
    reader = await make_user()
    channel = await make_room(created_by=admin.id, type="channel", name="Chan")
    posted = await _send(client, await _headers(client, admin), channel.id, content="hi")

    # До отметки прочтения строки членства в канале нет (вариант А).
    assert await _membership_count(session, channel.id, reader.id) == 0

    resp = await client.post(
        f"/api/rooms/{channel.id}/read",
        headers=await _headers(client, reader),
        json={"last_read_message_id": posted["id"]},
    )
    assert resp.status_code == 200
    assert resp.json()["last_read_message_id"] == posted["id"]
    # Появилась ровно одна строка — лениво, только ради last_read.
    assert await _membership_count(session, channel.id, reader.id) == 1


async def test_unread_count_in_room_list(
    client: AsyncClient,
    make_user: MakeUser,
    make_room: MakeRoom,
    add_membership: AddMembership,
) -> None:
    owner = await make_user()
    member = await make_user()
    room = await make_room(created_by=owner.id)
    await add_membership(room.id, owner.id, "owner")
    await add_membership(room.id, member.id, "member")
    owner_headers = await _headers(client, owner)
    member_headers = await _headers(client, member)

    await _send(client, owner_headers, room.id, content="m1")
    m2 = await _send(client, owner_headers, room.id, content="m2")
    await _send(client, owner_headers, room.id, content="m3")

    async def _unread() -> int:
        resp = await client.get("/api/rooms", headers=member_headers)
        assert resp.status_code == 200
        return next(r for r in resp.json() if r["id"] == room.id)["unread_count"]

    assert await _unread() == 3  # три чужих, ни одного прочитанного

    await client.post(
        f"/api/rooms/{room.id}/read",
        headers=member_headers,
        json={"last_read_message_id": m2["id"]},
    )
    assert await _unread() == 1  # остался только m3


# --- удаление и полезная нагрузка ------------------------------------------


async def test_delete_permissions(
    client: AsyncClient,
    make_user: MakeUser,
    make_room: MakeRoom,
    add_membership: AddMembership,
) -> None:
    owner = await make_user()
    member = await make_user()
    admin = await make_user(role="admin")
    room = await make_room(created_by=owner.id)
    await add_membership(room.id, owner.id, "owner")
    await add_membership(room.id, member.id, "member")
    await add_membership(room.id, admin.id, "member")

    msg = await _send(client, await _headers(client, owner), room.id, content="mine")

    # Посторонний участник (не автор, не admin) — 403.
    forbidden = await client.delete(
        f"/api/rooms/{room.id}/messages/{msg['id']}",
        headers=await _headers(client, member),
    )
    assert forbidden.status_code == 403

    # Автор удаляет своё — 204.
    own = await client.delete(
        f"/api/rooms/{room.id}/messages/{msg['id']}",
        headers=await _headers(client, owner),
    )
    assert own.status_code == 204

    # Admin удаляет любое.
    other = await _send(client, await _headers(client, member), room.id, content="m2")
    by_admin = await client.delete(
        f"/api/rooms/{room.id}/messages/{other['id']}",
        headers=await _headers(client, admin),
    )
    assert by_admin.status_code == 204


async def test_empty_message_rejected(
    client: AsyncClient,
    make_user: MakeUser,
    make_room: MakeRoom,
    add_membership: AddMembership,
) -> None:
    owner = await make_user()
    room = await make_room(created_by=owner.id)
    await add_membership(room.id, owner.id, "owner")

    resp = await client.post(
        f"/api/rooms/{room.id}/messages",
        headers=await _headers(client, owner),
        json={},
    )
    assert resp.status_code == 422  # ни текста, ни стикера, ни вложений


async def test_sticker_and_attachment_message(
    client: AsyncClient,
    session: AsyncSession,
    make_user: MakeUser,
    make_room: MakeRoom,
    add_membership: AddMembership,
) -> None:
    owner = await make_user()
    room = await make_room(created_by=owner.id)
    await add_membership(room.id, owner.id, "owner")
    headers = await _headers(client, owner)

    pack = Stickerpack(name="pack", created_by=owner.id)
    session.add(pack)
    await session.flush()
    sticker = Sticker(pack_id=pack.id, image_url="http://x/s.png")
    asset = MediaAsset(
        bucket="chat-media",
        storage_key="2026/06/x.png",
        kind="image",
        mime_type="image/png",
        size=10,
        created_by=owner.id,
    )
    session.add_all([sticker, asset])
    await session.commit()

    # Сообщение-стикер: content=NULL, sticker_id заполнен.
    st = await _send(client, headers, room.id, sticker_id=sticker.id)
    assert st["content"] is None
    assert st["sticker_id"] == sticker.id

    # Сообщение с вложением.
    att = await _send(client, headers, room.id, attachment_ids=[asset.id])
    assert att["attachment_ids"] == [asset.id]


# --- редактирование --------------------------------------------------------


async def test_author_edits_own_text(
    client: AsyncClient,
    make_user: MakeUser,
    make_room: MakeRoom,
    add_membership: AddMembership,
) -> None:
    owner = await make_user()
    room = await make_room(created_by=owner.id)
    await add_membership(room.id, owner.id, "owner")
    headers = await _headers(client, owner)

    msg = await _send(client, headers, room.id, content="typo")
    assert msg["edited_at"] is None

    resp = await client.patch(
        f"/api/rooms/{room.id}/messages/{msg['id']}",
        headers=headers,
        json={"content": "fixed"},
    )
    assert resp.status_code == 200, resp.text
    body = resp.json()
    assert body["content"] == "fixed"
    assert body["edited_at"] is not None


async def test_non_author_cannot_edit(
    client: AsyncClient,
    make_user: MakeUser,
    make_room: MakeRoom,
    add_membership: AddMembership,
) -> None:
    owner = await make_user()
    admin = await make_user(role="admin")
    room = await make_room(created_by=owner.id)
    await add_membership(room.id, owner.id, "owner")
    await add_membership(room.id, admin.id, "member")

    msg = await _send(client, await _headers(client, owner), room.id, content="mine")

    # Даже admin не переписывает чужой текст (в отличие от удаления).
    resp = await client.patch(
        f"/api/rooms/{room.id}/messages/{msg['id']}",
        headers=await _headers(client, admin),
        json={"content": "hijack"},
    )
    assert resp.status_code == 403


async def test_edit_sticker_only_message_rejected(
    client: AsyncClient,
    session: AsyncSession,
    make_user: MakeUser,
    make_room: MakeRoom,
    add_membership: AddMembership,
) -> None:
    owner = await make_user()
    room = await make_room(created_by=owner.id)
    await add_membership(room.id, owner.id, "owner")
    headers = await _headers(client, owner)

    pack = Stickerpack(name="pack", created_by=owner.id)
    session.add(pack)
    await session.flush()
    sticker = Sticker(pack_id=pack.id, image_url="http://x/s.png")
    session.add(sticker)
    await session.commit()

    msg = await _send(client, headers, room.id, sticker_id=sticker.id)
    resp = await client.patch(
        f"/api/rooms/{room.id}/messages/{msg['id']}",
        headers=headers,
        json={"content": "now text"},
    )
    assert resp.status_code == 400  # править нечего — нет текста


async def test_edit_deleted_message_404(
    client: AsyncClient,
    make_user: MakeUser,
    make_room: MakeRoom,
    add_membership: AddMembership,
) -> None:
    owner = await make_user()
    room = await make_room(created_by=owner.id)
    await add_membership(room.id, owner.id, "owner")
    headers = await _headers(client, owner)

    msg = await _send(client, headers, room.id, content="bye")
    await client.delete(f"/api/rooms/{room.id}/messages/{msg['id']}", headers=headers)
    resp = await client.patch(
        f"/api/rooms/{room.id}/messages/{msg['id']}",
        headers=headers,
        json={"content": "back"},
    )
    assert resp.status_code == 404


async def test_edit_blank_content_rejected(
    client: AsyncClient,
    make_user: MakeUser,
    make_room: MakeRoom,
    add_membership: AddMembership,
) -> None:
    owner = await make_user()
    room = await make_room(created_by=owner.id)
    await add_membership(room.id, owner.id, "owner")
    headers = await _headers(client, owner)

    msg = await _send(client, headers, room.id, content="keep")
    resp = await client.patch(
        f"/api/rooms/{room.id}/messages/{msg['id']}",
        headers=headers,
        json={"content": "   "},
    )
    assert resp.status_code == 422  # пустой текст не проходит валидацию


# --- репост в новостной канал ----------------------------------------------


async def test_admin_reposts_to_news(
    client: AsyncClient,
    session: AsyncSession,
    make_user: MakeUser,
    make_room: MakeRoom,
    add_membership: AddMembership,
) -> None:
    """Админ репостит чужое сообщение (с вложением) в новостной канал: пост в news,
    автор = админ, исходный автор сохранён в forwarded_from_sender_id, вложение
    продублировано (та же media_asset_id)."""
    admin = await make_user(role="admin")
    author = await make_user()
    room = await make_room(created_by=author.id)
    await add_membership(room.id, author.id, "owner")
    await add_membership(room.id, admin.id, "member")

    asset = MediaAsset(
        bucket="chat-media",
        storage_key="2026/07/r.png",
        kind="image",
        mime_type="image/png",
        size=10,
        created_by=author.id,
    )
    session.add(asset)
    await session.commit()

    author_headers = await _headers(client, author)
    src = await _send(
        client, author_headers, room.id, content="original", attachment_ids=[asset.id]
    )

    admin_headers = await _headers(client, admin)
    resp = await client.post(
        f"/api/rooms/{room.id}/messages/{src['id']}/repost", headers=admin_headers
    )
    assert resp.status_code == 201, resp.text
    out = resp.json()

    news = (
        await session.execute(select(Room).where(Room.is_news.is_(True)))
    ).scalar_one()
    assert out["room_id"] == news.id
    assert out["sender_id"] == admin.id
    assert out["forwarded_from_sender_id"] == author.id
    assert out["content"] == "original"
    assert out["attachment_ids"] == [asset.id]

    # Вложение действительно продублировано как отдельная строка связи на новом посте.
    dup = (
        await session.execute(
            select(func.count())
            .select_from(MessageAttachment)
            .where(MessageAttachment.message_id == out["id"])
        )
    ).scalar_one()
    assert dup == 1


async def test_non_admin_cannot_repost(
    client: AsyncClient,
    make_user: MakeUser,
    make_room: MakeRoom,
    add_membership: AddMembership,
) -> None:
    owner = await make_user()
    room = await make_room(created_by=owner.id)
    await add_membership(room.id, owner.id, "owner")
    headers = await _headers(client, owner)

    msg = await _send(client, headers, room.id, content="hi")
    resp = await client.post(
        f"/api/rooms/{room.id}/messages/{msg['id']}/repost", headers=headers
    )
    assert resp.status_code == 403
