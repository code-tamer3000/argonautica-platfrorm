"""Telegram-бот поддержки участников (HTTP Bot API через SOCKS5-прокси).

На сервере заблокированы IP Telegram, поэтому `api.telegram.org` напрямую недоступен
(getUpdates → timeout/ENETUNREACH). Обходим обычным SOCKS5-прокси (TELEGRAM_PROXY) —
он просто туннелирует HTTPS-запросы httpx, никакой MTProto/MTProxy не нужен.

Бот работает как меню с кнопками (inline keyboard):
  • «Получить пароль» / «Восстановить пароль» — сверяет @username с логином на
    платформе (регистронезависимо), выдаёт СВЕЖИЙ одноразовый пароль (argon2-хеш в БД,
    plaintext только в этом сообщении), ставит must_change_password=true, присылает
    доступ + инструкцию по установке PWA. Обе кнопки делают одно и то же (сброс на новый
    временный пароль) — «получить» для первого входа, «восстановить» для забывших.
  • «Задать технический вопрос» — следующее сообщение пользователя бот пересылает
    админу в личку. Админ отвечает reply на это сообщение — бот доставляет ответ обратно
    пользователю. Полноценный саппорт-канал.

Аккаунты должны существовать заранее (create_prod_users.sh) — бот только выдаёт доступ,
но не заводит новых людей.

Лог действий: о каждом действии («@user получил пароль», «@user задал вопрос») бот шлёт
уведомление админу в личку (TELEGRAM_ADMIN_CHAT_ID) и дублирует в stdout (docker logs).

Безопасность: Telegram-username можно сменить, поэтому теоретически возможен захват
чужого логина, совпавшего по нику. Группа закрытая (~30 человек) — риск принят;
пароль всё равно временный и требует смены при входе. Частота ограничена через Redis.

Запуск (в образе backend): python -m scripts.telegram_bot
Требует env: TELEGRAM_BOT_TOKEN, DATABASE_URL, REDIS_URL,
  (опц.) PLATFORM_URL, TELEGRAM_PROXY, TELEGRAM_ADMIN_CHAT_ID.
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
# SOCKS5/HTTP-прокси до Telegram, если IP Telegram заблокированы на сервере.
# Формат: socks5://user:pass@host:port  или  http://user:pass@host:port
TELEGRAM_PROXY = os.environ.get("TELEGRAM_PROXY", "").strip() or None
# Личка админа (твой chat_id) — сюда идут лог действий и техвопросы. Узнать свой id:
# написать боту @userinfobot, или посмотреть в логах бота update["message"]["chat"]["id"].
_admin_raw = os.environ.get("TELEGRAM_ADMIN_CHAT_ID", "").strip()
ADMIN_CHAT_ID: int | None = int(_admin_raw) if _admin_raw.lstrip("-").isdigit() else None
API = f"https://api.telegram.org/bot{BOT_TOKEN}"

# Анти-спам: не более N выдач пароля на один Telegram-аккаунт за окно.
RATE_LIMIT = 3
RATE_WINDOW_SEC = 3600

# Callback-data кнопок меню.
CB_GET_PASSWORD = "get_password"
CB_RESET_PASSWORD = "reset_password"
CB_ASK_QUESTION = "ask_question"

# Пользователь нажал «задать вопрос» — ждём его следующее сообщение (TTL, чтобы состояние
# не висело вечно). Ключ: bot:await_q:{tg_id} = "1".
AWAIT_QUESTION_TTL_SEC = 3600
# Маппинг «сообщение с вопросом в личке админа» → chat_id спросившего, чтобы доставить
# ответ админа обратно. Ключ: bot:qmap:{admin_msg_id} = asker_chat_id. TTL — неделя.
QMAP_TTL_SEC = 7 * 24 * 3600

INSTALL_HELP = (
    "📲 <b>Как установить приложение на телефон</b>\n"
    f"• <b>iPhone</b> (Safari): откройте {PLATFORM_URL} → «Поделиться» ⬆️ → "
    "«На экран «Домой»».\n"
    f"• <b>Android</b> (Chrome): откройте {PLATFORM_URL} → меню ⋮ → "
    "«Установить приложение» (или «Добавить на главный экран»)."
)

START_TEXT = (
    "Привет! Я бот поддержки платформы. Выбери, что нужно:\n\n"
    "🔑 <b>Получить пароль</b> — первый вход на платформу.\n"
    "♻️ <b>Восстановить пароль</b> — если забыл или потерял доступ.\n"
    "💬 <b>Задать технический вопрос</b> — напишу его в поддержку.\n\n"
    "⚠️ Для выдачи пароля нужен @username в Telegram, совпадающий с твоим логином "
    "(Настройки → Имя пользователя)."
)

MENU_KEYBOARD = {
    "inline_keyboard": [
        [{"text": "🔑 Получить пароль", "callback_data": CB_GET_PASSWORD}],
        [{"text": "♻️ Восстановить пароль", "callback_data": CB_RESET_PASSWORD}],
        [{"text": "💬 Задать технический вопрос", "callback_data": CB_ASK_QUESTION}],
    ]
}


# --- Работа с БД ---

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


# --- Telegram API ---

async def _send(
    client: httpx.AsyncClient,
    chat_id: int,
    text: str,
    reply_markup: dict[str, Any] | None = None,
) -> dict[str, Any] | None:
    """Отправить сообщение. Возвращает объект message из ответа Telegram (или None)."""
    payload: dict[str, Any] = {
        "chat_id": chat_id,
        "text": text,
        "parse_mode": "HTML",
        "disable_web_page_preview": True,
    }
    if reply_markup is not None:
        payload["reply_markup"] = reply_markup
    try:
        resp = await client.post(f"{API}/sendMessage", json=payload)
        return resp.json().get("result")
    except (httpx.HTTPError, ValueError) as exc:  # noqa: BLE001 — бот не должен падать из-за сети
        print(f"sendMessage failed: {type(exc).__name__}: {exc!r}", flush=True)
        return None


async def _answer_callback(client: httpx.AsyncClient, callback_id: str) -> None:
    """Убрать «часики» на нажатой кнопке (иначе клиент считает её зависшей)."""
    try:
        await client.post(f"{API}/answerCallbackQuery", json={"callback_query_id": callback_id})
    except httpx.HTTPError as exc:  # noqa: BLE001
        print(f"answerCallbackQuery failed: {type(exc).__name__}: {exc!r}", flush=True)


async def _log_action(client: httpx.AsyncClient, text: str) -> None:
    """Лог действия: в stdout (docker logs) и в личку админу, если задан chat_id."""
    print(f"[action] {text}", flush=True)
    if ADMIN_CHAT_ID is not None:
        await _send(client, ADMIN_CHAT_ID, f"📋 {text}")


def _user_tag(tg_username: str | None, tg_id: int) -> str:
    """Читаемая метка пользователя для лога: @username или tg://id."""
    return f"@{tg_username}" if tg_username else f"tg-user {tg_id}"


