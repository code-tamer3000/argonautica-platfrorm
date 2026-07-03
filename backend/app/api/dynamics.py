"""Динамика — прогресс ежедневных ДЗ. Пользовательская часть + утилиты для admin."""
from datetime import UTC, date, datetime, timedelta
from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from typing_extensions import TypedDict

from app.api.deps import get_current_active_user
from app.core.config import settings
from app.db.session import get_session
from app.models.journal import JournalPardon
from app.models.message import Message
from app.models.room import Room
from app.models.user import User
from app.schemas.journal import DayStatus, MyDynamicsOut, PardonRequest, RecentDay, UserDynamicsOut


class _StatsResult(TypedDict):
    closed_days: set[date]
    overdue_dates: list[date]
    streak: int
    today_cats: list[str]
    pardoned: set[date]

router = APIRouter(prefix="/api/dynamics", tags=["dynamics"])

JOURNAL_CATEGORIES = frozenset({"focus", "notes", "film"})
MAX_PARDONS = 3
RECENT_DAYS = 14


def _journal_category(content: str | None) -> str | None:
    if not content:
        return None
    for cat in JOURNAL_CATEGORIES:
        if content.startswith(f"<!--journal:{cat}-->"):
            return cat
    return None


def _platform_today() -> date:
    """Текущий платформенный день. День завершается в 03:00 Москвы = 00:00 UTC."""
    return datetime.now(UTC).date()


def _calc_closed_days(messages: list[tuple[date, str | None]]) -> dict[date, set[str]]:
    per_day: dict[date, set[str]] = {}
    for msg_date, content in messages:
        cat = _journal_category(content)
        if cat is None:
            continue
        per_day.setdefault(msg_date, set()).add(cat)
    return per_day


def _calc_stats(
    per_day: dict[date, set[str]],
    pardons: list[date],
    program_start: date,
) -> _StatsResult:
    today = _platform_today()
    yesterday = today - timedelta(days=1)
    pardoned = set(pardons)

    closed_days: set[date] = {d for d, cats in per_day.items() if JOURNAL_CATEGORIES <= cats}
    today_cats = list(per_day.get(today, set()))

    # Дни с просрочкой: прошедшие дни >= program_start, не закрытые и не помилованные.
    overdue_dates: list[date] = []
    if yesterday >= program_start:
        check = program_start
        while check <= yesterday:
            if check not in closed_days and check not in pardoned:
                overdue_dates.append(check)
            check += timedelta(days=1)

    # Стрик: последовательность закрытых/помилованных дней назад от текущего.
    streak = 0
    if today in closed_days:
        streak += 1
    check = yesterday
    while check >= program_start:
        if check in closed_days or check in pardoned:
            streak += 1
            check -= timedelta(days=1)
        else:
            break

    return {
        "closed_days": closed_days,
        "overdue_dates": overdue_dates,
        "streak": streak,
        "today_cats": today_cats,
        "pardoned": pardoned,
    }


def _recent_days(closed_days: set[date], pardoned: set[date], program_start: date) -> list[RecentDay]:
    today = _platform_today()
    result: list[RecentDay] = []
    for i in range(RECENT_DAYS - 1, -1, -1):
        d = today - timedelta(days=i)
        if d < program_start:
            st: DayStatus = "before_start"
        elif d == today:
            st = "today_closed" if d in closed_days else "today_open"
        elif d in closed_days:
            st = "closed"
        elif d in pardoned:
            st = "pardoned"
        else:
            st = "missed"
        result.append(RecentDay(date=d, status=st))
    return result


async def _personal_room_id(session: AsyncSession, user_id: int) -> int | None:
    row = await session.scalar(
        select(Room.id).where(Room.created_by == user_id, Room.is_personal.is_(True))
    )
    return row


async def _load_journal_messages(
    session: AsyncSession, room_id: int, since: date
) -> list[tuple[date, str | None]]:
    since_dt = datetime(since.year, since.month, since.day, tzinfo=UTC)
    rows = await session.execute(
        select(Message.created_at, Message.content).where(
            Message.room_id == room_id,
            Message.deleted_at.is_(None),
            Message.thread_root_id.is_(None),
            Message.created_at >= since_dt,
        )
    )
    return [(r.created_at.date(), r.content) for r in rows.all()]


async def _load_pardons(session: AsyncSession, user_id: int) -> list[date]:
    rows = await session.execute(
        select(JournalPardon.date).where(JournalPardon.user_id == user_id)
    )
    return [r[0] for r in rows.all()]


# ─── Пользовательские эндпоинты ─────────────────────────────────────────────

