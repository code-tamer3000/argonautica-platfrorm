"""Смена `plan_id` существующего юзера через `PATCH /api/admin/users/{id}` —
регрессия на прошлый прод-инцидент: понижение тарифа задним числом оставляло
протухшие `room_members` (комната в списке, 403 на открытии) и не убирало из
уже открытых dm с собеседниками вне нового видимого круга.

См. docs/ROOMS.md "Tariff change cleanup" и [[project_diary_stale_memberships]].
"""
import itertools
from datetime import date, timedelta

from httpx import AsyncClient
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.room import RoomMember
from app.models.user import User

from .conftest import MakeUser, auth_headers, login

_intake_offset = itertools.count(700)


async def _headers(client: AsyncClient, user: User) -> dict[str, str]:
    tokens = await login(client, user.username, "initpass123")
    return auth_headers(tokens["access_token"])


async def _create_plan(
    client: AsyncClient, headers: dict[str, str], name: str, price: int
) -> int:
    resp = await client.post(
        "/api/admin/plans", headers=headers, json={"name": name, "price": price}
    )
    assert resp.status_code == 201, resp.text
    return int(resp.json()["id"])


async def _three_tier_cohort(
    client: AsyncClient, make_user: MakeUser
) -> tuple[dict[str, int], dict[str, User]]:
    starts_on = date.today() - timedelta(days=next(_intake_offset))
    admin = await make_user(role="admin", intake_starts_on=starts_on)
    admin_h = await _headers(client, admin)
    plan_player = await _create_plan(client, admin_h, "Игрок", 1000)
    plan_squad = await _create_plan(client, admin_h, "Спецотряд", 2000)
    plan_oko = await _create_plan(client, admin_h, "Око", 3000)

    player = await make_user(intake_id=admin.intake_id, plan_id=plan_player)
    squad = await make_user(intake_id=admin.intake_id, plan_id=plan_squad)
    oko = await make_user(intake_id=admin.intake_id, plan_id=plan_oko)

    plans = {"player": plan_player, "squad": plan_squad, "oko": plan_oko}
    users = {"admin": admin, "player": player, "squad": squad, "oko": oko}
    return plans, users


# --- PATCH plan_id: валидация --------------------------------------------------


async def test_patch_plan_id_rejects_unknown_plan(
    client: AsyncClient, make_user: MakeUser
) -> None:
    admin = await make_user(role="admin")
    admin_h = await _headers(client, admin)
    participant = await make_user(intake_id=admin.intake_id)

    resp = await client.patch(
        f"/api/admin/users/{participant.id}",
        headers=admin_h,
        json={"plan_id": 10**9},
    )
    assert resp.status_code == 400


async def test_patch_plan_id_updates_user(
    client: AsyncClient, make_user: MakeUser
) -> None:
    _, users = await _three_tier_cohort(client, make_user)
    admin_h = await _headers(client, users["admin"])

    resp = await client.patch(
        f"/api/admin/users/{users['oko'].id}",
        headers=admin_h,
        json={"plan_id": None},
    )
    assert resp.status_code == 200

    # UserOut (профильная схема, тот же response_model что и у PATCH /me) не
    # тащит plan_id — сверяем через админский список, где он есть.
    listed = await client.get("/api/admin/users", headers=admin_h)
    row = next(u for u in listed.json() if u["id"] == users["oko"].id)
    assert row["plan_id"] is None


# --- Понижение тарифа подчищает dm с собеседниками вне нового круга ------------


async def test_downgrade_prunes_dm_with_higher_rank_peer(
    client: AsyncClient, make_user: MakeUser
) -> None:
    """`oko` (ранг 3) держит dm с `squad` (ранг 2) — легально, пока ранг выше.
    После понижения `oko` до `player` (ранг 1) собеседник `squad` выходит за
    видимый круг (ARG-110): dm должен пропасть из списка комнат понижен­ного
    участника, но остаться у `squad` нетронутым."""
    plans, users = await _three_tier_cohort(client, make_user)
    oko_h = await _headers(client, users["oko"])
    squad_h = await _headers(client, users["squad"])

    created = await client.post(
        "/api/rooms", headers=oko_h, json={"type": "dm", "peer_id": users["squad"].id}
    )
    assert created.status_code == 201
    room_id = created.json()["id"]

    admin_h = await _headers(client, users["admin"])
    patched = await client.patch(
        f"/api/admin/users/{users['oko'].id}",
        headers=admin_h,
        json={"plan_id": plans["player"]},
    )
    assert patched.status_code == 200

    oko_rooms = await client.get("/api/rooms", headers=oko_h)
    assert room_id not in {r["id"] for r in oko_rooms.json()}
    oko_direct = await client.get(f"/api/rooms/{room_id}", headers=oko_h)
    assert oko_direct.status_code == 403

    # У squad членство осталось — свою переписку не теряет.
    squad_rooms = await client.get("/api/rooms", headers=squad_h)
    assert room_id in {r["id"] for r in squad_rooms.json()}


