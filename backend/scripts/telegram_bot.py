"""Telegram-бот выдачи доступа участникам (через MTProto + MTProxy).

Зачем MTProto, а не HTTP Bot API: на сервере заблокированы IP Telegram, поэтому
`api.telegram.org` недоступен. Telethon говорит с Telegram по протоколу MTProto и
умеет ходить через MTProxy (Server/Port/Secret) — а MTProxy до Telegram достучаться
может. Так бот работает в обход блокировки.

Логика та же: участник пишет боту в личку → бот сверяет его @username с логином на
платформе (регистронезависимо) → выдаёт СВЕЖИЙ одноразовый пароль (argon2-хеш в БД,
plaintext только в сообщении), ставит must_change_password=true, присылает доступ +
инструкцию по установке PWA. Аккаунты должны существовать заранее (create_prod_users.sh).

Требует env:
  TELEGRAM_BOT_TOKEN            — токен бота от @BotFather
  TELEGRAM_API_ID              — api_id с https://my.telegram.org
  TELEGRAM_API_HASH            — api_hash оттуда же
  TELEGRAM_MTPROXY_SERVER/PORT/SECRET — MTProxy (если пусто — прямое подключение)
  DATABASE_URL, REDIS_URL, (опц.) PLATFORM_URL

Запуск (в образе backend): python -m scripts.telegram_bot
"""
from __future__ import annotations

import html
import os
from typing import Any

from sqlalchemy import func, select
from telethon import TelegramClient, events
from telethon.network import ConnectionTcpMTProxyRandomizedIntermediate
from telethon.sessions import MemorySession

from app.core.redis import redis_client
from app.core.security import generate_one_time_password, hash_password
from app.db.session import SessionLocal
from app.models.user import User

BOT_TOKEN = os.environ.get("TELEGRAM_BOT_TOKEN", "").strip()
API_ID = int(os.environ.get("TELEGRAM_API_ID", "0") or 0)
API_HASH = os.environ.get("TELEGRAM_API_HASH", "").strip()
PLATFORM_URL = os.environ.get("PLATFORM_URL", "https://platform.argonautica-systems.ru").rstrip("/")

MTPROXY_SERVER = os.environ.get("TELEGRAM_MTPROXY_SERVER", "").strip()
MTPROXY_PORT = int(os.environ.get("TELEGRAM_MTPROXY_PORT", "0") or 0)
MTPROXY_SECRET = os.environ.get("TELEGRAM_MTPROXY_SECRET", "").strip()

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


async def _reset_password(user_id: int) -> str:
    """Выдать свежий одноразовый пароль пользователю; вернуть plaintext."""
    password = generate_one_time_password()
    async with SessionLocal() as session:
        db_user = await session.get(User, user_id)
        if db_user is not None:
            db_user.password_hash = hash_password(password)
            db_user.must_change_password = True
            await session.commit()
    return password


async def _rate_ok(tg_user_id: int) -> bool:
    key = f"bot:pwd:{tg_user_id}"
    count = await redis_client.incr(key)
    if count == 1:
        await redis_client.expire(key, RATE_WINDOW_SEC)
    return bool(count <= RATE_LIMIT)


async def _handle(event: Any) -> None:
    if not event.is_private:
        return
    sender = await event.get_sender()
    tg_id = int(getattr(sender, "id", 0))
    tg_username = getattr(sender, "username", None)
    text = (event.raw_text or "").strip()

    async def reply(msg: str) -> None:
        await event.respond(msg, parse_mode="html", link_preview=False)

    if text.startswith("/start"):
        await reply(START_TEXT)
        return

    if not tg_username:
        await reply(
            "У тебя не задан @username в Telegram. Открой Настройки → «Имя "
            "пользователя», задай его (он должен совпадать с твоим логином) и напиши снова."
        )
        return

    user = await _find_user(tg_username)
    if user is None:
        await reply(
            f"Не нашёл участника с логином <b>{html.escape(tg_username)}</b>. "
            "Проверь ник или обратись к администратору."
        )
        return

    if not await _rate_ok(tg_id):
        await reply("Слишком много запросов пароля. Попробуй позже (в течение часа).")
        return

    password = await _reset_password(user.id)
    await reply(
        f"✅ Доступ к платформе\n\n"
        f"🔗 Ссылка: {PLATFORM_URL}\n"
        f"👤 Логин: <code>{html.escape(user.username)}</code>\n"
        f"🔑 Пароль: <code>{html.escape(password)}</code>\n\n"
        f"При первом входе система попросит сменить пароль.\n\n"
        f"{INSTALL_HELP}"
    )


def _normalize_mtproxy_secret(secret: str) -> str:
    """Привести secret к 16-байтовому hex (32 символа) — как требует Telethon MTProxy.

    Форматы MTProxy-secret:
      - «голый»: 32 hex (16 байт) — берём как есть;
      - `dd` + 32 hex — secure/randomized: отрезаем `dd`;
      - `ee` + 32 hex + hex(домен) — FakeTLS: берём 16-байтовый секрет сразу после `ee`.
    """
    s = secret.strip().lower()
    if s.startswith(("dd", "ee")):
        s = s[2:]
    return s[:32]


def _build_client() -> Any:
    kwargs: dict[str, Any] = {}
    if MTPROXY_SERVER and MTPROXY_PORT and MTPROXY_SECRET:
        secret = _normalize_mtproxy_secret(MTPROXY_SECRET)
        print(
            f"MTProxy secret: raw {len(MTPROXY_SECRET)} → normalized {len(secret)} hex",
            flush=True,
        )
        kwargs["connection"] = ConnectionTcpMTProxyRandomizedIntermediate
        kwargs["proxy"] = (MTPROXY_SERVER, MTPROXY_PORT, secret)
    return TelegramClient(MemorySession(), API_ID, API_HASH, **kwargs)


async def main() -> None:
    if not BOT_TOKEN or not API_ID or not API_HASH:
        raise SystemExit(
            "Нужны TELEGRAM_BOT_TOKEN, TELEGRAM_API_ID, TELEGRAM_API_HASH"
        )

    client = _build_client()
    client.add_event_handler(_handle, events.NewMessage(incoming=True))

    proxy_info = f"{MTPROXY_SERVER}:{MTPROXY_PORT}" if MTPROXY_SERVER else "none"
    await client.start(bot_token=BOT_TOKEN)
    print(f"Bot started. Platform: {PLATFORM_URL}. MTProxy: {proxy_info}", flush=True)
    await client.run_until_disconnected()


if __name__ == "__main__":
    import asyncio

    asyncio.run(main())
