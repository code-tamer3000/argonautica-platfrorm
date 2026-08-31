"""Каскадная видимость по рангу тарифа (ARG-110): контакт-лист «начать чат»/
группа, IDOR-check на POST /api/rooms, асимметрия записи в dm админ↔игрок,
навигатор. Личные дневники («Все дневники») из-под этого каскада выведены
(ARG-112) — видимость дневника только по потоку, тесты ниже это фиксируют.

Ранг = позиция тарифа по цене (возрастание) среди тарифов, которые реально
держат участники потока (см. app/services/visibility.py `cohort_plan_ranks`).
Писать НЕ-навигатор-админу могут только два самых дорогих тарифа.
"""
import itertools
from datetime import date, timedelta

from httpx import AsyncClient
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.room import Room
from app.models.user import User

from .conftest import MakeUser, auth_headers, login

# Каждый тест заводит свой поток (уникальная starts_on): intakes дедуплицируются
# по дате (get_or_create_intake), а cohort_plan_ranks считает ранги по ВСЕМ
# тарифам, которые держат участники intake — общий intake между тестами тихо
# смешал бы их тарифы/ранги. Отсчёт далеко в прошлое, чтобы не пересечься с
# дефолтным (today-7) или другими фиксированными смещениями в других файлах.
_intake_offset = itertools.count(500)


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
    """Один поток, три тарифа по возрастанию цены (игрок/спецотряд/око) — по
    одному участнику каждого + первый (для создания тарифов) как admin потока.
    """
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


async def _make_personal_room(session: AsyncSession, owner_id: int) -> Room:
    room = Room(type="channel", name="Дневник", is_personal=True, created_by=owner_id)
    session.add(room)
    await session.commit()
    await session.refresh(room)
    return room


# --- GET /api/users/contacts: каскад по рангу ---------------------------------


async def test_contacts_cascade_visibility(
    client: AsyncClient, make_user: MakeUser
) -> None:
    """Каскад среди УЧАСТНИКОВ (без admin — та ветка отдельно в
    test_contacts_admin_visible_only_to_top_two, чтобы не путать два правила)."""
    _, users = await _three_tier_cohort(client, make_user)

    async def participant_ids(viewer: User) -> set[int]:
        resp = await client.get("/api/users/contacts", headers=await _headers(client, viewer))
        return {u["id"] for u in resp.json() if u["role"] != "admin"}

    assert await participant_ids(users["player"]) == set()  # никого ниже себя нет
    assert await participant_ids(users["squad"]) == {users["player"].id}
    assert await participant_ids(users["oko"]) == {users["player"].id, users["squad"].id}


async def test_contacts_hidden_across_intake(
    client: AsyncClient, make_user: MakeUser
) -> None:
    _, users = await _three_tier_cohort(client, make_user)
    other = await make_user(intake_starts_on=date.today() - timedelta(days=1))

    ids = {
        u["id"]
        for u in (
            await client.get("/api/users/contacts", headers=await _headers(client, users["oko"]))
        ).json()
    }
    assert other.id not in ids


async def test_contacts_admin_visible_only_to_top_two(
    client: AsyncClient, make_user: MakeUser
) -> None:
    """Обычный (не-навигатор) admin виден в контактах только топ-2 тарифов потока."""
    _, users = await _three_tier_cohort(client, make_user)

    player_ids = {
        u["id"]
        for u in (
            await client.get(
                "/api/users/contacts", headers=await _headers(client, users["player"])
            )
        ).json()
    }
    assert users["admin"].id not in player_ids

    for role in ("squad", "oko"):
        ids = {
            u["id"]
            for u in (
                await client.get(
                    "/api/users/contacts", headers=await _headers(client, users[role])
                )
            ).json()
        }
        assert users["admin"].id in ids


async def test_contacts_navigator_visible_to_everyone(
    client: AsyncClient, make_user: MakeUser
) -> None:
    _, users = await _three_tier_cohort(client, make_user)
    admin_h = await _headers(client, users["admin"])
    nav = await client.patch(
        f"/api/admin/users/{users['admin'].id}", headers=admin_h, json={"is_navigator": True}
    )
    assert nav.status_code == 200 and nav.json()["is_navigator"] is True

    ids = {
        u["id"]
        for u in (
            await client.get(
                "/api/users/contacts", headers=await _headers(client, users["player"])
            )
        ).json()
    }
    assert users["admin"].id in ids


async def test_is_navigator_requires_admin_role(
    client: AsyncClient, make_user: MakeUser
) -> None:
    admin = await make_user(role="admin")
    admin_h = await _headers(client, admin)
    participant = await make_user()
    resp = await client.patch(
        f"/api/admin/users/{participant.id}", headers=admin_h, json={"is_navigator": True}
    )
    assert resp.status_code == 400


