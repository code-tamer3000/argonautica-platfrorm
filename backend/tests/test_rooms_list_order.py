"""Порядок `GET /api/rooms`: по свежести переписки (MAX(Message.created_at) DESC),
не по дате создания комнаты. До этой правки подъём "наверх" при новом сообщении
делал только клиент (`bumpRoom` в useRealtime.ts) прямо в кэше react-query — любой
refetch (перезаход в раздел, remount) откатывал список к порядку по created_at,
теряя эффект. Порядок теперь задаёт сервер, клиентский bump остаётся только
optimistic-шагом до следующего запроса."""
from httpx import AsyncClient

from app.models.user import User

from .conftest import AddMembership, MakeRoom, MakeUser, auth_headers, login


async def _headers(client: AsyncClient, user: User) -> dict[str, str]:
    tokens = await login(client, user.username, "initpass123")
    return auth_headers(tokens["access_token"])


async def test_room_with_new_message_moves_to_top(
    client: AsyncClient,
    make_user: MakeUser,
    make_room: MakeRoom,
    add_membership: AddMembership,
) -> None:
    viewer = await make_user()
    older = await make_room(created_by=viewer.id, name="Older")
    newer = await make_room(created_by=viewer.id, name="Newer")
    await add_membership(older.id, viewer.id, role="owner")
    await add_membership(newer.id, viewer.id, role="owner")
    headers = await _headers(client, viewer)

    # newer создана позже older — по created_at она бы уже шла первой; сообщение
    # пишем в СТАРШУЮ (older), чтобы отличить "сортировка по created_at" от
    # "сортировка по последнему сообщению".
    resp = await client.post(f"/api/rooms/{older.id}/messages", headers=headers, json={"content": "hi"})
    assert resp.status_code == 201, resp.text

    rooms = (await client.get("/api/rooms", headers=headers)).json()
    ids = [r["id"] for r in rooms if r["id"] in (older.id, newer.id)]
    assert ids == [older.id, newer.id]


async def test_room_without_messages_falls_back_to_created_at(
    client: AsyncClient,
    make_user: MakeUser,
    make_room: MakeRoom,
    add_membership: AddMembership,
) -> None:
    """Ни в одной комнате нет сообщений — порядок как раньше, по созданию
    (свежесозданная dm/группа не проваливается в конец списка)."""
    viewer = await make_user()
    first = await make_room(created_by=viewer.id, name="First")
    second = await make_room(created_by=viewer.id, name="Second")
    await add_membership(first.id, viewer.id, role="owner")
    await add_membership(second.id, viewer.id, role="owner")
    headers = await _headers(client, viewer)

    rooms = (await client.get("/api/rooms", headers=headers)).json()
    ids = [r["id"] for r in rooms if r["id"] in (first.id, second.id)]
    assert ids == [first.id, second.id]


async def test_second_message_re_bumps_room_again(
    client: AsyncClient,
    make_user: MakeUser,
    make_room: MakeRoom,
    add_membership: AddMembership,
) -> None:
    """Комната поднимается заново на каждое новое сообщение, не только один раз."""
    viewer = await make_user()
    a = await make_room(created_by=viewer.id, name="A")
    b = await make_room(created_by=viewer.id, name="B")
    await add_membership(a.id, viewer.id, role="owner")
    await add_membership(b.id, viewer.id, role="owner")
    headers = await _headers(client, viewer)

    await client.post(f"/api/rooms/{a.id}/messages", headers=headers, json={"content": "1"})
    await client.post(f"/api/rooms/{b.id}/messages", headers=headers, json={"content": "2"})
    rooms = (await client.get("/api/rooms", headers=headers)).json()
    ids = [r["id"] for r in rooms if r["id"] in (a.id, b.id)]
    assert ids == [b.id, a.id]

    await client.post(f"/api/rooms/{a.id}/messages", headers=headers, json={"content": "3"})
    rooms = (await client.get("/api/rooms", headers=headers)).json()
    ids = [r["id"] for r in rooms if r["id"] in (a.id, b.id)]
    assert ids == [a.id, b.id]
