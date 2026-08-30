"""Круг Экспедиции: раскладка расписания (чистые функции) + API замков.

Раскладка/фолбэк/состояние замка не трогают БД — тестируются как чистые функции
(app.services.expedition). Ввод замка — через API: 403 до эфира, upsert без
дублей, `hexagram` выводится сервером по номеру ключа (см. таблицу King Wen).
"""
from datetime import UTC, date, datetime, time, timedelta

from httpx import AsyncClient
from sqlalchemy import delete
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.expedition import IntakeStage
from app.models.user import User
from app.services.expedition import (
    KING_WEN,
    circle_day_number,
    fallback_stages,
    hexagram_for,
    layout_stages,
    lock_state,
    unlock_moment,
)

from .conftest import MakeUser, auth_headers, get_or_create_intake, login


def _stage(kind: str, air_date: date, task_id: int | None = None) -> IntakeStage:
    return IntakeStage(kind=kind, air_date=air_date, air_time=None, task_id=task_id)


# --- layout_stages -----------------------------------------------------------


def test_layout_stages_matches_expedition_calendar() -> None:
    """Даты из реального расписания (31.08 → 27.09) → 4/6/6/5/6/1 = 28 дней."""
    stages = [
        _stage("balance", date(2026, 8, 31)),
        _stage("air", date(2026, 9, 4)),
        _stage("fire", date(2026, 9, 10)),
        _stage("water", date(2026, 9, 16)),
        _stage("earth", date(2026, 9, 21)),
        _stage("final", date(2026, 9, 27)),
    ]
    spans = layout_stages(stages, date(2026, 8, 31))
    assert [(s.kind, s.day_from, s.day_to) for s in spans] == [
        ("balance", 1, 4),
        ("air", 5, 10),
        ("fire", 11, 16),
        ("water", 17, 21),
        ("earth", 22, 27),
        ("final", 28, 28),
    ]
    assert spans[-1].day_to == 28


def test_layout_stages_ignores_input_order() -> None:
    """Порядок этапов — STAGE_KINDS, не порядок строк из БД (не по air_date)."""
    stages = [
        _stage("final", date(2026, 9, 27)),
        _stage("balance", date(2026, 8, 31)),
        _stage("earth", date(2026, 9, 21)),
        _stage("air", date(2026, 9, 4)),
        _stage("water", date(2026, 9, 16)),
        _stage("fire", date(2026, 9, 10)),
    ]
    spans = layout_stages(stages, date(2026, 8, 31))
    assert [s.kind for s in spans] == ["balance", "air", "fire", "water", "earth", "final"]


def test_layout_stages_partial_schedule() -> None:
    """Неполное расписание (не все шесть) — раскладывает то, что есть, без падения."""
    stages = [_stage("air", date(2026, 9, 4)), _stage("fire", date(2026, 9, 10))]
    spans = layout_stages(stages, date(2026, 9, 4))
    assert [(s.kind, s.day_from, s.day_to) for s in spans] == [
        ("air", 1, 6),
        ("fire", 7, 7),
    ]


def test_layout_stages_empty() -> None:
    assert layout_stages([], date(2026, 8, 31)) == []


def test_fallback_stages_equal_quarters() -> None:
    spans = fallback_stages(date(2026, 8, 31))
    assert [(s.kind, s.day_from, s.day_to) for s in spans] == [
        ("air", 1, 7),
        ("fire", 8, 14),
        ("water", 15, 21),
        ("earth", 22, 28),
    ]
    # Точки Баланса/Финала в фолбэке нет — их даты не заведены.
    assert {s.kind for s in spans} == {"air", "fire", "water", "earth"}


def test_circle_day_number_bounds() -> None:
    spans = layout_stages(
        [_stage("air", date(2026, 9, 4)), _stage("fire", date(2026, 9, 10))],
        date(2026, 9, 4),
    )
    assert circle_day_number(spans, date(2026, 9, 3)) is None  # до старта
    assert circle_day_number(spans, date(2026, 9, 4)) == 1
    assert circle_day_number(spans, date(2026, 9, 10)) == 7
    assert circle_day_number(spans, date(2026, 9, 11)) is None  # после конца


# --- unlock_moment / lock_state -----------------------------------------------


def test_unlock_moment_uses_air_time_msk() -> None:
    stage = IntakeStage(kind="air", air_date=date(2026, 9, 4), air_time=time(20, 0))
    moment = unlock_moment(stage)
    assert moment.hour == 20
    assert moment.utcoffset() == timedelta(hours=3)


def test_unlock_moment_defaults_to_midnight() -> None:
    stage = IntakeStage(kind="air", air_date=date(2026, 9, 4), air_time=None)
    moment = unlock_moment(stage)
    assert (moment.hour, moment.minute) == (0, 0)


def test_lock_state_transitions() -> None:
    stage = IntakeStage(kind="air", air_date=date(2026, 9, 4), air_time=None, task_id=1)
    before = datetime(2026, 9, 3, tzinfo=UTC)
    after = datetime(2026, 9, 5, tzinfo=UTC)

    assert lock_state(stage, None, None, now=before) == "locked"
    assert lock_state(stage, None, None, now=after) == "unlockable"
    assert lock_state(stage, object(), None, now=after) == "entered"
    assert lock_state(stage, object(), "submitted", now=after) == "entered"
    assert lock_state(stage, object(), "accepted", now=after) == "revealed"
    assert lock_state(None, None, None, now=after) == "locked"


