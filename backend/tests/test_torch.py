"""Клуб «Факел» (ARG-54): ручной гейт torch_unlocked + singleton-комната.

Тесты бегут без lifespan (см. conftest.py) — комната клуба создаётся лениво
первым же `grant_torch_access` (через `POST /admin/torch/grant`), не заранее.
"""
from datetime import UTC, date, datetime

from httpx import AsyncClient
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.room import Room, RoomMember
from app.models.user import User

from .conftest import MakeUser, auth_headers, login


async def _headers(client: AsyncClient, user: User) -> dict[str, str]:
    tokens = await login(client, user.username, "initpass123")
    return auth_headers(tokens["access_token"])


async def test_non_graduated_has_no_torch_access(
    client: AsyncClient, make_user: MakeUser
) -> None:
    """Не выпустившийся: тумблер по умолчанию false, заглушка недоступна."""
    user = await make_user()
    assert user.torch_unlocked is False

    me = await client.get("/api/auth/me", headers=await _headers(client, user))
    assert me.json()["torch_unlocked"] is False

    stub = await client.get("/api/torch/stub", headers=await _headers(client, user))
    assert stub.status_code == 403


async def test_graduated_without_toggle_sees_stub_no_room(
    client: AsyncClient, make_user: MakeUser
) -> None:
    """Выпустился, тумблер ещё не включён: видит заглушку, в комнату не попадает."""
    await make_user(role="admin")  # нужен хоть один админ — ensure_torch_room
    user = await make_user(graduated_at=datetime.now(UTC))
    headers = await _headers(client, user)

    stub = await client.get("/api/torch/stub", headers=headers)
    assert stub.status_code == 200, stub.text
    assert stub.json()["stub_text"]


async def test_admin_grant_unlocks_toggle_and_room_access(
    client: AsyncClient, make_user: MakeUser, session: AsyncSession
) -> None:
    admin = await make_user(role="admin")
    user = await make_user(graduated_at=datetime.now(UTC))
    admin_h = await _headers(client, admin)
    user_h = await _headers(client, user)

    grant = await client.post(
        "/api/admin/torch/grant", headers=admin_h, json={"user_ids": [user.id]}
    )
    assert grant.status_code == 204, grant.text

    await session.refresh(user)
    assert user.torch_unlocked is True

    room = (await session.execute(select(Room).where(Room.is_torch.is_(True)))).scalar_one()
    membership = await session.get(RoomMember, (room.id, user.id))
    assert membership is not None

    # Может писать — выпуск не блокирует запись именно в этой комнате.
    send = await client.post(
        f"/api/rooms/{room.id}/messages", headers=user_h, json={"content": "привет, клуб"}
    )
    assert send.status_code == 201, send.text

    rooms = await client.get("/api/rooms", headers=user_h)
    assert any(r["id"] == room.id for r in rooms.json())


async def test_admin_revoke_locks_toggle_and_removes_membership(
    client: AsyncClient, make_user: MakeUser, session: AsyncSession
) -> None:
    admin = await make_user(role="admin")
    user = await make_user(graduated_at=datetime.now(UTC))
    admin_h = await _headers(client, admin)
    user_h = await _headers(client, user)

    await client.post(
        "/api/admin/torch/grant", headers=admin_h, json={"user_ids": [user.id]}
    )
    room = (await session.execute(select(Room).where(Room.is_torch.is_(True)))).scalar_one()

    revoke = await client.delete(f"/api/admin/torch/grant/{user.id}", headers=admin_h)
    assert revoke.status_code == 204, revoke.text

    await session.refresh(user)
    assert user.torch_unlocked is False
    assert await session.get(RoomMember, (room.id, user.id)) is None

    # Запись закрыта — та же 403-граница, что у любой не-членской комнаты.
    send = await client.post(
        f"/api/rooms/{room.id}/messages", headers=user_h, json={"content": "ещё раз"}
    )
    assert send.status_code == 403

    stub = await client.get("/api/torch/stub", headers=user_h)
    assert stub.status_code == 200  # заглушка снова доступна


