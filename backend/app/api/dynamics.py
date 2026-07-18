"""Динамика — прогресс ежедневных ДЗ. Пользовательская часть + утилиты для admin."""
import re
from dataclasses import dataclass, field
from datetime import UTC, date, datetime, timedelta, timezone
from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload
from typing_extensions import TypedDict

from app.api.deps import get_current_active_user, require_participant
from app.core.config import settings
from app.db.session import get_session
from app.models.journal import JournalCredit, JournalPardon, JournalProgram, JournalSection
from app.models.message import Message
from app.models.room import Room
from app.models.user import User
from app.schemas.journal import (
    AdminDynamicsOut,
    DayStatus,
    DynamicsSummary,
    JournalProgramIn,
    JournalProgramOut,
    JournalProgramUpdate,
    JournalSectionOut,
    JournalStructureOut,
    MyDynamicsOut,
    PardonRequest,
    RecentDay,
    UserDynamicsOut,
)


class _StatsResult(TypedDict):
    closed_days: set[date]
    overdue_dates: list[date]
    streak: int
    today_cats: list[str]
    pardoned: set[date]

# Динамика (личный дневник/журнал ДЗ) — активность участника; наблюдателю закрыта.
# Функции модуля переиспользует admin.py напрямую (не по HTTP) — их зависимость
# роутера не касается, админ-обзор динамики работает как прежде.
router = APIRouter(
    prefix="/api/dynamics",
    tags=["dynamics"],
    dependencies=[Depends(require_participant)],
)

MAX_PARDONS = 3
PROGRAM_DAYS = 28
# Окно вокруг сегодня: 5 прошлых + сегодня + 3 будущих = 9 ячеек.
WINDOW_PAST = 5
WINDOW_FUTURE = 3

# Невидимый маркер категории в начале сообщения-записи: <!--journal:focus-->.
_JOURNAL_MARKER = re.compile(r"^<!--journal:([a-z0-9_]+)-->")


@dataclass
class ProgramVersion:
    """Одна версия структуры дневника («задание»), действующая с `starts_on`."""

    starts_on: date
    keys: frozenset[str]
    order: dict[str, int] = field(default_factory=dict)  # key -> position


Timeline = list[ProgramVersion]


async def load_timeline(session: AsyncSession) -> Timeline:
    """Шкала заданий по возрастанию `starts_on`: ключи разделов + их порядок.

    Задание без разделов в шкалу не попадает (inner join) — оно не может гейтить
    день. Активное задание дня D — с максимальным `starts_on <= D`.
    """
    rows = await session.execute(
        select(JournalProgram.starts_on, JournalSection.key, JournalSection.position)
        .join(JournalSection, JournalSection.program_id == JournalProgram.id)
        .order_by(JournalProgram.starts_on, JournalSection.position)
    )
    by_start: dict[date, dict[str, int]] = {}
    for starts_on, key, position in rows.all():
        by_start.setdefault(starts_on, {})[key] = position
    return [
        ProgramVersion(starts_on=d, keys=frozenset(order), order=order)
        for d, order in sorted(by_start.items())
    ]


def active_version_for(day: date, timeline: Timeline) -> ProgramVersion | None:
    """Задание, активное в день D — с максимальным `starts_on <= D`."""
    active: ProgramVersion | None = None
    for version in timeline:
        if version.starts_on <= day:
            active = version
        else:
            break
    return active


def required_keys_for(day: date, timeline: Timeline) -> frozenset[str]:
    """Набор ключей задания, активного в этот день (пусто до первого задания)."""
    version = active_version_for(day, timeline)
    return version.keys if version else frozenset()


def _timeline_start(timeline: Timeline) -> date:
    """Начало программы = старт самого раннего задания (fallback — настройка)."""
    return timeline[0].starts_on if timeline else settings.journal_program_start

# Журнальный день считается по московскому времени, но с дедлайном в 03:00 МСК:
# запись, сделанная в 00:00–02:59 МСК, засчитывается за ПРЕДЫДУЩИЙ день, и до 03:00
# журнал показывает вчерашнюю дату как «сегодня». Технически это эквивалентно
# суткам, начинающимся в 03:00 МСК = 00:00 UTC, поэтому «журнальный день» момента
# времени — это его дата в UTC. Считаем явно, не полагаясь на TZ Postgres.
MSK = timezone(timedelta(hours=3))


