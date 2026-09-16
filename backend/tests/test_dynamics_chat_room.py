"""Задание может вести отписки в выбранную группу вместо личного дневника
(ARG-138): виджет и учёт прогресса переезжают в chat_room_id.

Как и в test_journal_structure.py: journal_programs — глобальная шкала, общая
для всей тестовой БД. Поэтому админ-CRUD тестируем с датой старта В БУДУЩЕМ, а
посуточное чтение из правильной комнаты — на чистых функциях/прямом вызове
`_load_journal_messages_for_user` с самодельной шкалой (без создания программ
в БД вообще).
"""
from datetime import UTC, date, datetime, timedelta

from httpx import AsyncClient
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.dynamics import (
    ProgramVersion,
    _calc_closed_days,
    _load_journal_messages_for_user,
    _platform_today,
    _room_segments,
)
from app.models.message import Message

from .conftest import AddMembership, MakeRoom, MakeUser, auth_headers, login


def _future_date(offset_days: int) -> str:
    return (_platform_today() + timedelta(days=3650 + offset_days)).isoformat()


# ─── Чистая логика разбиения на отрезки ─────────────────────────────────────

def test_room_segments_splits_at_every_program_boundary() -> None:
    v1 = ProgramVersion(starts_on=date(2026, 1, 1), keys=frozenset({"a"}))
    v2 = ProgramVersion(starts_on=date(2026, 1, 10), keys=frozenset({"a"}), chat_room_id=42)
    timeline = [v1, v2]

    segments = _room_segments(timeline, date(2026, 1, 1), date(2026, 1, 20))
    assert segments == [
        (date(2026, 1, 1), date(2026, 1, 9), v1),
        (date(2026, 1, 10), date(2026, 1, 20), v2),
    ]


def test_room_segments_empty_range_returns_nothing() -> None:
    assert _room_segments([], date(2026, 1, 5), date(2026, 1, 1)) == []


def test_room_segments_before_first_program_has_no_version() -> None:
    v1 = ProgramVersion(starts_on=date(2026, 1, 10), keys=frozenset({"a"}))
    segments = _room_segments([v1], date(2026, 1, 1), date(2026, 1, 20))
    assert segments[0] == (date(2026, 1, 1), date(2026, 1, 9), None)
    assert segments[1] == (date(2026, 1, 10), date(2026, 1, 20), v1)


# ─── Чтение отписок из правильной комнаты по дням (без БД-заданий) ─────────

async def test_messages_read_from_chat_room_only_after_boundary(
    make_user: MakeUser,
    make_room: MakeRoom,
    add_membership: AddMembership,
    session: AsyncSession,
) -> None:
    participant = await make_user(role="participant")
    other = await make_user(role="participant")
    personal = await make_room(created_by=participant.id, type="channel", name="Личный дневник")
    personal.is_personal = True
    group = await make_room(created_by=other.id, type="group", name="Поток")
    await add_membership(personal.id, participant.id, "owner")
    await add_membership(group.id, participant.id)
    await add_membership(group.id, other.id)
    await session.commit()

    today = _platform_today()
    before_day = today - timedelta(days=10)  # ещё личный дневник
    boundary = today - timedelta(days=5)  # с этого дня — задание ведёт в группу
    after_day = today - timedelta(days=2)  # уже под чат-заданием

    session.add_all(
        [
            Message(
                room_id=personal.id,
                sender_id=participant.id,
                content="<!--journal:focus-->до переезда в чат",
                created_at=datetime(before_day.year, before_day.month, before_day.day, 12, tzinfo=UTC),
            ),
            # Помечено, но написано в личном дневнике ПОСЛЕ переезда — источник
            # правды для этого дня теперь группа, личный дневник не читаем.
            Message(
                room_id=personal.id,
                sender_id=participant.id,
                content="<!--journal:focus-->мимо личного дневника",
                created_at=datetime(after_day.year, after_day.month, after_day.day, 9, tzinfo=UTC),
            ),
            Message(
                room_id=group.id,
                sender_id=participant.id,
                content="<!--journal:focus-->своя отписка в группе",
                created_at=datetime(after_day.year, after_day.month, after_day.day, 13, tzinfo=UTC),
            ),
            # Отписка ДРУГОГО участника той же группы в тот же день — не должна
            # попасть в прогресс `participant`.
            Message(
                room_id=group.id,
                sender_id=other.id,
                content="<!--journal:focus-->чужая отписка",
                created_at=datetime(after_day.year, after_day.month, after_day.day, 14, tzinfo=UTC),
            ),
        ]
    )
    await session.commit()

    timeline = [
        ProgramVersion(starts_on=before_day, keys=frozenset({"focus"}), order={"focus": 0}),
        ProgramVersion(
            starts_on=boundary,
            keys=frozenset({"focus"}),
            order={"focus": 0},
            chat_room_id=group.id,
        ),
    ]
    messages = await _load_journal_messages_for_user(
        session, participant.id, personal.id, timeline, before_day, today
    )
    assert len(messages) == 2  # ровно свои: до-переезда из дневника + из группы
    per_day = _calc_closed_days(messages)
    assert per_day == {before_day: {"focus"}, after_day: {"focus"}}