# --- POST /api/rooms: peer-check (IDOR из «Зачем») -----------------------------


async def test_dm_outside_visible_circle_rejected(
    client: AsyncClient, make_user: MakeUser
) -> None:
    _, users = await _three_tier_cohort(client, make_user)
    resp = await client.post(
        "/api/rooms",
        headers=await _headers(client, users["player"]),
        json={"type": "dm", "peer_id": users["squad"].id},
    )
    assert resp.status_code == 403


async def test_dm_within_visible_circle_allowed(
    client: AsyncClient, make_user: MakeUser
) -> None:
    _, users = await _three_tier_cohort(client, make_user)
    resp = await client.post(
        "/api/rooms",
        headers=await _headers(client, users["squad"]),
        json={"type": "dm", "peer_id": users["player"].id},
    )
    assert resp.status_code == 201


async def test_admin_dm_bypasses_rank_check(
    client: AsyncClient, make_user: MakeUser
) -> None:
    """Admin инициирует dm с игроком без ранговых ограничений (часть B)."""
    _, users = await _three_tier_cohort(client, make_user)
    resp = await client.post(
        "/api/rooms",
        headers=await _headers(client, users["admin"]),
        json={"type": "dm", "peer_id": users["player"].id},
    )
    assert resp.status_code == 201


async def test_group_invite_outside_circle_rejected(
    client: AsyncClient, make_user: MakeUser
) -> None:
    _, users = await _three_tier_cohort(client, make_user)
    player_h = await _headers(client, users["player"])
    group = await client.post(
        "/api/rooms", headers=player_h, json={"type": "group", "name": "G"}
    )
    room_id = group.json()["id"]
    resp = await client.post(
        f"/api/rooms/{room_id}/members", headers=player_h, json={"user_id": users["squad"].id}
    )
    assert resp.status_code == 403


# --- Асимметрия записи в dm админ↔игрок (часть B) -------------------------------


async def test_dm_admin_write_asymmetry(
    client: AsyncClient, make_user: MakeUser
) -> None:
    _, users = await _three_tier_cohort(client, make_user)
    admin_h = await _headers(client, users["admin"])
    player_h = await _headers(client, users["player"])

    created = await client.post(
        "/api/rooms", headers=admin_h, json={"type": "dm", "peer_id": users["player"].id}
    )
    assert created.status_code == 201
    room_id = created.json()["id"]

    # Админ пишет свободно.
    sent = await client.post(
        f"/api/rooms/{room_id}/messages", headers=admin_h, json={"content": "hi"}
    )
    assert sent.status_code == 201

    # Игрок (не топ-2) ответить не может — сервер 403-ит, не только фронт прячет.
    denied = await client.post(
        f"/api/rooms/{room_id}/messages", headers=player_h, json={"content": "hi back"}
    )
    assert denied.status_code == 403

    # RoomOut отражает блокировку для игрока и НЕ отражает для админа.
    player_view = await client.get(f"/api/rooms/{room_id}", headers=player_h)
    assert player_view.json()["dm_write_locked"] is True
    admin_view = await client.get(f"/api/rooms/{room_id}", headers=admin_h)
    assert admin_view.json()["dm_write_locked"] is False


async def test_dm_admin_write_allowed_for_top_tier(
    client: AsyncClient, make_user: MakeUser
) -> None:
    _, users = await _three_tier_cohort(client, make_user)
    admin_h = await _headers(client, users["admin"])
    squad_h = await _headers(client, users["squad"])

    created = await client.post(
        "/api/rooms", headers=squad_h, json={"type": "dm", "peer_id": users["admin"].id}
    )
    assert created.status_code == 201
    room_id = created.json()["id"]

    reply = await client.post(
        f"/api/rooms/{room_id}/messages", headers=squad_h, json={"content": "hi"}
    )
    assert reply.status_code == 201

    view = await client.get(f"/api/rooms/{room_id}", headers=squad_h)
    assert view.json()["dm_write_locked"] is False


async def test_dm_navigator_write_allowed_for_any_tier(
    client: AsyncClient, make_user: MakeUser
) -> None:
    _, users = await _three_tier_cohort(client, make_user)
    admin_h = await _headers(client, users["admin"])
    await client.patch(
        f"/api/admin/users/{users['admin'].id}", headers=admin_h, json={"is_navigator": True}
    )
    player_h = await _headers(client, users["player"])

    created = await client.post(
        "/api/rooms", headers=admin_h, json={"type": "dm", "peer_id": users["player"].id}
    )
    room_id = created.json()["id"]

    reply = await client.post(
        f"/api/rooms/{room_id}/messages", headers=player_h, json={"content": "hi back"}
    )
    assert reply.status_code == 201

    view = await client.get(f"/api/rooms/{room_id}", headers=player_h)
    assert view.json()["dm_write_locked"] is False