def _journal_category(content: str | None) -> str | None:
    """Ключ раздела из маркера в начале записи, любой (не по фиксированному списку)."""
    if not content:
        return None
    m = _JOURNAL_MARKER.match(content)
    return m.group(1) if m else None


def _platform_day(dt: datetime) -> date:
    """Журнальный день произвольного момента: (МСК-время − 3ч).date().

    Naive-значения трактуем как UTC (так их отдаёт Postgres при TZ=UTC). Сдвиг на
    −3ч от МСК = граница суток в 03:00 МСК: запись до 3 ночи относится к прошлому дню.
    """
    if dt.tzinfo is None:
        dt = dt.replace(tzinfo=UTC)
    return (dt.astimezone(MSK) - timedelta(hours=3)).date()


def _platform_today() -> date:
    """Текущий платформенный день. День завершается в 03:00 Москвы."""
    return _platform_day(datetime.now(UTC))


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
    timeline: Timeline,
    credits: list[date] | None = None,
) -> _StatsResult:
    today = _platform_today()
    yesterday = today - timedelta(days=1)
    pardoned = set(pardons)

    # Дни, закрытые ВСЕМИ разделами задания, активного В ЭТОТ день, ИЛИ зачтённые
    # админом вручную (credits) — для стрика/просрочек считаются равнозначно.
    # required_keys_for учитывает смену структуры: прошлый день оценивается по
    # заданию, действовавшему тогда, поэтому история не ломается.
    closed_days: set[date] = {
        d
        for d, cats in per_day.items()
        if (req := required_keys_for(d, timeline)) and req <= cats
    }
    if credits:
        closed_days |= set(credits)
    today_cats = list(per_day.get(today, set()))

    # Дни с просрочкой: прошедшие дни >= program_start с непустым заданием,
    # не закрытые и не помилованные.
    overdue_dates: list[date] = []
    if yesterday >= program_start:
        check = program_start
        while check <= yesterday:
            if (
                required_keys_for(check, timeline)
                and check not in closed_days
                and check not in pardoned
            ):
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


def _recent_days(
    closed_days: set[date],
    pardoned: set[date],
    program_start: date,
    credited: set[date] | None = None,
) -> list[RecentDay]:
    today = _platform_today()
    credited = credited or set()
    program_end = program_start + timedelta(days=PROGRAM_DAYS - 1)

    # Окно: WINDOW_PAST дней назад → сегодня → WINDOW_FUTURE дней вперёд.
    # Хронологический порядок: старые слева, новые справа.
    window_start = today - timedelta(days=WINDOW_PAST)
    window_end = today + timedelta(days=WINDOW_FUTURE)

    result: list[RecentDay] = []
    d = window_start
    while d <= window_end:
        if d < program_start or d > program_end:
            st: DayStatus = "before_start"
        elif d > today:
            st = "upcoming"
        elif d == today:
            st = "today_closed" if d in closed_days else "today_open"
        elif d in credited:
            # Зачтён админом вручную — отличаем от органически закрытого дня.
            st = "credited"
        elif d in closed_days:
            st = "closed"
        elif d in pardoned:
            st = "pardoned"
        else:
            st = "missed"
        result.append(RecentDay(date=d, status=st))
        d += timedelta(days=1)
    return result


async def _personal_room_id(session: AsyncSession, user_id: int) -> int | None:
    row = await session.scalar(
        select(Room.id).where(Room.created_by == user_id, Room.is_personal.is_(True))
    )
    return row