@router.get("/my-stats", response_model=MyDynamicsOut)
async def get_my_stats(
    current_user: Annotated[User, Depends(get_current_active_user)],
    session: Annotated[AsyncSession, Depends(get_session)],
) -> MyDynamicsOut:
    program_start = settings.journal_program_start
    room_id = await _personal_room_id(session, current_user.id)
    messages = await _load_journal_messages(session, room_id, program_start) if room_id else []
    pardons = await _load_pardons(session, current_user.id)
    per_day = _calc_closed_days(messages)
    stats = _calc_stats(per_day, pardons, program_start)

    return MyDynamicsOut(
        streak=stats["streak"],
        overdue_dates=stats["overdue_dates"],
        pardons_used=len(pardons),
        pardons_remaining=max(0, MAX_PARDONS - len(pardons)),
        today_progress=stats["today_cats"],
        program_start=program_start,
    )


@router.post("/pardon", response_model=MyDynamicsOut)
async def use_pardon(
    body: PardonRequest,
    current_user: Annotated[User, Depends(get_current_active_user)],
    session: Annotated[AsyncSession, Depends(get_session)],
) -> MyDynamicsOut:
    program_start = settings.journal_program_start
    today = _platform_today()

    if body.date >= today:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "Помиловать можно только прошедший день")
    if body.date < program_start:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "День раньше начала программы")

    existing_pardons = await _load_pardons(session, current_user.id)
    if len(existing_pardons) >= MAX_PARDONS:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "Все помилования использованы")

    if body.date in existing_pardons:
        raise HTTPException(status.HTTP_409_CONFLICT, "Этот день уже помилован")

    session.add(JournalPardon(user_id=current_user.id, date=body.date))
    await session.flush()

    room_id = await _personal_room_id(session, current_user.id)
    messages = await _load_journal_messages(session, room_id, program_start) if room_id else []
    pardons = await _load_pardons(session, current_user.id)
    per_day = _calc_closed_days(messages)
    stats = _calc_stats(per_day, pardons, program_start)

    return MyDynamicsOut(
        streak=stats["streak"],
        overdue_dates=stats["overdue_dates"],
        pardons_used=len(pardons),
        pardons_remaining=max(0, MAX_PARDONS - len(pardons)),
        today_progress=stats["today_cats"],
        program_start=program_start,
    )


# ─── Утилита для admin endpoint (в admin.py) ────────────────────────────────

async def get_all_dynamics(session: AsyncSession) -> list[UserDynamicsOut]:
    """Статистика всех участников (не-admin) для страницы Динамика в панели."""
    program_start = settings.journal_program_start

    participants = list(
        (
            await session.execute(
                select(User).where(User.role == "participant").order_by(User.display_name)
            )
        )
        .scalars()
        .all()
    )
    if not participants:
        return []

    user_ids = [u.id for u in participants]

    # Личные каналы всех участников за один запрос.
    room_rows = await session.execute(
        select(Room.created_by, Room.id).where(
            Room.created_by.in_(user_ids), Room.is_personal.is_(True)
        )
    )
    room_by_user: dict[int, int] = {created_by: room_id for created_by, room_id in room_rows.all()}

    # Сообщения из всех личных каналов с начала программы.
    room_ids = list(room_by_user.values())
    since_dt = datetime(program_start.year, program_start.month, program_start.day, tzinfo=UTC)
    msg_rows = await session.execute(
        select(Room.created_by, Message.created_at, Message.content)
        .join(Room, Room.id == Message.room_id)
        .where(
            Message.room_id.in_(room_ids),
            Message.deleted_at.is_(None),
            Message.thread_root_id.is_(None),
            Message.created_at >= since_dt,
        )
    )
    msgs_by_user: dict[int, list[tuple[date, str | None]]] = {}
    for user_id, created_at, content in msg_rows.all():
        msgs_by_user.setdefault(user_id, []).append((created_at.date(), content))

    # Все помилования участников.
    pardon_rows = await session.execute(
        select(JournalPardon.user_id, JournalPardon.date).where(
            JournalPardon.user_id.in_(user_ids)
        )
    )
    pardons_by_user: dict[int, list[date]] = {}
    for uid, d in pardon_rows.all():
        pardons_by_user.setdefault(uid, []).append(d)

    result: list[UserDynamicsOut] = []
    for user in participants:
        messages = msgs_by_user.get(user.id, [])
        pardons = pardons_by_user.get(user.id, [])
        per_day = _calc_closed_days(messages)
        stats = _calc_stats(per_day, pardons, program_start)
        recent = _recent_days(stats["closed_days"], stats["pardoned"], program_start)
        result.append(
            UserDynamicsOut(
                user_id=user.id,
                display_name=user.display_name,
                username=user.username,
                avatar_url=user.avatar_url,
                streak=stats["streak"],
                overdue_count=len(stats["overdue_dates"]),
                pardons_used=len(pardons),
                recent_days=recent,
            )
        )
    return result