def test_lock_state_no_task_stops_at_entered() -> None:
    """Этап без привязанного задания (task_id=None) не доходит до «раскрыт»."""
    stage = IntakeStage(kind="air", air_date=date(2026, 9, 4), air_time=None, task_id=None)
    after = datetime(2026, 9, 5, tzinfo=UTC)
    assert lock_state(stage, object(), None, now=after) == "entered"


def test_hexagram_for_matches_king_wen_table() -> None:
    assert hexagram_for(1) == "111111"
    assert hexagram_for(64) == "010101"
    assert len(KING_WEN) == 64
    assert len(set(KING_WEN.values())) == 64  # все различны


# --- API: /api/expedition/locks ----------------------------------------------


async def _headers(client: AsyncClient, user: User) -> dict[str, str]:
    tokens = await login(client, user.username, "initpass123")
    return auth_headers(tokens["access_token"])


async def _set_stages(session: AsyncSession, intake_id: int, stages: list[IntakeStage]) -> None:
    # Тестовая БД переживает прогоны, а get_or_create_intake переиспользует набор
    # по starts_on — без очистки два теста на одной относительной дате столкнутся
    # на UNIQUE(intake_id, kind) второго прогона.
    await session.execute(delete(IntakeStage).where(IntakeStage.intake_id == intake_id))
    for s in stages:
        s.intake_id = intake_id
        session.add(s)
    await session.commit()


async def test_put_lock_before_air_date_forbidden(
    client: AsyncClient, make_user: MakeUser, session: AsyncSession
) -> None:
    tomorrow = date.today() + timedelta(days=1)
    intake = await get_or_create_intake(session, date.today() - timedelta(days=1))
    user = await make_user(intake_id=intake.id)
    await _set_stages(
        session, intake.id, [_stage("air", tomorrow)]
    )
    headers = await _headers(client, user)

    resp = await client.put(
        "/api/expedition/locks/air", headers=headers, json={"key_number": 1}
    )
    assert resp.status_code == 403, resp.text


async def test_put_lock_after_air_date_and_upsert(
    client: AsyncClient, make_user: MakeUser, session: AsyncSession
) -> None:
    yesterday = date.today() - timedelta(days=1)
    intake = await get_or_create_intake(session, date.today() - timedelta(days=2))
    user = await make_user(intake_id=intake.id)
    await _set_stages(session, intake.id, [_stage("air", yesterday)])
    headers = await _headers(client, user)

    first = await client.put(
        "/api/expedition/locks/air", headers=headers, json={"key_number": 1}
    )
    assert first.status_code == 200, first.text
    body = first.json()
    assert body["element"] == "air"
    assert body["key_number"] == 1
    assert body["hexagram"] == "111111"  # выведен сервером по таблице Кинг Вэня

    # Повторный ввод той же стихии правит запись, не плодит вторую.
    second = await client.put(
        "/api/expedition/locks/air", headers=headers, json={"key_number": 64}
    )
    assert second.status_code == 200, second.text
    assert second.json()["key_number"] == 64
    assert second.json()["hexagram"] == "010101"

    listed = await client.get("/api/expedition/locks", headers=headers)
    assert listed.status_code == 200
    rows = listed.json()
    assert len(rows) == 1
    assert rows[0]["key_number"] == 64


async def test_put_lock_rejects_out_of_range_key_number(
    client: AsyncClient, make_user: MakeUser, session: AsyncSession
) -> None:
    yesterday = date.today() - timedelta(days=1)
    intake = await get_or_create_intake(session, date.today() - timedelta(days=2))
    user = await make_user(intake_id=intake.id)
    await _set_stages(session, intake.id, [_stage("air", yesterday)])
    headers = await _headers(client, user)

    resp = await client.put(
        "/api/expedition/locks/air", headers=headers, json={"key_number": 65}
    )
    assert resp.status_code == 422


async def test_observer_has_no_expedition_access(
    client: AsyncClient, make_user: MakeUser
) -> None:
    observer = await make_user(is_observer=True)
    headers = await _headers(client, observer)
    resp = await client.get("/api/expedition/locks", headers=headers)
    assert resp.status_code == 403, resp.text


async def test_graduated_participant_can_still_enter_lock(
    client: AsyncClient, make_user: MakeUser, session: AsyncSession
) -> None:
    """Выпускник теряет Динамику, но замки остаются вводимыми — смысл добирают
    и после финиша (см. plan «Края»)."""
    yesterday = date.today() - timedelta(days=1)
    intake = await get_or_create_intake(session, date.today() - timedelta(days=30))
    user = await make_user(
        intake_id=intake.id, graduated_at=datetime.now(UTC) - timedelta(days=1)
    )
    await _set_stages(session, intake.id, [_stage("air", yesterday)])
    headers = await _headers(client, user)

    resp = await client.put(
        "/api/expedition/locks/air", headers=headers, json={"key_number": 5}
    )
    assert resp.status_code == 200, resp.text