async def test_grant_is_idempotent(
    client: AsyncClient, make_user: MakeUser, session: AsyncSession
) -> None:
    admin = await make_user(role="admin")
    user = await make_user(graduated_at=datetime.now(UTC))
    admin_h = await _headers(client, admin)

    for _ in range(2):
        resp = await client.post(
            "/api/admin/torch/grant", headers=admin_h, json={"user_ids": [user.id]}
        )
        assert resp.status_code == 204, resp.text

    room = (await session.execute(select(Room).where(Room.is_torch.is_(True)))).scalar_one()
    count = (
        await session.execute(
            select(RoomMember).where(
                RoomMember.room_id == room.id, RoomMember.user_id == user.id
            )
        )
    ).scalars().all()
    assert len(count) == 1


async def test_grant_skips_non_graduated_and_admins(
    client: AsyncClient, make_user: MakeUser, session: AsyncSession
) -> None:
    admin = await make_user(role="admin")
    other_admin = await make_user(role="admin")
    not_graduated = await make_user()
    admin_h = await _headers(client, admin)

    resp = await client.post(
        "/api/admin/torch/grant",
        headers=admin_h,
        json={"user_ids": [not_graduated.id, other_admin.id]},
    )
    assert resp.status_code == 204, resp.text

    await session.refresh(not_graduated)
    await session.refresh(other_admin)
    assert not_graduated.torch_unlocked is False
    assert other_admin.torch_unlocked is False


async def test_admin_overview_lists_only_graduates(
    client: AsyncClient, make_user: MakeUser
) -> None:
    admin = await make_user(role="admin")
    graduate = await make_user(graduated_at=datetime.now(UTC), display_name="Выпускник")
    await make_user(display_name="Не выпустился")
    admin_h = await _headers(client, admin)

    resp = await client.get("/api/admin/torch", headers=admin_h)
    assert resp.status_code == 200, resp.text
    body = resp.json()
    ids = {r["user_id"] for r in body["rows"]}
    assert graduate.id in ids
    assert len(body["rows"]) == 1
    assert body["stub_text"]


async def test_admin_can_update_stub_text(
    client: AsyncClient, make_user: MakeUser
) -> None:
    admin = await make_user(role="admin")
    admin_h = await _headers(client, admin)

    resp = await client.patch(
        "/api/admin/torch/stub", headers=admin_h, json={"stub_text": "Скоро откроется"}
    )
    assert resp.status_code == 204, resp.text

    overview = await client.get("/api/admin/torch", headers=admin_h)
    assert overview.json()["stub_text"] == "Скоро откроется"


async def test_non_admin_cannot_manage_torch(
    client: AsyncClient, make_user: MakeUser
) -> None:
    user = await make_user(graduated_at=datetime.now(UTC))
    headers = await _headers(client, user)

    assert (await client.get("/api/admin/torch", headers=headers)).status_code == 403
    assert (
        await client.post(
            "/api/admin/torch/grant", headers=headers, json={"user_ids": [user.id]}
        )
    ).status_code == 403


# --- кнопка «Подать заявку» (ARG-158) -----------------------------------


async def test_stub_has_no_apply_button_without_configured_admin(
    client: AsyncClient, make_user: MakeUser
) -> None:
    """Без назначенного админа Факела кнопки на гейте нет (apply_admin_id=None)
    и заявку подать нельзя."""
    await make_user(role="admin")
    user = await make_user(graduated_at=datetime.now(UTC))
    headers = await _headers(client, user)

    stub = await client.get("/api/torch/stub", headers=headers)
    assert stub.status_code == 200, stub.text
    assert stub.json()["apply_admin_id"] is None

    apply = await client.post("/api/torch/apply", headers=headers)
    assert apply.status_code == 404


async def test_admin_can_assign_torch_admin_and_stub_exposes_it(
    client: AsyncClient, make_user: MakeUser
) -> None:
    admin = await make_user(role="admin", display_name="Ответственный")
    user = await make_user(graduated_at=datetime.now(UTC))
    admin_h = await _headers(client, admin)
    user_h = await _headers(client, user)

    resp = await client.patch(
        "/api/admin/torch/admin", headers=admin_h, json={"admin_user_id": admin.id}
    )
    assert resp.status_code == 204, resp.text

    overview = await client.get("/api/admin/torch", headers=admin_h)
    assert overview.json()["admin_user_id"] == admin.id
    assert any(c["user_id"] == admin.id for c in overview.json()["admin_candidates"])

    stub = await client.get("/api/torch/stub", headers=user_h)
    assert stub.json()["apply_admin_id"] == admin.id


