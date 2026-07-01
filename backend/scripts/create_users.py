"""One-shot: массовое заведение аккаунтов участников.

Логин = Telegram-ник без ведущего '@'. Пароль — одноразовый (temp), печатается
РОВНО ОДИН РАЗ: в БД лежит только argon2-хеш, восстановить пароль потом нельзя —
сохраните вывод. Новичкам выставляется must_change_password=True (сменят при входе).

Идемпотентно: уже существующие логины пропускаются (их пароль неизвестен, не сбрасываем).
Для каждого нового юзера создаётся личный канал — как в admin API (app/api/admin.py).

Вывод разделён по потокам, чтобы удобно сохранять только креды:
  stdout — строго строки `login<TAB>password` (перенаправляйте в файл);
  stderr — заголовки, список пропущенных, итоговая статистика.

Запуск внутри backend-контейнера (там есть пакет app и доступ к БД):
    python scripts/create_users.py users.md      # из файла (по строке на ник)
    python scripts/create_users.py @nick1 @nick2  # из аргументов
    cat users.md | python scripts/create_users.py -   # из stdin
Без аргументов — ищет ./users.md в текущей директории.
"""
from __future__ import annotations

import asyncio
import sys
from pathlib import Path

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.security import generate_one_time_password, hash_password
from app.db.session import SessionLocal
from app.models.room import Room
from app.models.user import User


def read_usernames(args: list[str]) -> list[str]:
    """Собрать ники из файла / аргументов / stdin и нормализовать (без '@', без дублей)."""
    raw: list[str]
    if not args:
        default = Path("users.md")
        raw = default.read_text(encoding="utf-8").splitlines() if default.exists() else []
    elif args == ["-"]:
        raw = sys.stdin.read().splitlines()
    elif len(args) == 1 and Path(args[0]).exists():
        raw = Path(args[0]).read_text(encoding="utf-8").splitlines()
    else:
        raw = args

    seen: set[str] = set()
    out: list[str] = []
    for line in raw:
        name = line.strip().lstrip("@").strip()
        if not name or name in seen:
            continue
        seen.add(name)
        out.append(name)
    return out


async def create_user(session: AsyncSession, username: str) -> tuple[str, str] | None:
    """Создать юзера + личный канал. Вернуть (login, password) или None если логин занят."""
    existing = (
        await session.execute(select(User.id).where(User.username == username))
    ).scalar_one_or_none()
    if existing is not None:
        return None

    password = generate_one_time_password()
    user = User(
        username=username,
        display_name=username,
        password_hash=hash_password(password),
        role="participant",
        must_change_password=True,
    )
    session.add(user)
    await session.flush()  # нужен user.id для личного канала

    # Личный канал (как в app/api/admin.py::create_user).
    session.add(
        Room(type="channel", name=user.display_name, is_personal=True, created_by=user.id)
    )
    await session.flush()
    return username, password


async def main() -> None:
    usernames = read_usernames(sys.argv[1:])
    if not usernames:
        print("Ники не найдены: укажите файл, аргументы или подайте stdin.", file=sys.stderr)
        raise SystemExit(1)

    created: list[tuple[str, str]] = []
    skipped: list[str] = []
    async with SessionLocal() as session:
        for name in usernames:
            result = await create_user(session, name)
            if result is None:
                skipped.append(name)
            else:
                created.append(result)
        await session.commit()

    print("=== СОЗДАНЫ (login  password) — СОХРАНИТЕ, пароль больше не увидеть ===",
          file=sys.stderr)
    for login, pwd in created:
        print(f"{login}\t{pwd}")  # stdout — только данные
    if skipped:
        print("\n=== ПРОПУЩЕНЫ (логин уже существует) ===", file=sys.stderr)
        for login in skipped:
            print(f"  {login}", file=sys.stderr)
    print(f"\nИтого: создано {len(created)}, пропущено {len(skipped)}.", file=sys.stderr)


if __name__ == "__main__":
    asyncio.run(main())
