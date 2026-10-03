"""One-shot: привязать Telegram id к существующим учёткам (`users.tg_id`, ARG-167).

Зачем: intake-бот находит учётку для «Сменить пароль» по `tg_id`. У тех, кто попал на
платформу мимо воронки (админы, первый поток), заявки нет — id привязывается вручную
этим скриптом. По нику НЕ ищем нигде в боте: ник в Telegram меняется и освобождается,
поэтому id берётся из проверенного человеком CSV, а не вычисляется.

Вход — CSV с заголовком `username,tg_id,...` (остальные колонки игнорируются; строки,
где `tg_id` пуст или `status` не начинается с `ok`, пропускаются, если колонка есть).
Логин ищется ТОЧНО (без учёта регистра), как в БД.

По умолчанию — dry-run: ничего не пишет, показывает, что сделал бы. Запись — `--apply`.
Отказывается (и ничего не меняет по такой строке) когда:
  - логина нет в `users`;
  - у учётки уже стоит ДРУГОЙ `tg_id` (молча не перезаписываем);
  - этот `tg_id` уже закреплён за другой учёткой — в `users.tg_id` или в
    `intake_applications.user_id` (прошедший воронку не должен «осиротеть»).
Код возврата 1, если хоть одна строка отклонена.

Запуск внутри backend-контейнера:
    python -m scripts.bind_tg_id result.csv            # dry-run
    python -m scripts.bind_tg_id result.csv --apply    # записать
"""
from __future__ import annotations

import asyncio
import csv
import sys
from dataclasses import dataclass
from pathlib import Path

from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.db.session import SessionLocal
from app.models.intake_application import IntakeApplication
from app.models.user import User

BIND = "bind"
ALREADY = "already"
REJECT = "reject"


@dataclass
class Row:
    username: str
    tg_id: int


@dataclass
class Outcome:
    username: str
    tg_id: int
    action: str  # BIND | ALREADY | REJECT
    reason: str = ""


def read_rows(path: Path) -> list[Row]:
    """Прочитать CSV: нужны колонки `username` и `tg_id`; `status` (если есть) должен
    начинаться с `ok`."""
    rows: list[Row] = []
    seen: set[str] = set()
    with path.open(encoding="utf-8", newline="") as f:
        for raw in csv.DictReader(f):
            username = (raw.get("username") or "").strip().lstrip("@")
            tg_raw = (raw.get("tg_id") or "").strip()
            status = raw.get("status")
            if not username or not tg_raw.isdigit():
                continue
            if status is not None and not status.strip().lower().startswith("ok"):
                continue
            if username.lower() in seen:
                continue
            seen.add(username.lower())
            rows.append(Row(username=username, tg_id=int(tg_raw)))
    return rows


async def plan_row(session: AsyncSession, row: Row) -> tuple[Outcome, User | None]:
    user = (
        await session.execute(
            select(User).where(func.lower(User.username) == row.username.lower())
        )
    ).scalar_one_or_none()
    if user is None:
        return Outcome(row.username, row.tg_id, REJECT, "логин не найден в users"), None
    if user.tg_id == row.tg_id:
        return Outcome(row.username, row.tg_id, ALREADY), user
    if user.tg_id is not None:
        return Outcome(
            row.username, row.tg_id, REJECT,
            f"у учётки уже стоит другой tg_id ({user.tg_id}) — не перезаписываю",
        ), user

    holder = (
        await session.execute(select(User.username).where(User.tg_id == row.tg_id))
    ).scalar_one_or_none()
    if holder is not None:
        return Outcome(row.username, row.tg_id, REJECT, f"tg_id уже у учётки {holder}"), user

    app_user_id = (
        await session.execute(
            select(IntakeApplication.user_id).where(
                IntakeApplication.tg_id == row.tg_id,
                IntakeApplication.user_id.is_not(None),
            )
        )
    ).scalar_one_or_none()
    if app_user_id is not None and app_user_id != user.id:
        return Outcome(
            row.username, row.tg_id, REJECT,
            f"tg_id уже закреплён воронкой за другой учёткой (id {app_user_id})",
        ), user
    return Outcome(row.username, row.tg_id, BIND), user


async def bind_rows(session: AsyncSession, rows: list[Row], *, apply: bool) -> list[Outcome]:
    """Спланировать каждую строку; при `apply` — записать привязки (flush, без commit)."""
    outcomes: list[Outcome] = []
    for row in rows:
        outcome, user = await plan_row(session, row)
        if outcome.action == BIND and apply and user is not None:
            user.tg_id = row.tg_id
            await session.flush()
        outcomes.append(outcome)
    return outcomes


def format_report(outcomes: list[Outcome], *, apply: bool) -> str:
    verb = {
        BIND: "привязан" if apply else "будет привязан",
        ALREADY: "уже привязан",
        REJECT: "ОТКЛОНЁН",
    }
    lines = [
        f"{o.username:<24} {o.tg_id:<12} {verb[o.action]}" + (f" — {o.reason}" if o.reason else "")
        for o in outcomes
    ]
    counts = {a: sum(1 for o in outcomes if o.action == a) for a in (BIND, ALREADY, REJECT)}
    lines.append("")
    lines.append(
        f"Итого: {'привязано' if apply else 'к привязке'} {counts[BIND]}, "
        f"уже было {counts[ALREADY]}, отклонено {counts[REJECT]}."
        + ("" if apply else " Dry-run: ничего не записано, добавь --apply.")
    )
    return "\n".join(lines)


async def main() -> None:
    args = [a for a in sys.argv[1:] if a != "--apply"]
    apply = "--apply" in sys.argv[1:]
    if len(args) != 1:
        print("Использование: python -m scripts.bind_tg_id <файл.csv> [--apply]", file=sys.stderr)
        raise SystemExit(2)
    rows = read_rows(Path(args[0]))
    if not rows:
        print("В CSV нет подходящих строк (нужны username и tg_id).", file=sys.stderr)
        raise SystemExit(2)

    async with SessionLocal() as session:
        outcomes = await bind_rows(session, rows, apply=apply)
        if apply:
            await session.commit()
        else:
            await session.rollback()

    print(format_report(outcomes, apply=apply))
    if any(o.action == REJECT for o in outcomes):
        raise SystemExit(1)


if __name__ == "__main__":
    asyncio.run(main())