async def _load_journal_messages(
    session: AsyncSession, room_id: int, since: date
) -> list[tuple[date, str | None]]:
    # Берём сообщения с запасом в сутки назад: запись в 00:00–02:59 МСK относится
    # к предыдущему журнальному дню, а created_at у неё уже следующей UTC-даты.
    since_dt = datetime(since.year, since.month, since.day, tzinfo=UTC) - timedelta(days=1)
    rows = await session.execute(
        select(Message.created_at, Message.content).where(
            Message.room_id == room_id,
            Message.deleted_at.is_(None),
            Message.thread_root_id.is_(None),
            Message.created_at >= since_dt,
        )
    )
    return [(_platform_day(r.created_at), r.content) for r in rows.all()]


async def _load_pardons(session: AsyncSession, user_id: int) -> list[date]:
    rows = await session.execute(
        select(JournalPardon.date).where(JournalPardon.user_id == user_id)
    )
    return [r[0] for r in rows.all()]


async def _load_credits(session: AsyncSession, user_id: int) -> list[date]:
    rows = await session.execute(
        select(JournalCredit.date).where(JournalCredit.user_id == user_id)
    )
    return [r[0] for r in rows.all()]


# ─── Пользовательские эндпоинты ─────────────────────────────────────────────

@router.get("/my-stats", response_model=MyDynamicsOut)
async def get_my_stats(
    current_user: Annotated[User, Depends(get_current_active_user)],
    session: Annotated[AsyncSession, Depends(get_session)],
) -> MyDynamicsOut:
    timeline = await load_timeline(session)
    program_start = _timeline_start(timeline)
    room_id = await _personal_room_id(session, current_user.id)
    messages = await _load_journal_messages(session, room_id, program_start) if room_id else []
    pardons = await _load_pardons(session, current_user.id)
    credits = await _load_credits(session, current_user.id)
    per_day = _calc_closed_days(messages)
    stats = _calc_stats(per_day, pardons, program_start, timeline, credits)

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
    timeline = await load_timeline(session)
    program_start = _timeline_start(timeline)
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
    credits = await _load_credits(session, current_user.id)
    per_day = _calc_closed_days(messages)
    stats = _calc_stats(per_day, pardons, program_start, timeline, credits)

    return MyDynamicsOut(
        streak=stats["streak"],
        overdue_dates=stats["overdue_dates"],
        pardons_used=len(pardons),
        pardons_remaining=max(0, MAX_PARDONS - len(pardons)),
        today_progress=stats["today_cats"],
        program_start=program_start,
    )


# ─── Структура дневника (задания) ───────────────────────────────────────────

async def load_programs(session: AsyncSession) -> list[JournalProgram]:
    """Все задания с разделами, по возрастанию `starts_on`."""
    result = await session.execute(
        select(JournalProgram)
        .options(selectinload(JournalProgram.sections))
        .order_by(JournalProgram.starts_on)
    )
    return list(result.scalars().all())


def _active_program(programs: list[JournalProgram], day: date) -> JournalProgram | None:
    active: JournalProgram | None = None
    for p in programs:
        if p.starts_on <= day:
            active = p
        else:
            break
    return active


def _section_out(s: JournalSection) -> JournalSectionOut:
    return JournalSectionOut(
        key=s.key,
        emoji=s.emoji,
        label=s.label,
        heading=s.heading,
        placeholder=s.placeholder,
        input_type="title" if s.input_type == "title" else "text",
        position=s.position,
    )


def _program_out(p: JournalProgram) -> JournalProgramOut:
    return JournalProgramOut(
        id=p.id,
        starts_on=p.starts_on,
        title=p.title,
        description=p.description,
        created_by=p.created_by,
        sections=[_section_out(s) for s in p.sections],
    )


@router.get("/structure", response_model=JournalStructureOut)
async def get_structure(
    current_user: Annotated[User, Depends(get_current_active_user)],
    session: Annotated[AsyncSession, Depends(get_session)],
) -> JournalStructureOut:
    """Активное на сегодня задание — разделы для виджета/композера участника."""
    programs = await load_programs(session)
    active = _active_program(programs, _platform_today())
    if active is None:
        return JournalStructureOut(
            program_id=None, starts_on=None, title=None, description=None, sections=[]
        )
    return JournalStructureOut(
        program_id=active.id,
        starts_on=active.starts_on,
        title=active.title,
        description=active.description,
        sections=[_section_out(s) for s in active.sections],
    )