# --- Обработчики ---

async def _issue_password(
    client: httpx.AsyncClient,
    chat_id: int,
    tg_id: int,
    tg_username: str | None,
    *,
    action_verb: str,
) -> None:
    """Общая логика выдачи пароля для кнопок «получить» и «восстановить»."""
    if not tg_username:
        await _send(
            client, chat_id,
            "У тебя не задан @username в Telegram. Открой Настройки → «Имя "
            "пользователя», задай его (он должен совпадать с твоим логином) и нажми снова.",
            reply_markup=MENU_KEYBOARD,
        )
        return

    user = await _find_user(tg_username)
    if user is None:
        await _send(
            client, chat_id,
            f"Не нашёл участника с логином <b>{html.escape(tg_username)}</b>. "
            "Проверь ник или обратись к администратору.",
            reply_markup=MENU_KEYBOARD,
        )
        return

    if not await _rate_ok(tg_id):
        await _send(
            client, chat_id,
            "Слишком много запросов пароля. Попробуй позже (в течение часа).",
        )
        return

    password = await _reset_password(user.id)
    await _send(
        client, chat_id,
        f"✅ Доступ к платформе\n\n"
        f"🔗 Ссылка: {PLATFORM_URL}\n"
        f"👤 Логин: <code>{html.escape(user.username)}</code>\n"
        f"🔑 Пароль: <code>{html.escape(password)}</code>\n\n"
        f"При первом входе система попросит сменить пароль.\n\n"
        f"{INSTALL_HELP}",
    )
    await _log_action(
        client,
        f"{_user_tag(tg_username, tg_id)} (логин {user.username}) {action_verb}",
    )


async def _start_question(
    client: httpx.AsyncClient, chat_id: int, tg_id: int
) -> None:
    """Пользователь нажал «задать вопрос» — ждём его следующее сообщение."""
    await redis_client.set(f"bot:await_q:{tg_id}", "1", ex=AWAIT_QUESTION_TTL_SEC)
    await _send(
        client, chat_id,
        "💬 Напиши свой вопрос одним сообщением — я передам его в поддержку. "
        "Ответ придёт сюда же.",
    )


