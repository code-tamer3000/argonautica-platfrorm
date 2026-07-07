"""Тесты раздела «Каюта»: приватность записей (видит только автор), админский
просмотр, проверка владения на правке/удалении, совпадение kind в URL и data.
Доступ проверяется на сервере на каждом запросе (п.1 CLAUDE.md)."""
from httpx import AsyncClient

from app.models.user import User

from .conftest import MakeUser, auth_headers, login


async def _headers(client: AsyncClient, user: User) -> dict[str, str]:
    tokens = await login(client, user.username, "initpass123")
    return auth_headers(tokens["access_token"])


def _diary(**over: object) -> dict:
    base = {"kind": "diary", "date": "27.09", "trigger": "т", "strength": 8}
    base.update(over)
    return {"data": base}


async def test_create_and_list_own(client: AsyncClient, make_user: MakeUser) -> None:
    user = await make_user(can_access_cabin=True)
    h = await _headers(client, user)

    resp = await client.post("/api/cabin/diary", headers=h, json=_diary())
    assert resp.status_code == 201, resp.text
    entry = resp.json()
    assert entry["kind"] == "diary"
    assert entry["data"]["strength"] == 8

    resp = await client.get("/api/cabin/diary", headers=h)
    assert resp.status_code == 200
    assert [e["id"] for e in resp.json()] == [entry["id"]]


async def test_entries_are_private(client: AsyncClient, make_user: MakeUser) -> None:
    author = await make_user(can_access_cabin=True)
    other = await make_user(can_access_cabin=True)
    ha = await _headers(client, author)
    ho = await _headers(client, other)

    await client.post("/api/cabin/diary", headers=ha, json=_diary())

    # Другой участник не видит чужих записей.
    resp = await client.get("/api/cabin/diary", headers=ho)
    assert resp.status_code == 200
    assert resp.json() == []


async def test_kind_mismatch_rejected(client: AsyncClient, make_user: MakeUser) -> None:
    user = await make_user(can_access_cabin=True)
    h = await _headers(client, user)
    # data.kind=diary, но URL — trigger.
    resp = await client.post("/api/cabin/trigger", headers=h, json=_diary())
    assert resp.status_code == 400


async def test_strength_out_of_range(client: AsyncClient, make_user: MakeUser) -> None:
    user = await make_user(can_access_cabin=True)
    h = await _headers(client, user)
    resp = await client.post("/api/cabin/diary", headers=h, json=_diary(strength=11))
    assert resp.status_code == 422


async def test_cannot_edit_or_delete_others(
    client: AsyncClient, make_user: MakeUser
) -> None:
    author = await make_user(can_access_cabin=True)
    other = await make_user(can_access_cabin=True)
    ha = await _headers(client, author)
    ho = await _headers(client, other)

    created = (await client.post("/api/cabin/diary", headers=ha, json=_diary())).json()
    eid = created["id"]

    # Чужая правка/удаление → 404 (не раскрываем существование).
    upd = await client.put(f"/api/cabin/diary/{eid}", headers=ho, json=_diary(trigger="x"))
    assert upd.status_code == 404
    assert (await client.delete(f"/api/cabin/diary/{eid}", headers=ho)).status_code == 404

    # Свою — можно.
    upd = await client.put(f"/api/cabin/diary/{eid}", headers=ha, json=_diary(trigger="x"))
    assert upd.status_code == 200
    assert (await client.delete(f"/api/cabin/diary/{eid}", headers=ha)).status_code == 204


async def test_admin_sees_participant_entries(
    client: AsyncClient, make_user: MakeUser
) -> None:
    participant = await make_user(can_access_cabin=True)
    admin = await make_user(role="admin")
    hp = await _headers(client, participant)
    hadm = await _headers(client, admin)

    await client.post("/api/cabin/diary", headers=hp, json=_diary())

    # Сужаем до участника — БД в suite общая между тестами, чужие записи не мешают.
    resp = await client.get(
        "/api/cabin/admin/diary", headers=hadm, params={"user_id": participant.id}
    )
    assert resp.status_code == 200
    rows = resp.json()
    assert len(rows) == 1
    assert rows[0]["user_id"] == participant.id
    assert "display_name" in rows[0]