async def test_downgrade_prunes_dm_with_non_navigator_admin(
    client: AsyncClient, make_user: MakeUser
) -> None:
    """`oko` (топ-2 тариф) переписывается с НЕ-навигатор-админом — легально.
    После понижения до `player` (не топ-2) dm с этим админом должен пропасть.

    Держим второго участника на тарифе «Око» (`oko2`), чтобы после понижения
    исходного `oko` этот тариф не исчез из потока целиком — иначе ранги
    потока схлопнутся до двух (`player`/`squad`), и «топ-2» тривиально
    накроет вообще всех, включая только что понижённого — тест перестанет
    что-либо проверять.
    """
    plans, users = await _three_tier_cohort(client, make_user)
    await make_user(intake_id=users["admin"].intake_id, plan_id=plans["oko"])
    admin_h = await _headers(client, users["admin"])
    oko_h = await _headers(client, users["oko"])

    created = await client.post(
        "/api/rooms", headers=admin_h, json={"type": "dm", "peer_id": users["oko"].id}
    )
    assert created.status_code == 201
    room_id = created.json()["id"]

    patched = await client.patch(
        f"/api/admin/users/{users['oko'].id}",
        headers=admin_h,
        json={"plan_id": plans["player"]},
    )
    assert patched.status_code == 200

    oko_h = await _headers(client, users["oko"])
    oko_rooms = await client.get("/api/rooms", headers=oko_h)
    assert room_id not in {r["id"] for r in oko_rooms.json()}


async def test_downgrade_keeps_dm_with_navigator(
    client: AsyncClient, make_user: MakeUser
) -> None:
    """Навигатор обходит ранговый каскад (ARG-110) — dm с ним переживает понижение,
    остаётся ЕДИНСТВЕННЫМ типом admin-собеседника, доступным «наблюдателю» из
    исходного запроса пользователя."""
    plans, users = await _three_tier_cohort(client, make_user)
    admin_h = await _headers(client, users["admin"])
    await client.patch(
        f"/api/admin/users/{users['admin'].id}", headers=admin_h, json={"is_navigator": True}
    )

    created = await client.post(
        "/api/rooms", headers=admin_h, json={"type": "dm", "peer_id": users["oko"].id}
    )
    assert created.status_code == 201
    room_id = created.json()["id"]

    await client.patch(
        f"/api/admin/users/{users['oko'].id}",
        headers=admin_h,
        json={"plan_id": plans["player"]},
    )

    oko_h = await _headers(client, users["oko"])
    oko_rooms = await client.get("/api/rooms", headers=oko_h)
    assert room_id in {r["id"] for r in oko_rooms.json()}


# --- list_rooms: протухшая строка room_members не протаскивает канал ----------


async def test_stale_channel_membership_does_not_leak_into_list(
    client: AsyncClient, session: AsyncSession, make_user: MakeUser
) -> None:
    """До фикса `Room.id.in_(member_rooms)` пускал ЛЮБУЮ комнату типа channel, у
    которой есть строка room_members, в обход тарифного фильтра — комната
    показывалась в списке и 403-ила на открытии. Тариф-эксклюзивный канал +
    вручную заведённая (протухшая) строка членства участника без нужного тарифа
    должны воспроизводить и фиксировать фикс.
    """
    admin = await make_user(role="admin")
    admin_h = await _headers(client, admin)
    plan_a = await _create_plan(client, admin_h, "Тариф А", 1000)
    without_plan = await make_user(intake_id=admin.intake_id, plan_id=None)

    created = await client.post(
        "/api/rooms",
        headers=admin_h,
        json={"type": "channel", "name": "Эксклюзив", "plan_ids": [plan_a]},
    )
    assert created.status_code == 201
    channel_id = created.json()["id"]

    # Протухшая строка членства — как если бы она завелась до того, как канал
    # стал тарифно-эксклюзивным (лениво под last_read_message_id).
    session.add(RoomMember(room_id=channel_id, user_id=without_plan.id))
    await session.commit()

    without_h = await _headers(client, without_plan)
    listed = await client.get("/api/rooms", headers=without_h)
    assert channel_id not in {r["id"] for r in listed.json()}
    direct = await client.get(f"/api/rooms/{channel_id}", headers=without_h)
    assert direct.status_code == 403


async def test_group_membership_still_listed_via_member_rooms(
    client: AsyncClient, make_user: MakeUser
) -> None:
    """Контроль: фикс не должен ломать обычный список групп/dm по членству."""
    admin = await make_user(role="admin")
    owner = await make_user(intake_id=admin.intake_id)
    owner_h = await _headers(client, owner)

    created = await client.post(
        "/api/rooms", headers=owner_h, json={"type": "group", "name": "G"}
    )
    assert created.status_code == 201
    room_id = created.json()["id"]

    listed = await client.get("/api/rooms", headers=owner_h)
    assert room_id in {r["id"] for r in listed.json()}