# ─── Эндпоинт структуры: поле chat_room_id ──────────────────────────────────

async def test_structure_defaults_chat_room_id_to_none(
    client: AsyncClient, make_user: MakeUser
) -> None:
    user = await make_user(role="participant", password="initpass123")
    tokens = await login(client, user.username, "initpass123")
    resp = await client.get(
        "/api/dynamics/structure", headers=auth_headers(tokens["access_token"])
    )
    assert resp.status_code == 200, resp.text
    assert resp.json()["chat_room_id"] is None


# ─── Общая комната: календарь показывает только СВОИ отписки ───────────────

async def test_journal_days_filters_by_sender_in_shared_room(
    client: AsyncClient,
    make_user: MakeUser,
    make_room: MakeRoom,
    add_membership: AddMembership,
    session: AsyncSession,
) -> None:
    """Если несколько человек отписываются в одну группу (задание с chat_room_id),
    календарь каждого должен показывать только ЕГО отписки — иначе прогресс
    одного подмешивался бы в статус дня у другого."""
    a = await make_user(role="participant", password="initpass123")
    b = await make_user(role="participant", password="initpass123")
    group = await make_room(created_by=a.id, type="group")
    await add_membership(group.id, a.id, "owner")
    await add_membership(group.id, b.id)
    await session.commit()

    day = date.today()
    session.add_all(
        [
            Message(
                room_id=group.id,
                sender_id=a.id,
                content="<!--journal:focus-->A пишет",
                created_at=datetime(day.year, day.month, day.day, 10, tzinfo=UTC),
            ),
            Message(
                room_id=group.id,
                sender_id=b.id,
                content="<!--journal:notes-->B пишет",
                created_at=datetime(day.year, day.month, day.day, 11, tzinfo=UTC),
            ),
        ]
    )
    await session.commit()

    tokens_a = await login(client, a.username, "initpass123")
    resp = await client.get(
        f"/api/rooms/{group.id}/journal-days?year={day.year}&month={day.month}",
        headers=auth_headers(tokens_a["access_token"]),
    )
    assert resp.status_code == 200, resp.text
    assert resp.json()[day.isoformat()] == ["focus"]  # не "notes" — это отписка B


# ─── Админ-CRUD: валидация и roundtrip chat_room_id ─────────────────────────

async def test_admin_program_chat_room_must_be_a_group(
    client: AsyncClient, make_user: MakeUser, make_room: MakeRoom
) -> None:
    admin = await make_user(role="admin", password="adminpass123")
    headers = auth_headers((await login(client, admin.username, "adminpass123"))["access_token"])
    dm = await make_room(created_by=admin.id, type="dm", name=None)

    resp = await client.post(
        "/api/admin/journal/programs",
        headers=headers,
        json={
            "starts_on": _future_date(300),
            "title": None,
            "description": None,
            "chat_room_id": dm.id,
            "sections": [{"key": "focus", "label": "Фокус"}],
        },
    )
    assert resp.status_code == 400, resp.text


async def test_admin_program_rejects_nonexistent_chat_room(
    client: AsyncClient, make_user: MakeUser
) -> None:
    admin = await make_user(role="admin", password="adminpass123")
    headers = auth_headers((await login(client, admin.username, "adminpass123"))["access_token"])
    resp = await client.post(
        "/api/admin/journal/programs",
        headers=headers,
        json={
            "starts_on": _future_date(301),
            "title": None,
            "description": None,
            "chat_room_id": 999_999_999,
            "sections": [{"key": "focus", "label": "Фокус"}],
        },
    )
    assert resp.status_code == 404, resp.text


async def test_admin_program_with_group_chat_room_roundtrips(
    client: AsyncClient, make_user: MakeUser, make_room: MakeRoom
) -> None:
    admin = await make_user(role="admin", password="adminpass123")
    headers = auth_headers((await login(client, admin.username, "adminpass123"))["access_token"])
    group = await make_room(created_by=admin.id, type="group")

    created = await client.post(
        "/api/admin/journal/programs",
        headers=headers,
        json={
            "starts_on": _future_date(302),
            "title": "В чат",
            "description": None,
            "chat_room_id": group.id,
            "sections": [{"key": "focus", "label": "Фокус"}],
        },
    )
    assert created.status_code == 201, created.text
    assert created.json()["chat_room_id"] == group.id
    program_id = created.json()["id"]

    try:
        # Снять маршрут обратно на личный дневник.
        patched = await client.patch(
            f"/api/admin/journal/programs/{program_id}",
            headers=headers,
            json={"chat_room_id": None},
        )
        assert patched.status_code == 200, patched.text
        assert patched.json()["chat_room_id"] is None
    finally:
        await client.delete(f"/api/admin/journal/programs/{program_id}", headers=headers)
