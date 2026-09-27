"""Клуб «Факел» как отдельный раздел (ARG-54, часть 2): свои dm/группы,
свой круг видимости контактов (члены клуба + любые админы, без рангового
каскада тарифов), исключены из общего списка комнат Рубки по `torch_scope`.
"""
from datetime import UTC, datetime

from httpx import AsyncClient
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.room import Room
from app.models.user import User

from .conftest import AddMembership, MakeRoom, MakeUser, auth_headers, login


async def _headers(client: AsyncClient, user: User) -> dict[str, str]:
    tokens = await login(client, user.username, "initpass123")
    return auth_headers(tokens["access_token"])


async def _graduated_member(make_user: MakeUser) -> User:
    """Выпускник с уже включённым тумблером — как после `grant_torch_access`."""
    user = await make_user(graduated_at=datetime.now(UTC))
    user.torch_unlocked = True
    return user


# --- контакты -----------------------------------------------------------


async def test_torch_contacts_scoped_to_club_and_admins(
    client: AsyncClient, make_user: MakeUser, session: AsyncSession
) -> None:
    admin = await make_user(role="admin")
    member = await _graduated_member(make_user)
    other_graduate = await make_user(graduated_at=datetime.now(UTC))  # тумблер выключен
    regular_participant = await make_user()
    await session.commit()

    resp = await client.get("/api/torch/contacts", headers=await _headers(client, member))
    assert resp.status_code == 200, resp.text
    ids = {u["id"] for u in resp.json()}
    assert admin.id in ids
    assert member.id not in ids  # себя в списке нет
    assert other_graduate.id not in ids  # выпустился, но тумблер выключен
    assert regular_participant.id not in ids


async def test_non_torch_user_cannot_list_torch_contacts(
    client: AsyncClient, make_user: MakeUser
) -> None:
    user = await make_user()
    resp = await client.get("/api/torch/contacts", headers=await _headers(client, user))
    assert resp.status_code == 403


# --- dm внутри «Факела» ---------------------------------------------------


async def test_create_torch_dm_between_club_members(
    client: AsyncClient, make_user: MakeUser, session: AsyncSession
) -> None:
    a = await _graduated_member(make_user)
    b = await _graduated_member(make_user)
    await session.commit()

    resp = await client.post(
        "/api/rooms", headers=await _headers(client, a), json={"type": "dm", "peer_id": b.id, "torch": True}
    )
    assert resp.status_code == 201, resp.text
    room = resp.json()
    assert room["torch_scope"] is True

    # Оба выпустились, но пишут свободно — это же «Факел».
    send = await client.post(
        f"/api/rooms/{room['id']}/messages",
        headers=await _headers(client, b),
        json={"content": "привет"},
    )
    assert send.status_code == 201, send.text


async def test_create_torch_dm_rejects_non_member_peer(
    client: AsyncClient, make_user: MakeUser, session: AsyncSession
) -> None:
    member = await _graduated_member(make_user)
    locked_graduate = await make_user(graduated_at=datetime.now(UTC))  # тумблер выключен
    await session.commit()

    resp = await client.post(
        "/api/rooms",
        headers=await _headers(client, member),
        json={"type": "dm", "peer_id": locked_graduate.id, "torch": True},
    )
    assert resp.status_code == 403


async def test_create_torch_dm_with_admin_always_allowed(
    client: AsyncClient, make_user: MakeUser, session: AsyncSession
) -> None:
    member = await _graduated_member(make_user)
    admin = await make_user(role="admin")  # torch_unlocked=False у админа — не важно
    await session.commit()

    resp = await client.post(
        "/api/rooms",
        headers=await _headers(client, member),
        json={"type": "dm", "peer_id": admin.id, "torch": True},
    )
    assert resp.status_code == 201, resp.text


