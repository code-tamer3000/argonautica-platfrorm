"""Круг Экспедиции — чистая логика раскладки этапов и состояния замков.

Переиспользуется и агрегатом дашборда, и админ-CRUD расписания, и тестами —
никакой из этой логики не должно оседать внутри роутеров.
"""
from dataclasses import dataclass
from datetime import UTC, date, datetime, time, timedelta, timezone

from app.models.expedition import STAGE_KINDS, ExpeditionLock, IntakeStage

MSK = timezone(timedelta(hours=3))

# King Wen №: линии снизу вверх ("1"=ян сплошная, "0"=инь прерывистая).
# Портировано из frontend/scripts/hexagrams.py — та же таблица, тот же порядок,
# чтобы номер ключа и рисунок гексаграммы никогда не могли разойтись между
# бэкендом (валидирует ввод) и фронтом (genkeys.data.ts, рисует «Генные замки»).
KING_WEN: dict[int, str] = {
    1: "111111", 2: "000000", 3: "100010", 4: "010001",
    5: "111010", 6: "010111", 7: "010000", 8: "000010",
    9: "111011", 10: "110111", 11: "111000", 12: "000111",
    13: "101111", 14: "111101", 15: "001000", 16: "000100",
    17: "100110", 18: "011001", 19: "110000", 20: "000011",
    21: "100101", 22: "101001", 23: "000001", 24: "100000",
    25: "100111", 26: "111001", 27: "100001", 28: "011110",
    29: "010010", 30: "101101", 31: "001110", 32: "011100",
    33: "001111", 34: "111100", 35: "000101", 36: "101000",
    37: "101011", 38: "110101", 39: "001010", 40: "010100",
    41: "110001", 42: "100011", 43: "111110", 44: "011111",
    45: "000110", 46: "011000", 47: "010110", 48: "011010",
    49: "101110", 50: "011101", 51: "100100", 52: "001001",
    53: "001011", 54: "110100", 55: "101100", 56: "001101",
    57: "011011", 58: "110110", 59: "010011", 60: "110010",
    61: "110011", 62: "001100", 63: "101010", 64: "010101",
}


@dataclass
class StageSpan:
    """Один этап после раскладки: границы (`day_from`/`day_to`) вычислены из дат
    эфиров, а не хранятся — иначе разъедутся при первом переносе."""

    kind: str
    air_date: date
    air_time: time | None
    task_id: int | None
    day_from: int
    day_to: int


def layout_stages(stages: list[IntakeStage], circle_start: date) -> list[StageSpan]:
    """Раскладывает этапы по номерам дней круга (1..N).

    Порядок фиксирован `STAGE_KINDS` (данные могут прийти в любом порядке —
    сортируем по нему, не по `air_date`, чтобы неправильно введённая дата не
    расставила этапы в неверном порядке молча). Этап длится до эфира следующего;
    последний («final») занимает ровно один день. `circle_start` — старт круга,
    когда нет ни одной строки расписания (фолбэк на равные четверти, см.
    `fallback_stages`) — здесь просто первая дата.
    """
    by_kind = {s.kind: s for s in stages}
    ordered = [by_kind[k] for k in STAGE_KINDS if k in by_kind]
    if not ordered:
        return []

    spans: list[StageSpan] = []
    day = 1
    for i, s in enumerate(ordered):
        if i + 1 < len(ordered):
            days = (ordered[i + 1].air_date - s.air_date).days
        else:
            days = 1  # финал — один день, круг замыкается
        days = max(days, 1)
        spans.append(
            StageSpan(
                kind=s.kind,
                air_date=s.air_date,
                air_time=s.air_time,
                task_id=s.task_id,
                day_from=day,
                day_to=day + days - 1,
            )
        )
        day += days
    return spans


# Равные четверти от старта набора — фолбэк для потоков без заведённого
# расписания (docs: экран не должен падать из-за незаполненной админки).
FALLBACK_STAGE_DAYS = 7


def fallback_stages(intake_starts_on: date) -> list[StageSpan]:
    """Без `intake_stages` строк круг рисуется как раньше задумывалось: четыре
    стихии по 7 дней, без Точки Баланса/Финала и без дат эфиров под подписями."""
    spans: list[StageSpan] = []
    for i, kind in enumerate(("air", "fire", "water", "earth")):
        air_date = intake_starts_on + timedelta(days=i * FALLBACK_STAGE_DAYS)
        spans.append(
            StageSpan(
                kind=kind,
                air_date=air_date,
                air_time=None,
                task_id=None,
                day_from=i * FALLBACK_STAGE_DAYS + 1,
                day_to=(i + 1) * FALLBACK_STAGE_DAYS,
            )
        )
    return spans


def stage_of_day(spans: list[StageSpan], day_number: int) -> StageSpan | None:
    for s in spans:
        if s.day_from <= day_number <= s.day_to:
            return s
    return None


def circle_day_number(spans: list[StageSpan], today: date) -> int | None:
    """Номер дня круга для календарной даты `today`, либо None вне круга."""
    if not spans:
        return None
    start = spans[0].air_date
    total = spans[-1].day_to
    n = (today - start).days + 1
    return n if 1 <= n <= total else None


def unlock_moment(stage: StageSpan) -> datetime:
    """Момент, с которого замок стихии становится вводимым — эфир этапа, МСК."""
    t = stage.air_time or time(0, 0)
    return datetime.combine(stage.air_date, t, tzinfo=MSK)


def lock_state(
    stage: StageSpan | None,
    lock: ExpeditionLock | None,
    task_status: str | None,
    now: datetime | None = None,
) -> str:
    """Состояние одного замка стихии (см. docs/EXPEDITION.md «Состояния замка»):

    - `locked` — этап ещё не наступил;
    - `unlockable` — эфир прошёл, гексаграммы нет;
    - `entered` — гексаграмма введена, задание стихии не принято (или не задано);
    - `revealed` — задание стихии (`task_status == 'accepted'`) принято.
    """
    now = now or datetime.now(UTC)
    if stage is None or now < unlock_moment(stage):
        return "locked"
    if lock is None:
        return "unlockable"
    if task_status == "accepted":
        return "revealed"
    return "entered"


def hexagram_for(key_number: int) -> str:
    return KING_WEN[key_number]