async def test_non_admin_cannot_assign_torch_admin(
    client: AsyncClient, make_user: MakeUser
) -> None:
    admin = await make_user(role="admin")
    user = await make_user(graduated_at=datetime.now(UTC))
    headers = await _headers(client, user)

    resp = await client.patch(
        "/api/admin/torch/admin", headers=headers, json={"admin_user_id": admin.id}
    )
    assert resp.status_code == 403


async def test_assign_torch_admin_rejects_non_admin_target(
    client: AsyncClient, make_user: MakeUser
) -> None:
    admin = await make_user(role="admin")
    other = await make_user(graduated_at=datetime.now(UTC))
    admin_h = await _headers(client, admin)

    resp = await client.patch(
        "/api/admin/torch/admin", headers=admin_h, json={"admin_user_id": other.id}
    )
    assert resp.status_code == 404


async def test_apply_creates_writable_torch_scope_dm_before_toggle(
    client: AsyncClient, make_user: MakeUser, session: AsyncSession
) -> None:
    """Заявка открывает DM с назначенным админом и можно сразу писать — до
    того, как личный тумблер `torch_unlocked` вообще включён."""
    admin = await make_user(role="admin")
    user = await make_user(graduated_at=datetime.now(UTC))
    admin_h = await _headers(client, admin)
    user_h = await _headers(client, user)

    await client.patch(
        "/api/admin/torch/admin", headers=admin_h, json={"admin_user_id": admin.id}
    )

    apply = await client.post("/api/torch/apply", headers=user_h)
    assert apply.status_code == 200, apply.text
    room_id = apply.json()["room_id"]

    room = await session.get(Room, room_id)
    assert room is not None
    assert room.torch_scope is True
    assert room.is_torch is False  # не singleton-комната клуба, обычный dm заявки

    await session.refresh(user)
    assert user.torch_unlocked is False  # заявка не открывает тумблер сама по себе
    assert user.torch_applied_at is not None

    send = await client.post(
        f"/api/rooms/{room_id}/messages", headers=user_h, json={"content": "можно вопрос?"}
    )
    assert send.status_code == 201, send.text

    # Виден по прямой ссылке /api/rooms/{id}, хотя тумблер ещё выключен.
    detail = await client.get(f"/api/rooms/{room_id}", headers=user_h)
    assert detail.status_code == 200

    overview = await client.get("/api/admin/torch", headers=admin_h)
    row = next(r for r in overview.json()["rows"] if r["user_id"] == user.id)
    assert row["torch_applied_at"] is not None


async def test_apply_is_idempotent_same_room(
    client: AsyncClient, make_user: MakeUser
) -> None:
    admin = await make_user(role="admin")
    user = await make_user(graduated_at=datetime.now(UTC))
    admin_h = await _headers(client, admin)
    user_h = await _headers(client, user)

    await client.patch(
        "/api/admin/torch/admin", headers=admin_h, json={"admin_user_id": admin.id}
    )

    first = await client.post("/api/torch/apply", headers=user_h)
    second = await client.post("/api/torch/apply", headers=user_h)
    assert first.json()["room_id"] == second.json()["room_id"]


# --- ARG-169: Факел для возвращающегося потока ------------------------------


async def test_apply_works_with_torch_admin_from_another_intake(
    client: AsyncClient, make_user: MakeUser
) -> None:
    """Заявка выпускника потока A к админу Факела из потока B (поток админа неважен)."""
    admin = await make_user(role="admin", intake_starts_on=date(2026, 8, 31))
    user = await make_user(graduated_at=datetime.now(UTC), intake_starts_on=date(2026, 7, 2))
    assert admin.intake_id != user.intake_id
    admin_h = await _headers(client, admin)
    await client.patch(
        "/api/admin/torch/admin", headers=admin_h, json={"admin_user_id": admin.id}
    )

    apply = await client.post("/api/torch/apply", headers=await _headers(client, user))
    assert apply.status_code == 200, apply.text