async def test_existing_regular_dm_is_promoted_to_torch_scope(
    client: AsyncClient, make_user: MakeUser, session: AsyncSession
) -> None:
    """Переписка была ДО выпуска (обычный dm Рубки) — открытие того же диалога
    из «Факела» переводит ту же комнату в раздел, а не плодит вторую (dm_key
    уникален по паре)."""
    a = await make_user()
    b = await make_user()
    first = await client.post(
        "/api/rooms", headers=await _headers(client, a), json={"type": "dm", "peer_id": b.id}
    )
    assert first.status_code == 201, first.text
    room_id = first.json()["id"]
    assert first.json()["torch_scope"] is False

    a.torch_unlocked = True
    a.graduated_at = datetime.now(UTC)
    b.torch_unlocked = True
    b.graduated_at = datetime.now(UTC)
    await session.commit()

    again = await client.post(
        "/api/rooms",
        headers=await _headers(client, a),
        json={"type": "dm", "peer_id": b.id, "torch": True},
    )
    assert again.status_code == 200, again.text
    assert again.json()["id"] == room_id
    assert again.json()["torch_scope"] is True


# --- группы внутри «Факела» -----------------------------------------------


async def test_create_torch_group_and_manage_members(
    client: AsyncClient, make_user: MakeUser, session: AsyncSession
) -> None:
    owner = await _graduated_member(make_user)
    member = await _graduated_member(make_user)
    outsider = await make_user(graduated_at=datetime.now(UTC))  # тумблер выключен
    await session.commit()

    create = await client.post(
        "/api/rooms",
        headers=await _headers(client, owner),
        json={"type": "group", "name": "Спецотряд «Факел»", "torch": True},
    )
    assert create.status_code == 201, create.text
    room = create.json()
    assert room["torch_scope"] is True

    add_ok = await client.post(
        f"/api/rooms/{room['id']}/members",
        headers=await _headers(client, owner),
        json={"user_id": member.id},
    )
    assert add_ok.status_code == 201, add_ok.text

    add_rejected = await client.post(
        f"/api/rooms/{room['id']}/members",
        headers=await _headers(client, owner),
        json={"user_id": outsider.id},
    )
    assert add_rejected.status_code == 403


async def test_locked_graduate_cannot_initiate_torch_chats(
    client: AsyncClient, make_user: MakeUser, session: AsyncSession
) -> None:
    """Выпустился, но тумблер ещё не включён — не может завести факел-чат ни с
    кем, даже с админом: право на создание проверяется у самого инициатора, не
    только у приглашаемого (см. assert_torch_peer_visible vs собственный гейт)."""
    locked = await make_user(graduated_at=datetime.now(UTC))
    admin = await make_user(role="admin")
    await session.commit()

    dm = await client.post(
        "/api/rooms",
        headers=await _headers(client, locked),
        json={"type": "dm", "peer_id": admin.id, "torch": True},
    )
    assert dm.status_code == 403

    group = await client.post(
        "/api/rooms",
        headers=await _headers(client, locked),
        json={"type": "group", "name": "Раньше времени", "torch": True},
    )
    assert group.status_code == 403


async def test_torch_group_requires_club_access(
    client: AsyncClient, make_user: MakeUser
) -> None:
    """`can_create_groups` — это про обычные группы Рубки, не про «Факел»."""
    user = await make_user(can_create_groups=True)  # не выпустился вовсе

    resp = await client.post(
        "/api/rooms",
        headers=await _headers(client, user),
        json={"type": "group", "name": "Само-приглашённые", "torch": True},
    )
    assert resp.status_code == 403


# --- разделение списков ---------------------------------------------------


async def test_torch_room_flags_present_in_room_list(
    client: AsyncClient,
    make_user: MakeUser,
    make_room: MakeRoom,
    add_membership: AddMembership,
    session: AsyncSession,
) -> None:
    """`torch_scope` приходит в `GET /api/rooms` и для обычной, и для факел-комнаты —
    разделение по разделам целиком клиентское (см. RoomList.tsx), бэкенд только метит."""
    user = await _graduated_member(make_user)
    await session.commit()
    regular_peer = await make_user()
    regular_room = await make_room(created_by=user.id, type="dm", dm_key=f"reg_{user.id}")
    await add_membership(regular_room.id, user.id, "owner")
    await add_membership(regular_room.id, regular_peer.id)

    resp = await client.get("/api/rooms", headers=await _headers(client, user))
    assert resp.status_code == 200, resp.text
    by_id = {r["id"]: r for r in resp.json()}
    assert by_id[regular_room.id]["torch_scope"] is False
