"""One-shot: create or promote the FIRST admin account.

Closed platform, no self-signup (docs/AUTH.md): every account after this one is
created via `POST /api/admin/users`, which requires an admin already logged in.
This script exists purely to break that chicken-and-egg the very first time a
stack is provisioned (or to regain access if every admin got locked out) — it's
the only place role=admin is ever set outside that endpoint.

Idempotent:
  - username doesn't exist  -> creates it with role=admin, a one-time password
    (printed ONCE on stdout, must_change_password=true), and a personal channel
    (same shape as scripts/create_users.py / app/api/admin.py::create_user).
  - username already exists -> promotes it to role=admin in place, password and
    must_change_password untouched. Safe to rerun.

Run inside the backend container:
    python -m scripts.bootstrap_admin <username>
"""
from __future__ import annotations

import sys

from sqlalchemy import select

from app.core.security import generate_one_time_password, hash_password
from app.db.session import SessionLocal
from app.models.room import Room
from app.models.user import User


async def bootstrap_admin(username: str) -> None:
    async with SessionLocal() as session:
        user = (
            await session.execute(select(User).where(User.username == username))
        ).scalar_one_or_none()

        if user is not None:
            if user.role == "admin":
                print(f"{username!r} уже admin — ничего не делаю.", file=sys.stderr)
                return
            user.role = "admin"
            await session.commit()
            print(f"{username!r} повышен до admin (пароль не менялся).", file=sys.stderr)
            return

        password = generate_one_time_password()
        user = User(
            username=username,
            display_name=username,
            password_hash=hash_password(password),
            role="admin",
            must_change_password=True,
        )
        session.add(user)
        await session.flush()  # нужен user.id для личного канала
        session.add(
            Room(type="channel", name=user.display_name, is_personal=True, created_by=user.id)
        )
        await session.commit()

        print(f"Создан admin {username!r} — СОХРАНИТЕ пароль, больше не увидеть:", file=sys.stderr)
        print(password)  # stdout — только пароль, удобно перенаправить в файл


if __name__ == "__main__":
    if len(sys.argv) != 2 or not sys.argv[1].strip():
        print("usage: python -m scripts.bootstrap_admin <username>", file=sys.stderr)
        raise SystemExit(1)

    import asyncio

    asyncio.run(bootstrap_admin(sys.argv[1].strip().lstrip("@")))