# ─── Утилиты для admin endpoints (в admin.py) ───────────────────────────────


async def list_programs(session: AsyncSession) -> list[JournalProgramOut]:
    return [_program_out(p) for p in await load_programs(session)]


async def create_program(
    session: AsyncSession, body: JournalProgramIn, created_by: int
) -> JournalProgramOut:
    exists = await session.scalar(
        select(JournalProgram.id).where(JournalProgram.starts_on == body.starts_on)
    )
    if exists is not None:
        raise HTTPException(
            status.HTTP_409_CONFLICT, "Задание с такой датой старта уже есть"
        )
    program = JournalProgram(
        starts_on=body.starts_on,
        title=body.title,
        description=body.description,
        created_by=created_by,
    )
    program.sections = [
        JournalSection(
            key=s.key,
            position=i,
            emoji=s.emoji,
            label=s.label,
            heading=s.heading,
            placeholder=s.placeholder,
            input_type=s.input_type,
        )
        for i, s in enumerate(body.sections)
    ]
    session.add(program)
    await session.flush()
    await session.refresh(program, ["sections"])
    return _program_out(program)


async def update_program(
    session: AsyncSession, program_id: int, body: JournalProgramUpdate
) -> JournalProgramOut:
    program = await session.scalar(
        select(JournalProgram)
        .options(selectinload(JournalProgram.sections))
        .where(JournalProgram.id == program_id)
    )
    if program is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Задание не найдено")

    fields = body.model_fields_set
    if "starts_on" in fields and body.starts_on is not None:
        clash = await session.scalar(
            select(JournalProgram.id).where(
                JournalProgram.starts_on == body.starts_on,
                JournalProgram.id != program_id,
            )
        )
        if clash is not None:
            raise HTTPException(
                status.HTTP_409_CONFLICT, "Задание с такой датой старта уже есть"
            )
        program.starts_on = body.starts_on
    if "title" in fields:
        program.title = body.title
    if "description" in fields:
        program.description = body.description
    if body.sections is not None:
        # Полная замена набора разделов (delete-orphan подчистит старые).
        program.sections = [
            JournalSection(
                key=s.key,
                position=i,
                emoji=s.emoji,
                label=s.label,
                heading=s.heading,
                placeholder=s.placeholder,
                input_type=s.input_type,
            )
            for i, s in enumerate(body.sections)
        ]
    await session.flush()
    await session.refresh(program, ["sections"])
    return _program_out(program)


async def delete_program(session: AsyncSession, program_id: int) -> None:
    programs = await load_programs(session)
    if not any(p.id == program_id for p in programs):
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Задание не найдено")
    # Нельзя удалить самое раннее задание — оно задаёт начало программы, и без него
    # дни между его стартом и следующим заданием остались бы без структуры.
    earliest = min(programs, key=lambda p: p.starts_on)
    if earliest.id == program_id:
        raise HTTPException(
            status.HTTP_400_BAD_REQUEST, "Нельзя удалить самое раннее задание"
        )
    program = await session.get(JournalProgram, program_id)
    if program is not None:
        await session.delete(program)
        await session.flush()





async def credit_day(
    session: AsyncSession, user_id: int, day: date, granted_by: int
) -> None:
    """Зачесть админом день пользователю (идемпотентно)."""
    program_start = _timeline_start(await load_timeline(session))
    today = _platform_today()
    if day < program_start:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "День раньше начала программы")
    if day > today:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "Нельзя зачесть будущий день")

    user = await session.get(User, user_id)
    if user is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Пользователь не найден")

    existing = await session.scalar(
        select(JournalCredit).where(
            JournalCredit.user_id == user_id, JournalCredit.date == day
        )
    )
    if existing is None:
        session.add(JournalCredit(user_id=user_id, date=day, granted_by=granted_by))
        await session.flush()

    # Если пользователь потратил на этот день помилование («кита») — возвращаем его:
    # раз админ зачёл день, кит был не нужен. Удаляем pardon → pardons_remaining растёт.
    pardon = await session.scalar(
        select(JournalPardon).where(
            JournalPardon.user_id == user_id, JournalPardon.date == day
        )
    )
    if pardon is not None:
        await session.delete(pardon)
        await session.flush()