async def _forward_question(
    client: httpx.AsyncClient,
    chat_id: int,
    tg_id: int,
    tg_username: str | None,
    question: str,
) -> None:
    """Переслать вопрос пользователя админу и запомнить, кому доставить ответ."""
    await redis_client.delete(f"bot:await_q:{tg_id}")

    if ADMIN_CHAT_ID is None:
        # Некуда пересылать — не теряем вопрос, но честно говорим пользователю.
        print(f"[question] no ADMIN_CHAT_ID; from {_user_tag(tg_username, tg_id)}: "
              f"{question!r}", flush=True)
        await _send(
            client, chat_id,
            "Вопрос принят, но канал поддержки временно не настроен. "
            "Свяжись с администратором напрямую.",
            reply_markup=MENU_KEYBOARD,
        )
        return

    tag = _user_tag(tg_username, tg_id)
    sent = await _send(
        client, ADMIN_CHAT_ID,
        f"💬 <b>Вопрос от {html.escape(tag)}</b>\n\n"
        f"{html.escape(question)}\n\n"
        f"<i>Ответь reply на это сообщение — бот доставит ответ пользователю.</i>",
    )
    if sent is not None:
        # Запоминаем: reply на это сообщение админа → доставить в chat_id спросившего.
        await redis_client.set(
            f"bot:qmap:{sent['message_id']}", str(chat_id), ex=QMAP_TTL_SEC
        )

    await _send(
        client, chat_id,
        "✅ Вопрос отправлен в поддержку. Ответ придёт сюда же.",
        reply_markup=MENU_KEYBOARD,
    )
    await _log_action(client, f"{tag} задал технический вопрос")


async def _deliver_admin_reply(
    client: httpx.AsyncClient, reply_to_msg_id: int, answer: str
) -> None:
    """Админ ответил reply на пересланный вопрос — доставить ответ спросившему."""
    asker_chat_id = await redis_client.get(f"bot:qmap:{reply_to_msg_id}")
    if asker_chat_id is None:
        await _send(
            client, ADMIN_CHAT_ID,  # type: ignore[arg-type]  # вызывается только когда задан
            "⚠️ Не нашёл, кому доставить этот ответ (вопрос устарел или это не "
            "reply на пересланный вопрос).",
        )
        return
    await _send(
        client, int(asker_chat_id),
        f"💬 <b>Ответ поддержки</b>\n\n{html.escape(answer)}",
        reply_markup=MENU_KEYBOARD,
    )
    await _send(client, ADMIN_CHAT_ID, "✅ Ответ доставлен пользователю.")  # type: ignore[arg-type]


async def _handle_callback(client: httpx.AsyncClient, cb: dict[str, Any]) -> None:
    await _answer_callback(client, cb["id"])
    data = cb.get("data")
    message = cb.get("message") or {}
    chat_id = message.get("chat", {}).get("id")
    from_user = cb.get("from") or {}
    tg_id = from_user.get("id", chat_id)
    tg_username = from_user.get("username")
    if chat_id is None:
        return

    if data == CB_GET_PASSWORD:
        await _issue_password(client, chat_id, tg_id, tg_username, action_verb="получил пароль")
    elif data == CB_RESET_PASSWORD:
        await _issue_password(client, chat_id, tg_id, tg_username, action_verb="восстановил пароль")
    elif data == CB_ASK_QUESTION:
        await _start_question(client, chat_id, tg_id)


async def _handle_message(client: httpx.AsyncClient, message: dict[str, Any]) -> None:
    chat_id = message["chat"]["id"]
    text = (message.get("text") or "").strip()
    from_user = message.get("from") or {}
    tg_id = from_user.get("id", chat_id)
    tg_username = from_user.get("username")

    # Ответ админа reply на пересланный вопрос → доставить спросившему.
    if ADMIN_CHAT_ID is not None and chat_id == ADMIN_CHAT_ID:
        reply_to = message.get("reply_to_message")
        if reply_to and text:
            await _deliver_admin_reply(client, reply_to["message_id"], text)
            return

    if text.startswith("/start"):
        await redis_client.delete(f"bot:await_q:{tg_id}")
        await _send(client, chat_id, START_TEXT, reply_markup=MENU_KEYBOARD)
        return

    # Пользователь в режиме «задаю вопрос» — его сообщение это вопрос.
    if text and await redis_client.get(f"bot:await_q:{tg_id}"):
        await _forward_question(client, chat_id, tg_id, tg_username, text)
        return

    # Любое иное сообщение — показываем меню.
    await _send(client, chat_id, START_TEXT, reply_markup=MENU_KEYBOARD)


async def main() -> None:
    if not BOT_TOKEN:
        raise SystemExit("TELEGRAM_BOT_TOKEN не задан")

    print(
        f"Bot started. Platform URL: {PLATFORM_URL}. Proxy: {TELEGRAM_PROXY or 'none'}. "
        f"Admin chat: {ADMIN_CHAT_ID if ADMIN_CHAT_ID is not None else 'not set'}",
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
                try:
                    if "callback_query" in upd:
                        await _handle_callback(client, upd["callback_query"])
                        continue
                    message = upd.get("message") or upd.get("edited_message")
                    if message and message.get("chat", {}).get("type") == "private":
                        await _handle_message(client, message)
                except Exception as exc:  # noqa: BLE001 — один сбой не роняет бота
                    print(f"handle update error: {type(exc).__name__}: {exc!r}", flush=True)


if __name__ == "__main__":
    asyncio.run(main())