# --- «Все дневники»: вне рангового каскада, только поток (ARG-112) -------------


async def test_diary_visible_across_plans_same_intake(
    client: AsyncClient, session: AsyncSession, make_user: MakeUser
) -> None:
    """Дневники НЕ участвуют в ранговом каскаде (ARG-112, было ARG-110/часть C):
    игрок видит дневник спецотряда и наоборот — единственное ограничение
    видимости дневника внутри «Все дневники» это общий поток."""
    _, users = await _three_tier_cohort(client, make_user)
    player_room = await _make_personal_room(session, users["player"].id)
    squad_room = await _make_personal_room(session, users["squad"].id)

    squad_h = await _headers(client, users["squad"])
    seen = await client.get(f"/api/rooms/{player_room.id}", headers=squad_h)
    assert seen.status_code == 200
    listed = await client.get("/api/rooms", headers=squad_h)
    assert player_room.id in {r["id"] for r in listed.json()}

    player_h = await _headers(client, users["player"])
    seen_back = await client.get(f"/api/rooms/{squad_room.id}", headers=player_h)
    assert seen_back.status_code == 200
    own_listed = await client.get("/api/rooms", headers=player_h)
    ids = {r["id"] for r in own_listed.json()}
    assert squad_room.id in ids
    assert player_room.id in ids  # свой собственный виден всегда


async def test_admin_diary_hidden_from_others(
    client: AsyncClient, session: AsyncSession, make_user: MakeUser
) -> None:
    """`create_user` заводит личный дневник любому аккаунту, включая admin — но
    Динамика не для админов, так что чужой admin-дневник не должен светиться в
    «Все дневники». Видимость дневника теперь не завязана на тариф (ARG-112) —
    без явного исключения по роли он был бы виден любому того же потока."""
    _, users = await _three_tier_cohort(client, make_user)
    admin_room = await _make_personal_room(session, users["admin"].id)

    oko_h = await _headers(client, users["oko"])
    hidden = await client.get(f"/api/rooms/{admin_room.id}", headers=oko_h)
    assert hidden.status_code == 403
    listed = await client.get("/api/rooms", headers=oko_h)
    assert admin_room.id not in {r["id"] for r in listed.json()}


async def test_admin_diary_labeled_admin_for_admin_viewer(
    client: AsyncClient, session: AsyncSession, make_user: MakeUser
) -> None:
    """Другой admin по-прежнему видит чужой admin-дневник (полный оверсайт), и он
    подписан «Админ» с sentinel `owner_plan_id` (см. _owner_plan_label) — НЕ
    `None`, иначе клиентская группировка (`groupByPlan`, ключуется по id) молча
    свалила бы его в «Без тарифа» вместо отдельной секции."""
    _, users = await _three_tier_cohort(client, make_user)
    admin_room = await _make_personal_room(session, users["admin"].id)
    other_admin = await make_user(role="admin", intake_id=users["admin"].intake_id)

    seen = await client.get(
        f"/api/rooms/{admin_room.id}", headers=await _headers(client, other_admin)
    )
    assert seen.status_code == 200
    assert seen.json()["owner_plan_name"] == "Админ"
    assert seen.json()["owner_plan_id"] is not None

    listed = await client.get("/api/rooms", headers=await _headers(client, other_admin))
    row = next(r for r in listed.json() if r["id"] == admin_room.id)
    assert row["owner_plan_name"] == "Админ"
    assert row["owner_plan_id"] is not None


# --- Контакт-лист: админ хвостовым блоком, не «Без тарифа» ---------------------


async def test_contacts_admin_sorted_after_participants(
    client: AsyncClient, make_user: MakeUser
) -> None:
    """Безтарифный admin не должен перемешиваться по алфавиту с безтарифными
    участниками (оба ранга 0) — сортировка кладёт всех admin хвостовым блоком."""
    _, users = await _three_tier_cohort(client, make_user)
    # Имя нарочно ПОСЛЕ "Test User" (display_name admin'а по умолчанию) по алфавиту —
    # без отдельного ключа по роли чистая сортировка по display_name поставила бы
    # admin ПЕРВЫМ, и тест не поймал бы регресс, если роль-ключ убрать.
    plain = await make_user(intake_id=users["oko"].intake_id, display_name="Zzz Participant")

    resp = await client.get("/api/users/contacts", headers=await _headers(client, users["oko"]))
    ids = [u["id"] for u in resp.json()]
    assert ids.index(plain.id) < ids.index(users["admin"].id)