async def test_grant_and_revoke_cover_all_autojoin_rooms(
    client: AsyncClient, make_user: MakeUser, session: AsyncSession
) -> None:
    admin = await make_user(role="admin")
    user = await make_user(graduated_at=datetime.now(UTC))
    cave = Room(
        type="group", name="Пещера аргонавтов", torch_scope=True, torch_autojoin=True,
        created_by=admin.id,
    )
    plain = Room(type="group", name="Обычная", torch_scope=True, created_by=admin.id)
    session.add_all([cave, plain])
    await session.commit()
    admin_h = await _headers(client, admin)

    grant = await client.post(
        "/api/admin/torch/grant", headers=admin_h, json={"user_ids": [user.id]}
    )
    assert grant.status_code in (200, 204), grant.text
    rooms = (await session.execute(
        select(RoomMember.room_id).where(RoomMember.user_id == user.id)
    )).scalars().all()
    assert cave.id in rooms and plain.id not in rooms
    assert len(rooms) == 2  # singleton «Факел» + «Пещера»

    revoke = await client.delete(f"/api/admin/torch/grant/{user.id}", headers=admin_h)
    assert revoke.status_code in (200, 204), revoke.text
    left = (await session.execute(
        select(RoomMember.room_id).where(RoomMember.user_id == user.id)
    )).scalars().all()
    assert left == []


async def test_intake_texts_override_popup_and_stub(
    client: AsyncClient, make_user: MakeUser
) -> None:
    admin = await make_user(role="admin")
    returning = await make_user(graduated_at=datetime.now(UTC), intake_starts_on=date(2026, 7, 2))
    other = await make_user(graduated_at=datetime.now(UTC), intake_starts_on=date(2026, 8, 31))
    admin_h = await _headers(client, admin)

    patch = await client.patch(
        f"/api/admin/intakes/{returning.intake_id}/torch",
        headers=admin_h,
        json={"graduation_popup_text": "С возвращением!", "torch_stub_text": "Подай заявку"},
    )
    assert patch.status_code == 200, patch.text
    assert patch.json()["torch_stub_text"] == "Подай заявку"

    ret_h = await _headers(client, returning)
    me = (await client.get("/api/auth/me", headers=ret_h)).json()
    assert me["intake_graduation_popup_text"] == "С возвращением!"
    stub = (await client.get("/api/torch/stub", headers=ret_h)).json()
    assert stub["stub_text"] == "Подай заявку"

    other_h = await _headers(client, other)
    assert (await client.get("/api/auth/me", headers=other_h)).json()[
        "intake_graduation_popup_text"
    ] is None
    assert (await client.get("/api/torch/stub", headers=other_h)).json()["stub_text"] != "Подай заявку"

    # пустая строка сбрасывает на общий текст
    await client.patch(
        f"/api/admin/intakes/{returning.intake_id}/torch",
        headers=admin_h,
        json={"torch_stub_text": ""},
    )
    assert (await client.get("/api/torch/stub", headers=ret_h)).json()["stub_text"] != "Подай заявку"


async def test_kb_bridge_for_club_members(
    client: AsyncClient, make_user: MakeUser
) -> None:
    """Член клуба потока A (с мостом на B) видит и комментирует материалы B; без
    тумблера или после снятия — нет."""
    admin = await make_user(role="admin")
    member = await make_user(graduated_at=datetime.now(UTC), intake_starts_on=date(2026, 7, 2))
    host = await make_user(intake_starts_on=date(2026, 8, 31))
    admin_h = await _headers(client, admin)
    member_h = await _headers(client, member)

    created = await client.post(
        "/api/kb/items",
        headers=admin_h,
        json={"title": "Материал потока B", "body": "x", "published": True,
              "intake_id": host.intake_id},
    )
    assert created.status_code == 201, created.text
    item_id = created.json()["id"]

    async def visible() -> bool:
        listed = await client.get("/api/kb/items", headers=member_h)
        return item_id in {i["id"] for i in listed.json()}

    assert not await visible()
    await client.patch(
        f"/api/admin/intakes/{member.intake_id}/torch",
        headers=admin_h,
        json={"torch_kb_intake_id": host.intake_id},
    )
    assert not await visible()  # мост работает только вместе с тумблером клуба

    await client.post("/api/admin/torch/grant", headers=admin_h, json={"user_ids": [member.id]})
    assert await visible()
    me = (await client.get("/api/auth/me", headers=member_h)).json()
    assert me["kb_bridge_intake_id"] == host.intake_id and me["kb_bridge_starts_on"]
    assert (await client.get(f"/api/kb/items/{item_id}", headers=member_h)).status_code == 200
    comment = await client.post(
        f"/api/kb/items/{item_id}/comments", headers=member_h, json={"body": "спасибо"}
    )
    assert comment.status_code == 201, comment.text

    await client.delete(f"/api/admin/torch/grant/{member.id}", headers=admin_h)
    assert not await visible()
    assert (await client.get(f"/api/kb/items/{item_id}", headers=member_h)).status_code == 404
