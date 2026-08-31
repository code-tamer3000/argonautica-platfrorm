"""Тесты календаря (§4.10): авторство admin-only, project-wide видимость всем,
валидация дат, фильтр диапазона. Изоляция по потоку/тарифу — test_content_isolation.py
(ARG-96/ARG-111). Доступ проверяется на сервере на каждом запросе."""
from httpx import AsyncClient

from app.models.user import User

from .conftest import MakeUser, auth_headers, login


async def _headers(client: AsyncClient, user: User) -> dict[str, str]:
    tokens = await login(client, user.username, "initpass123")
    return auth_headers(tokens["access_token"])


async def _create(
    client: AsyncClient, headers: dict[str, str], **body: object
) -> dict:
    resp = await client.post("/api/calendar/events", headers=headers, json=body)
    assert resp.status_code == 201, resp.text
    return resp.json()


async def _event_ids(client: AsyncClient, headers: dict[str, str], **params: str) -> set[int]:
    resp = await client.get("/api/calendar/events", headers=headers, params=params)
    assert resp.status_code == 200, resp.text
    return {e["id"] for e in resp.json()}


async def test_project_wide_visible_to_all(
    client: AsyncClient,
    make_user: MakeUser,
) -> None:
    admin = await make_user(role="admin")
    member = await make_user()
    member_headers = await _headers(client, member)

    event = await _create(
        client,
        await _headers(client, admin),
        title="Всем",
        starts_at="2026-07-01T10:00:00Z",
    )
    assert event["intake_id"] is None
    assert event["plan_ids"] == []

    assert event["id"] in await _event_ids(client, member_headers)
    one = await client.get(f"/api/calendar/events/{event['id']}", headers=member_headers)
    assert one.status_code == 200


async def test_non_admin_cannot_author(
    client: AsyncClient,
    make_user: MakeUser,
) -> None:
    admin = await make_user(role="admin")
    member = await make_user()
    member_headers = await _headers(client, member)

    event = await _create(
        client, await _headers(client, admin), title="A", starts_at="2026-07-04T10:00:00Z"
    )

    created = await client.post(
        "/api/calendar/events",
        headers=member_headers,
        json={"title": "x", "starts_at": "2026-07-05T10:00:00Z"},
    )
    assert created.status_code == 403
    patched = await client.patch(
        f"/api/calendar/events/{event['id']}",
        headers=member_headers,
        json={"title": "y"},
    )
    assert patched.status_code == 403
    deleted = await client.delete(
        f"/api/calendar/events/{event['id']}", headers=member_headers
    )
    assert deleted.status_code == 403


async def test_update_and_delete(
    client: AsyncClient,
    make_user: MakeUser,
) -> None:
    admin = await make_user(role="admin")
    headers = await _headers(client, admin)

    event = await _create(client, headers, title="old", starts_at="2026-07-06T10:00:00Z")

    patched = await client.patch(
        f"/api/calendar/events/{event['id']}", headers=headers, json={"title": "new"}
    )
    assert patched.status_code == 200
    assert patched.json()["title"] == "new"

    deleted = await client.delete(
        f"/api/calendar/events/{event['id']}", headers=headers
    )
    assert deleted.status_code == 204
    gone = await client.get(f"/api/calendar/events/{event['id']}", headers=headers)
    assert gone.status_code == 404


async def test_ends_before_starts_rejected(
    client: AsyncClient,
    make_user: MakeUser,
) -> None:
    admin = await make_user(role="admin")
    headers = await _headers(client, admin)

    resp = await client.post(
        "/api/calendar/events",
        headers=headers,
        json={
            "title": "bad",
            "starts_at": "2026-07-10T12:00:00Z",
            "ends_at": "2026-07-10T11:00:00Z",
        },
    )
    assert resp.status_code == 422

    # И на PATCH согласованность дат проверяется по итогу.
    event = await _create(
        client,
        headers,
        title="ok",
        starts_at="2026-07-10T12:00:00Z",
        ends_at="2026-07-10T13:00:00Z",
    )
    bad_patch = await client.patch(
        f"/api/calendar/events/{event['id']}",
        headers=headers,
        json={"ends_at": "2026-07-10T11:00:00Z"},
    )
    assert bad_patch.status_code == 422


async def test_date_range_filter(
    client: AsyncClient,
    make_user: MakeUser,
) -> None:
    admin = await make_user(role="admin")
    headers = await _headers(client, admin)

    july = await _create(client, headers, title="июль", starts_at="2026-07-01T10:00:00Z")
    august = await _create(
        client, headers, title="август", starts_at="2026-08-01T10:00:00Z"
    )

    # from отсекает июльское, оставляет августовское.
    ids = await _event_ids(client, headers, **{"from": "2026-07-15T00:00:00Z"})
    assert august["id"] in ids
    assert july["id"] not in ids