async def test_admin_view_requires_admin(
    client: AsyncClient, make_user: MakeUser
) -> None:
    participant = await make_user()
    hp = await _headers(client, participant)
    resp = await client.get("/api/cabin/admin/diary", headers=hp)
    assert resp.status_code == 403


async def test_admin_users_lists_authors_with_counts(
    client: AsyncClient, make_user: MakeUser
) -> None:
    participant = await make_user(can_access_cabin=True)
    admin = await make_user(role="admin")
    hp = await _headers(client, participant)
    hadm = await _headers(client, admin)

    # Две записи в разных подразделах — считаются в общий total участника.
    await client.post("/api/cabin/diary", headers=hp, json=_diary())
    await client.post(
        "/api/cabin/trigger",
        headers=hp,
        json={"data": {"kind": "trigger", "age": "5", "strength": 3}},
    )

    resp = await client.get("/api/cabin/admin/users", headers=hadm)
    assert resp.status_code == 200
    mine = [u for u in resp.json() if u["user_id"] == participant.id]
    assert len(mine) == 1
    assert mine[0]["total"] == 2
    assert mine[0]["display_name"]


async def test_admin_users_requires_admin(
    client: AsyncClient, make_user: MakeUser
) -> None:
    participant = await make_user()
    hp = await _headers(client, participant)
    resp = await client.get("/api/cabin/admin/users", headers=hp)
    assert resp.status_code == 403


async def test_cabin_closed_by_default(client: AsyncClient, make_user: MakeUser) -> None:
    """Без выданного доступа личные эндпоинты Каюты отдают 403."""
    user = await make_user()  # can_access_cabin=False по умолчанию
    h = await _headers(client, user)
    assert (await client.get("/api/cabin/diary", headers=h)).status_code == 403
    assert (
        await client.post("/api/cabin/diary", headers=h, json=_diary())
    ).status_code == 403


async def test_admin_grant_opens_access_and_notifies(
    client: AsyncClient, make_user: MakeUser
) -> None:
    """Админ выдаёт доступ через PATCH — участник получает доступ и уведомление."""
    participant = await make_user()
    admin = await make_user(role="admin")
    hp = await _headers(client, participant)
    hadm = await _headers(client, admin)

    # До выдачи — закрыто.
    assert (await client.get("/api/cabin/diary", headers=hp)).status_code == 403

    resp = await client.patch(
        f"/api/admin/users/{participant.id}",
        headers=hadm,
        json={"can_access_cabin": True},
    )
    assert resp.status_code == 200, resp.text
    assert resp.json()["can_access_cabin"] is True

    # Доступ открылся.
    assert (await client.get("/api/cabin/diary", headers=hp)).status_code == 200

    # В ленте участника появилось системное уведомление о выдаче (без комнаты).
    feed = (await client.get("/api/notifications", headers=hp)).json()
    granted = [n for n in feed["items"] if n["kind"] == "cabin_granted"]
    assert len(granted) == 1
    assert granted[0]["room_id"] is None
    assert granted[0]["actor_id"] is None


async def test_admin_grant_is_idempotent_no_duplicate_notification(
    client: AsyncClient, make_user: MakeUser
) -> None:
    """Повторный PATCH с уже открытым доступом не плодит уведомления."""
    participant = await make_user()
    admin = await make_user(role="admin")
    hp = await _headers(client, participant)
    hadm = await _headers(client, admin)

    body = {"can_access_cabin": True}
    await client.patch(f"/api/admin/users/{participant.id}", headers=hadm, json=body)
    await client.patch(f"/api/admin/users/{participant.id}", headers=hadm, json=body)

    feed = (await client.get("/api/notifications", headers=hp)).json()
    granted = [n for n in feed["items"] if n["kind"] == "cabin_granted"]
    assert len(granted) == 1