async def uncredit_day(session: AsyncSession, user_id: int, day: date) -> None:
    """Снять ранее выданный админом зачёт дня (идемпотентно)."""
    existing = await session.scalar(
        select(JournalCredit).where(
            JournalCredit.user_id == user_id, JournalCredit.date == day
        )
    )
    if existing is not None:
        await session.delete(existing)
        await session.flush()

async def get_all_dynamics(session: AsyncSession) -> AdminDynamicsOut:
    """Сводка + статистика всех участников для страницы Динамика в панели."""
    timeline = await load_timeline(session)
    program_start = _timeline_start(timeline)

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
        return AdminDynamicsOut(
            summary=DynamicsSummary(
                total_participants=0,
                active_today=0,
                journal_today=0,
                no_overdue=0,
                avg_streak=0.0,
            ),
            users=[],
        )

    user_ids = [u.id for u in participants]
    today = _platform_today()
    today_start = datetime(today.year, today.month, today.day, tzinfo=UTC)

    # Личные каналы.
    room_rows = await session.execute(
        select(Room.created_by, Room.id).where(
            Room.created_by.in_(user_ids), Room.is_personal.is_(True)
        )
    )
    room_by_user: dict[int, int] = {created_by: room_id for created_by, room_id in room_rows.all()}

    # Журнальные сообщения из личных каналов с начала программы.
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
    for uid, created_at, content in msg_rows.all():
        msgs_by_user.setdefault(uid, []).append((created_at.date(), content))

    # Кто отправил ЛЮБОЕ сообщение сегодня (активность на платформе).
    active_rows = await session.execute(
        select(Message.sender_id).distinct().where(
            Message.sender_id.in_(user_ids),
            Message.deleted_at.is_(None),
            Message.created_at >= today_start,
        )
    )
    active_today_ids: set[int] = {row[0] for row in active_rows.all()}

    # Помилования.
    pardon_rows = await session.execute(
        select(JournalPardon.user_id, JournalPardon.date).where(
            JournalPardon.user_id.in_(user_ids)
        )
    )
    pardons_by_user: dict[int, list[date]] = {}
    for uid, d in pardon_rows.all():
        pardons_by_user.setdefault(uid, []).append(d)

    # Ручные зачёты дней админом.
    credit_rows = await session.execute(
        select(JournalCredit.user_id, JournalCredit.date).where(
            JournalCredit.user_id.in_(user_ids)
        )
    )
    credits_by_user: dict[int, list[date]] = {}
    for uid, d in credit_rows.all():
        credits_by_user.setdefault(uid, []).append(d)

    users_out: list[UserDynamicsOut] = []
    for user in participants:
        messages = msgs_by_user.get(user.id, [])
        pardons = pardons_by_user.get(user.id, [])
        credits = credits_by_user.get(user.id, [])
        per_day = _calc_closed_days(messages)
        stats = _calc_stats(per_day, pardons, program_start, timeline, credits)
        recent = _recent_days(stats["closed_days"], stats["pardoned"], program_start, set(credits))
        journal_today = today in stats["closed_days"]
        users_out.append(
            UserDynamicsOut(
                user_id=user.id,
                display_name=user.display_name,
                username=user.username,
                avatar_url=user.avatar_url,
                streak=stats["streak"],
                overdue_count=len(stats["overdue_dates"]),
                pardons_used=len(pardons),
                active_today=user.id in active_today_ids,
                journal_today=journal_today,
                recent_days=recent,
            )
        )

    total = len(users_out)
    streaks = [u.streak for u in users_out]
    summary = DynamicsSummary(
        total_participants=total,
        active_today=sum(1 for u in users_out if u.active_today),
        journal_today=sum(1 for u in users_out if u.journal_today),
        no_overdue=sum(1 for u in users_out if u.overdue_count == 0),
        avg_streak=round(sum(streaks) / total, 1) if total else 0.0,
    )
    return AdminDynamicsOut(summary=summary, users=users_out)
