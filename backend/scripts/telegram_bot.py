"""Telegram-бот выдачи доступа участникам.

Идея: участник пишет боту в личку. Бот берёт его Telegram-@username и ищет юзера
с таким же логином на платформе (регистронезависимо). Если нашёл — генерирует
СВЕЖИЙ одноразовый пароль (argon2-хеш в БД, plaintext — только в этом сообщении),
ставит must_change_password=true и присылает логин/пароль + ссылку и инструкцию по
установке PWA. Пароль в БД не хранится в открытом виде — поэтому бот его именно
пере-выдаёт (recovery), а не «достаёт».

Аккаунты должны существовать заранее (см. create_prod_users.sh) — бот только выдаёт
доступ, но не заводит новых людей (иначе любой смог бы создать себе аккаунт).

Безопасность: Telegram-username можно сменить, поэтому теоретически возможен захват
чужого логина, совпавшего по нику. Группа закрытая (~30 человек) — риск принят;
пароль всё равно временный и требует смены при входе. Частота ограничена через Redis.

Запуск (в образе backend, есть app + доступ к БД/Redis):
    python scripts/telegram_bot.py
Требует env: TELEGRAM_BOT_TOKEN, DATABASE_URL, REDIS_URL, (опц.) PLATFORM_URL.
"""
from __future__ import annotations

import asyncio
import html
import os
from typing import Any

import httpx
from sqlalchemy import func, select

from app.core.redis import redis_client
from app.core.security import generate_one_time_password, hash_password
from app.db.session import SessionLocal
from app.models.user import User

BOT_TOKEN = os.environ.get("TELEGRAM_BOT_TOKEN", "").strip()
PLATFORM_URL = os.environ.get("PLATFORM_URL", "https://platform.argonautica-systems.ru").rstrip("/")
# Прокси для доступа к Telegram (напр. socks5://host:port или http://host:port).
# На сетях, где IP Telegram заблокированы, без прокси getUpdates не достучится.
TELEGRAM_PROXY = os.environ.get("TELEGRAM_PROXY", "").strip() or None
API = f"https://api.telegram.org/bot{BOT_TOKEN}"

# Анти-спам: не более N выдач пароля на один Telegram-аккаунт за окно.
RATE_LIMIT = 3
RATE_WINDOW_SEC = 3600

INSTALL_HELP = (
    "📲 <b>Как установить приложение на телефон</b>\n"
    f"• <b>iPhone</b> (Safari): откройте {PLATFORM_URL} → «Поделиться» ⬆️ → "
    "«На экран «Домой»».\n"
    f"• <b>Android</b> (Chrome): откройте {PLATFORM_URL} → меню ⋮ → "
    "«Установить приложение» (или «Добавить на главный экран»)."
)

START_TEXT = (
    "Привет! Я выдаю доступ к платформе.\n\n"
    "Напиши мне любое сообщение — если твой Telegram-ник совпадает с логином "
    "в системе, я пришлю пароль для входа.\n\n"
    "⚠️ Убедись, что у тебя в Telegram задан @username (Настройки → Имя пользователя)."
)


async def _find_user(username: str) -> User | None:
    async with SessionLocal() as session:
        return (
            await session.execute(
                select(User).where(func.lower(User.username) == username.lower())
            )
        ).scalar_one_or_none()


async def _reset_password(user: User) -> str:
    """Выдать свежий одноразовый пароль пользователю; вернуть plaintext."""
    password = generate_one_time_password()
    async with SessionLocal() as session:
        db_user = await session.get(User, user.id)
        if db_user is None:  # удалили между запросами — маловероятно
            return password
        db_user.password_hash = hash_password(password)
        db_user.must_change_password = True
        await session.commit()
    return password


async def _rate_ok(tg_user_id: int) -> bool:
    key = f"bot:pwd:{tg_user_id}"
    count = await redis_client.incr(key)
    if count == 1:
        await redis_client.expire(key, RATE_WINDOW_SEC)
    return count <= RATE_LIMIT


async def _send(client: httpx.AsyncClient, chat_id: int, text: str) -> None:
    try:
        await client.post(
            f"{API}/sendMessage",
            json={"chat_id": chat_id, "text": text, "parse_mode": "HTML",
                  "disable_web_page_preview": True},
        )
    except httpx.HTTPError as exc:  # noqa: BLE001 — бот не должен падать из-за сети
        print(f"sendMessage failed: {exc}", flush=True)


async def _handle_message(client: httpx.AsyncClient, message: dict[str, Any]) -> None:
    chat_id = message["chat"]["id"]
    text = (message.get("text") or "").strip()
    from_user = message.get("from") or {}
    tg_id = from_user.get("id", chat_id)
    tg_username = from_user.get("username")

    if text.startswith("/start"):
        await _send(client, chat_id, START_TEXT)
        return

    if not tg_username:
        await _send(
            client, chat_id,
            "У тебя не задан @username в Telegram. Открой Настройки → «Имя "
            "пользователя», задай его (он должен совпадать с твоим логином) и напиши снова.",
        )
        return

    user = await _find_user(tg_username)
    if user is None:
        await _send(
            client, chat_id,
            f"Не нашёл участника с логином <b>{html.escape(tg_username)}</b>. "
            "Проверь ник или обратись к администратору.",
        )
        return

    if not await _rate_ok(tg_id):
        await _send(
            client, chat_id,
            "Слишком много запросов пароля. Попробуй позже (в течение часа).",
        )
        return

    password = await _reset_password(user)
    await _send(
        client, chat_id,
        f"✅ Доступ к платформе\n\n"
        f"🔗 Ссылка: {PLATFORM_URL}\n"
        f"👤 Логин: <code>{html.escape(user.username)}</code>\n"
        f"🔑 Пароль: <code>{html.escape(password)}</code>\n\n"
        f"При первом входе система попросит сменить пароль.\n\n"
        f"{INSTALL_HELP}",
    )


async def main() -> None:
    if not BOT_TOKEN:
        raise SystemExit("TELEGRAM_BOT_TOKEN не задан")

    print(
        f"Bot started. Platform URL: {PLATFORM_URL}. "
        f"Proxy: {TELEGRAM_PROXY or 'none'}",
        flush=True,
    )
    offset = 0
    async with httpx.AsyncClient(timeout=40, proxy=TELEGRAM_PROXY) as client:
        while True:
            try:
                resp = await client.get(
                    f"{API}/getUpdates",
                    params={"offset": offset, "timeout": 30},
                )
                updates = resp.json().get("result", [])
            except (httpx.HTTPError, ValueError) as exc:  # noqa: BLE001
                # Тип + repr: у сетевых исключений httpx str() часто пустой.
                print(f"getUpdates failed: {type(exc).__name__}: {exc!r}", flush=True)
                await asyncio.sleep(3)
                continue

            for upd in updates:
                offset = upd["update_id"] + 1
                message = upd.get("message") or upd.get("edited_message")
                if message and message.get("chat", {}).get("type") == "private":
                    try:
                        await _handle_message(client, message)
                    except Exception as exc:  # noqa: BLE001 — один сбой не роняет бота
                        print(f"handle_message error: {type(exc).__name__}: {exc!r}", flush=True)


if __name__ == "__main__":
    asyncio.run(main())
