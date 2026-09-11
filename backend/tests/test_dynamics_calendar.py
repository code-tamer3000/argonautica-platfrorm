"""Календарь Динамики (ARG-126): my-days, полный период в админке, якорь по дате."""
from datetime import UTC, date, datetime, timedelta

from httpx import AsyncClient
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.journal import JournalCredit
from app.models.message import Message
from app.models.room import Room

from .conftest import AddMembership, MakeRoom, MakeUser, auth_headers, login


async def _personal_room(make_room: MakeRoom, add_membership: AddMembership, user_id: int) -> Room:
    room = await make_room(created_by=user_id, type="channel", name="Личный дневник")
    room.is_personal = True
    await add_membership(room.id, user_id, "owner")
    return room


def _day_status(days: list[dict], day: date) -> str | None:
    for d in days:
        if d["date"] == day.isoformat():
            return d["status"]
    return None


async def test_my_days_covers_full_program_window(
    client: AsyncClient, make_user: MakeUser
) -> None:
    """GET /api/dynamics/my-days отдаёт все 28 дней набора, не ±окно my-stats."""
    user = await make_user(role="participant", password="initpass123")
    tokens = await login(client, user.username, "initpass123")
    resp = await client.get(
        "/api/dynamics/my-days", headers=auth_headers(tokens["access_token"])
    )
    assert resp.status_code == 200, resp.text
    days = resp.json()
    assert len(days) == 28
    starts = date.fromisoformat(days[0]["date"])
    ends = date.fromisoformat(days[-1]["date"])
    assert (ends - starts).days == 27


async def test_my_days_hides_credited_vs_closed_distinction(
    client: AsyncClient,
    make_user: MakeUser,
    session: AsyncSession,
) -> None:
    """Участник не видит разницы между «закрыл сам» и «зачли админы» — оба дня
    приходят статусом closed. Админский полный период эту разницу сохраняет."""
    user = await make_user(role="participant", password="initpass123")
    day = date.today() - timedelta(days=1)
    session.add(JournalCredit(user_id=user.id, date=day, granted_by=user.id))
    await session.commit()

    tokens = await login(client, user.username, "initpass123")
    resp = await client.get(
        "/api/dynamics/my-days", headers=auth_headers(tokens["access_token"])
    )
    assert resp.status_code == 200, resp.text
    assert _day_status(resp.json(), day) == "closed"

    admin = await make_user(role="admin", password="adminpass123")
    admin_tokens = await login(client, admin.username, "adminpass123")
    admin_resp = await client.get(
        f"/api/admin/dynamics/{user.id}/days",
        headers=auth_headers(admin_tokens["access_token"]),
    )
    assert admin_resp.status_code == 200, admin_resp.text
    assert len(admin_resp.json()) == 28
    assert _day_status(admin_resp.json(), day) == "credited"

    # Мини-статистика виджета: зачтённый день тоже входит в closed_count.
    stats_resp = await client.get(
        "/api/dynamics/my-stats", headers=auth_headers(tokens["access_token"])
    )
    assert stats_resp.status_code == 200, stats_resp.text
    assert stats_resp.json()["closed_count"] == 1


async def test_partial_day_visible_but_still_counts_as_overdue(
    client: AsyncClient,
    make_user: MakeUser,
    make_room: MakeRoom,
    add_membership: AddMembership,
    session: AsyncSession,
) -> None:
    """Один написанный раздел из трёх (сид: focus/notes/film) — день 'partial' в
    календаре, но по-прежнему в просрочке (правила Динамики не меняются)."""
    user = await make_user(role="participant", password="initpass123")
    room = await _personal_room(make_room, add_membership, user.id)
    await session.commit()

    day = date.today() - timedelta(days=1)
    session.add(
        Message(
            room_id=room.id,
            sender_id=user.id,
            content="<!--journal:focus-->Фокус дня",
            created_at=datetime(day.year, day.month, day.day, 12, 0, tzinfo=UTC),
        )
    )
    await session.commit()

    tokens = await login(client, user.username, "initpass123")
    headers = auth_headers(tokens["access_token"])

    days_resp = await client.get("/api/dynamics/my-days", headers=headers)
    assert days_resp.status_code == 200, days_resp.text
    assert _day_status(days_resp.json(), day) == "partial"

    stats_resp = await client.get("/api/dynamics/my-stats", headers=headers)
    assert stats_resp.status_code == 200, stats_resp.text
    body = stats_resp.json()
    assert body["partial_count"] == 1
    assert day.isoformat() in body["overdue_dates"]


async def test_journal_anchor_prefers_exact_then_previous_then_next(
    client: AsyncClient,
    make_user: MakeUser,
    make_room: MakeRoom,
    add_membership: AddMembership,
    session: AsyncSession,
) -> None:
    user = await make_user(role="participant", password="initpass123")
    room = await _personal_room(make_room, add_membership, user.id)
    await session.commit()
    tokens = await login(client, user.username, "initpass123")
    headers = auth_headers(tokens["access_token"])

    # Пустая комната — якоря нет.
    empty = await client.get(
        f"/api/rooms/{room.id}/journal-anchor?date={date.today().isoformat()}",
        headers=headers,
    )
    assert empty.status_code == 200, empty.text
    assert empty.json() == {"message_id": None, "date": None}

    early_day = date.today() - timedelta(days=5)
    late_day = date.today() - timedelta(days=2)
    early_msg = Message(
        room_id=room.id,
        sender_id=user.id,
        content="<!--journal:focus-->Ранняя запись",
        created_at=datetime(early_day.year, early_day.month, early_day.day, 12, 0, tzinfo=UTC),
    )
    late_msg = Message(
        room_id=room.id,
        sender_id=user.id,
        content="<!--journal:focus-->Поздняя запись",
        created_at=datetime(late_day.year, late_day.month, late_day.day, 12, 0, tzinfo=UTC),
    )
    session.add_all([early_msg, late_msg])
    await session.commit()
    await session.refresh(early_msg)
    await session.refresh(late_msg)

    # Точное совпадение.
    exact = await client.get(
        f"/api/rooms/{room.id}/journal-anchor?date={late_day.isoformat()}",
        headers=headers,
    )
    assert exact.status_code == 200, exact.text
    assert exact.json() == {"message_id": late_msg.id, "date": late_day.isoformat()}

    # Между записями — ближайшая ПРЕДЫДУЩАЯ.
    between_day = late_day - timedelta(days=1)
    between = await client.get(
        f"/api/rooms/{room.id}/journal-anchor?date={between_day.isoformat()}",
        headers=headers,
    )
    assert between.status_code == 200, between.text
    assert between.json() == {"message_id": early_msg.id, "date": early_day.isoformat()}

    # Раньше самой ранней записи — ближайшая СЛЕДУЮЩАЯ.
    before_all = early_day - timedelta(days=3)
    before = await client.get(
        f"/api/rooms/{room.id}/journal-anchor?date={before_all.isoformat()}",
        headers=headers,
    )
    assert before.status_code == 200, before.text
    assert before.json() == {"message_id": early_msg.id, "date": early_day.isoformat()}


async def test_admin_user_days_rejects_unknown_user(
    client: AsyncClient, make_user: MakeUser
) -> None:
    admin = await make_user(role="admin", password="adminpass123")
    tokens = await login(client, admin.username, "adminpass123")
    resp = await client.get(
        "/api/admin/dynamics/999999999/days",
        headers=auth_headers(tokens["access_token"]),
    )
    assert resp.status_code == 404
