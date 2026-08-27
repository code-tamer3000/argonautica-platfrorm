"""Бот-воронка приёма и оплаты (ARG-92): анкета → тариф → чек → одобрение → юзер.

Персистентный long-polling процесс, тот же транспорт, что у access/support-бота
(`scripts/telegram_bot.py`, ADR-029) — HTTP Bot API через SOCKS5/HTTP-прокси, СВОЙ
Telegram-токен. Свой токен = свой `getUpdates`-поллер, конфликта с прод-ботом нет,
поэтому (в отличие от access-бота) этот сервис живёт на **стенде**.

Состояние воронки — в Postgres (`intake_applications`), не sqlite/Redis: заявка
переживает рестарт контейнера. Эфемерное «жду ответа на вопрос поддержки» — в Redis
(`intakebot:*`), тем же паттерном, что в access-боте (ADR-013).

Флоу (тексты — OldBot/bot_texts.md, ключи используются как есть):
  /start → «расскажи о себе» → анкета уходит в admin-чат с кнопкой «Принять» →
  админ принимает → участник выбирает тариф (список из БД: одна кнопка на тариф →
  экран описания → «Перейти к оплате», всё в одном сообщении через editMessageText) →
  реквизиты с ценой тарифа → участник шлёт чек → чек уходит в admin-чат с кнопкой
  «Подтвердить оплату» → админ подтверждает → создаётся пользователь платформы на
  ЭТОМ окружении (см. PLATFORM_URL — на стенде это staging), привязанный к активному
  набору и выбранному тарифу → участнику приходят логин/пароль → чат переходит в
  сервисный режим («Задать вопрос» / «Сменить пароль»).

Гарантия цены на время оплаты (ARG-108): «Согласен, к оплате» (принятие оферты)
заводит часы на INTAKE_PAYMENT_WINDOW_HOURS (24 по умолчанию) — не «Принять» и не
выбор тарифа: время на просмотр тарифов и чтение оферты не горит. Не пришла оплата в
окно — заявка уходит в `expired` (фоновый свип `_expire_sweep_loop`, потому что
молчащий участник не даёт боту ни одного апдейта), цена больше не гарантирована,
вернуться можно через /start → повторное рассмотрение админом (возможно, по новой
цене). На `payment_review` часы не тикают: чек уже прислан, дальше ход админа.

«Задать вопрос» доступна на любом шаге — командой /question и кнопкой меню бота
(setMyCommands + setChatMenuButton при старте сервиса); инлайн-кнопкой она висит
только на шаге оплаты (TEXT_ACCEPTED/_payment_keyboard) — там вопросы чаще всего.

Запуск (в образе backend): python -m scripts.intake_bot
Требует env: TELEGRAM_INTAKE_BOT_TOKEN, DATABASE_URL, REDIS_URL,
  (опц.) PLATFORM_URL, TELEGRAM_PROXY, TELEGRAM_INTAKE_BOT_ADMIN_CHAT_ID,
  TELEGRAM_INTAKE_BOT_LOG_CHAT_ID, INTAKE_PAYMENT_WINDOW_HOURS.
"""
from __future__ import annotations

import asyncio
import html
import json
import os
from datetime import UTC, datetime, timedelta, timezone
from typing import Any

import httpx
from fastapi import HTTPException
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.admin import create_user, delete_user
from app.core.redis import redis_client
from app.core.security import generate_one_time_password, hash_password
from app.db.session import SessionLocal
from app.models.intake import Intake
from app.models.intake_application import (
    STATUS_AWAITING_ABOUT,
    STATUS_AWAITING_OFFER,
    STATUS_AWAITING_RECEIPT,
    STATUS_CHOOSING_PLAN,
    STATUS_CONFIRMED,
    STATUS_EXPIRED,
    STATUS_PAYMENT_REVIEW,
    STATUS_SUBMITTED,
    STATUSES_ON_PAYMENT_CLOCK,
    IntakeApplication,
)
from app.models.plan import Plan
from app.models.task import Task, TaskAssignment
from app.models.user import User
from app.schemas.user import AdminCreateUserRequest

BOT_TOKEN = os.environ.get("TELEGRAM_INTAKE_BOT_TOKEN", "").strip()
PLATFORM_URL = os.environ.get("PLATFORM_URL", "https://staging.argonautica-systems.ru").rstrip("/")
TELEGRAM_PROXY = os.environ.get("TELEGRAM_PROXY", "").strip() or None
_admin_raw = os.environ.get("TELEGRAM_INTAKE_BOT_ADMIN_CHAT_ID", "").strip()
ADMIN_CHAT_ID: int | None = int(_admin_raw) if _admin_raw.lstrip("-").isdigit() else None
# Отдельный чат под служебные "📋"-логи (см. _log_action) — опционален: если не задан,
# логи, как и раньше, уходят в ADMIN_CHAT_ID. Позволяет вынести шум действий (сменил
# пароль и т.п.) из чата, где админ реально работает с кнопками/reply.
_log_raw = os.environ.get("TELEGRAM_INTAKE_BOT_LOG_CHAT_ID", "").strip()
LOG_CHAT_ID: int | None = int(_log_raw) if _log_raw.lstrip("-").isdigit() else None
# Сброс прогона воронки (ARG-95) — только там, где явно разрешено env-флагом. По
# умолчанию (и на проде) выключен: команда отвечает, что недоступна, и ничего не делает.
ALLOW_RESET = os.environ.get("INTAKE_BOT_ALLOW_RESET", "").strip().lower() in {
    "1", "true", "yes", "on",
}
API = f"https://api.telegram.org/bot{BOT_TOKEN}"


def _payment_window_hours() -> float:
    """Сколько часов гарантируем цену после принятия оферты (ARG-108).

    Дефолт зашит в код, а не в compose: прод-compose не трогаем, а на стенде
    ставится что-нибудь вроде 0.05, чтобы прогнать сгорание за минуты, а не за сутки.
    """
    raw = os.environ.get("INTAKE_PAYMENT_WINDOW_HOURS", "").strip()
    if not raw:
        return 24.0
    try:
        hours = float(raw)
    except ValueError:
        print(f"INTAKE_PAYMENT_WINDOW_HOURS={raw!r} — не число, беру 24", flush=True)
        return 24.0
    if hours <= 0:
        print(f"INTAKE_PAYMENT_WINDOW_HOURS={raw!r} — не положительное, беру 24", flush=True)
        return 24.0
    return hours


PAYMENT_WINDOW_HOURS = _payment_window_hours()
# Свип брони: молчащий участник не шлёт боту ни одного апдейта, поэтому сгорание не
# может быть реакцией на сообщение — нужен отдельный проход по времени. Минута
# погрешности на окне в сутки роли не играет, зато на стенде видно сразу.
EXPIRE_SWEEP_INTERVAL_SEC = 60
MSK = timezone(timedelta(hours=3))
MONTHS_RU = (
    "января", "февраля", "марта", "апреля", "мая", "июня",
    "июля", "августа", "сентября", "октября", "ноября", "декабря",
)

RATE_LIMIT = 3
RATE_WINDOW_SEC = 3600
AWAIT_QUESTION_TTL_SEC = 3600
QMAP_TTL_SEC = 7 * 24 * 3600

# --- Тексты (OldBot/bot_texts.md, использованы как есть) -------------------------

# Premium-эмодзи «звезда» из набора t.me/addemoji/argonautica_systems (custom_emoji_id
# получен через getStickerSet). Текст внутри тега — ОБЯЗАН быть настоящим Unicode-эмодзи
# (тот, с которым custom-эмодзи привязан в наборе — там это ⭐️): произвольный dingbat
# вроде ✦ Telegram отклоняет как ENTITY_TEXT_INVALID. ⭐ — это и есть фолбэк без Premium.
STAR = '<tg-emoji emoji-id="5440714865192765589">⭐</tg-emoji>'
# Тот же набор — кораблик вместо якоря. В наборе он привязан к базовому 🚀 (сам рисунок —
# ладья), поэтому фолбэком для не-Premium клиентов идёт 🚀, не ⚓️.
SHIP = '<tg-emoji emoji-id="5400063961808799043">🚀</tg-emoji>'
# Тот же набор — первое из двух чёрных сердечек, вместо конфетти на подтверждении оплаты.
HEART = '<tg-emoji emoji-id="5440725576841201330">🖤</tg-emoji>'

# Платёжные реквизиты — единственное место, откуда их берут TEXT_ACCEPTED и /info,
# чтобы не разъезжались при смене карты.
PAYMENT_DETAILS = "2200 2488 5210 8934 (ВТБ-банк)"
# Оплата зарубежной картой — Tribute mini-app, для тех, у кого нет счёта в РФ-банке.
# Один и тот же startapp-код на все тарифы (сумму и оффер Tribute настраивает у себя).
TRIBUTE_PAYMENT_URL = "https://t.me/tribute/app?startapp=dP8y"

TEXT_ASK_ABOUT = f"Представься пожалуйста. Опиши: в какой точке жизненного пути находишься? {STAR}"
TEXT_START = (
    f"{SHIP} <b>Экспедиция «Искусство посылания на Хер»</b>\n\n"
    "Путь Аргонавта: 28 дней, 5 миров, освобождение внимания и проявление своего "
    "Дела.\n\n"
    f"{TEXT_ASK_ABOUT}"
)
TEXT_NEED_START = "Чтобы начать — напиши /start."
TEXT_SUBMITTED = (
    f"{STAR} <b>Заявка принята к рассмотрению.</b>\n\n"
    f"Мы читаем каждую анкету лично. Как прочитаем — ответим. Жди весточку. {SHIP}"
)
TEXT_ACCEPTED = (
    f"{STAR} <b>Оплата.</b>\n\n"
    "Оплачивай экспедиционный взнос ({price}) — забронируем место.\n"
    f"Перевод на карту {PAYMENT_DETAILS}.\n\n"
    "После оплаты пришли сюда чек — PDF-файлом или скриншотом.\n"
    f"Как средства поступят на счёт — подтвердим место и вышлем доступы к "
    f"платформе. {SHIP}"
)
# Согласие с офертой (ARG-43) — экран между выбором тарифа и реквизитами.
TEXT_OFFER_PROMPT = (
    "Прежде чем перейти к оплате — прочитай оферту и подтверди согласие. 📄"
)
# Редакция принятой оферты (совпадает с «Редакция от …» в самом тексте оферты,
# frontend/src/features/oferta/content/oferta.md) — поднимать при правке текста.
OFFER_VERSION = "2026-08-19"
TEXT_NEED_RECEIPT = (
    "Чтобы подтвердить место — пришли чек об оплате: PDF-файлом или скриншотом. 🧾"
)
TEXT_RECEIPT_GOT = f"{STAR} Чек получен. Проверяем оплату — это недолго."
TEXT_CONFIRMED = (
    f"{HEART} <b>Оплата подтверждена. Ты в команде Экспедиции.</b>\n\n"
    "Добро пожаловать на борт, Аргонавт. Вот твои данные для входа на "
    "Платформу. Вся информация об Экспедиции будет появляться там.\n"
    f"До встречи! {SHIP}"
)
TEXT_WAIT_DECISION = f"Твоя заявка на рассмотрении. Вернёмся с решением — жди здесь. {SHIP}"
TEXT_WAIT_PAYMENT_CHECK = f"Проверяем оплату. Скоро подтвердим. {STAR}"
TEXT_ALREADY_DONE = (
    "Ты уже на борту Экспедиции 🎉 Следи за этим чатом — пришлём детали старта."
)

# Временные заглушки — финальные тексты допишет пользователь позже (см. ARG-92 «Границы»).
TEXT_SERVICE_MENU = "Чем помочь?"
TEXT_ASK_QUESTION_PROMPT = (
    "💬 Напиши свой вопрос одним сообщением — я передам его в поддержку. "
    "Ответ придёт сюда же."
)
TEXT_QUESTION_SENT = "✅ Вопрос отправлен в поддержку. Ответ придёт сюда же."
TEXT_NEED_USERNAME = (
    "У тебя не задан @username в Telegram. Открой Настройки → «Имя пользователя», "
    "задай его и напиши сюда что угодно, чтобы мы попробовали снова."
)

# --- Окно на оплату: цена гарантирована ограниченное время (ARG-108) ---------
# Не «бронь места» — мест хватает всем, кто дошёл до оплаты. Смысл дедлайна в
# том, что цена тарифа зафиксирована только на это время: если админ успеет
# поднять тарифы, пока участник тянет с оплатой, при повторном заходе он увидит
# уже новую цену. Тексты объясняют участнику именно это, а не «конкуренцию за место».

TEXT_DEADLINE_NOTE = (
    "⏳ Держим эту цену для тебя до <b>{deadline}</b> (МСК) — после этого цена "
    "тарифа может измениться."
)
TEXT_EXPIRED = (
    "⏳ <b>Время действия цены истекло.</b>\n\n"
    f"Напиши /start, и мы снова рассмотрим твою заявку. {SHIP}"
)
TEXT_EXPIRED_ALERT = "Время на оплату истекло."
TEXT_RESUBMITTED = (
    f"{STAR} <b>Заявка снова отправлена на рассмотрение.</b>\n\n"
    f"Мы читаем каждую анкету лично. Как прочитаем — ответим. Жди весточку. {SHIP}"
)

# --- Callback-data ------------------------------------------------------------
# admin: acc:<app_id> (принять анкету), pay:<app_id> (подтвердить оплату)
# участник: pd:<app_id>:<plan_id> (экран описания тарифа), pl:<app_id> (назад к списку),
#           pc:<app_id>:<plan_id> (перейти к оплате), svc_pw (сменить пароль).
# svc_q (задать вопрос) — на шаге оплаты (_payment_keyboard, самый частый момент
# вопросов), в остальных клавиатурах не рисуется, там основной путь — /question.

CB_ASK_QUESTION = "svc_q"
CB_CHANGE_PASSWORD = "svc_pw"

TEXT_STEP_DONE = "Этот шаг уже пройден."

# --- /reset (ARG-95, служебная команда админского DM) --------------------------

TEXT_RESET_DISABLED = (
    "🚫 Сброс прогона на этом окружении недоступен (INTAKE_BOT_ALLOW_RESET выключен)."
)
TEXT_RESET_USAGE = "Формат: <code>/reset</code> или <code>/reset @username</code>"
TEXT_CONFIRM_USAGE = "Формат: <code>/confirm @username</code>"


def _user_tag(tg_username: str | None, tg_id: int) -> str:
    return f"@{tg_username}" if tg_username else f"tg-user {tg_id}"


def _display_name(app: IntakeApplication) -> str:
    parts = [p for p in (app.tg_first_name, app.tg_last_name) if p]
    if parts:
        return " ".join(parts)
    return app.tg_username or f"tg{app.tg_id}"


# --- Telegram API --------------------------------------------------------------


# Стили инлайн-кнопок (`style: "success"`) поддерживает не каждая версия Bot API. Если
# сервер ответил «не знаю такого поля», один раз снимаем стили и дальше шлём без них —
# кнопка важнее её цвета, иначе экран оплаты просто не отрисуется.
_button_styles_supported = True


def _strip_button_styles(markup: dict[str, Any] | None) -> dict[str, Any] | None:
    if not markup or "inline_keyboard" not in markup:
        return markup
    return {
        "inline_keyboard": [
            [{k: v for k, v in button.items() if k != "style"} for button in row]
            for row in markup["inline_keyboard"]
        ]
    }


async def _api_call(
    client: httpx.AsyncClient, method: str, payload: dict[str, Any]
) -> dict[str, Any] | None:
    """POST в Bot API. None — если запрос не удался или Telegram ответил ok=false."""
    global _button_styles_supported

    if not _button_styles_supported and "reply_markup" in payload:
        payload = {**payload, "reply_markup": _strip_button_styles(payload["reply_markup"])}
    try:
        body = (await client.post(f"{API}/{method}", json=payload)).json()
    except (httpx.HTTPError, ValueError) as exc:  # noqa: BLE001 — бот не должен падать из-за сети
        print(f"{method} failed: {type(exc).__name__}: {exc!r}", flush=True)
        return None
    if body.get("ok"):
        result = body.get("result")
        return result if isinstance(result, dict) else None

    description = str(body.get("description", ""))
    print(f"{method} rejected: {description}", flush=True)
    if _button_styles_supported and "style" in description.lower() and "reply_markup" in payload:
        _button_styles_supported = False
        return await _api_call(
            client,
            method,
            {**payload, "reply_markup": _strip_button_styles(payload["reply_markup"])},
        )
    return None


async def _send(
    client: httpx.AsyncClient,
    chat_id: int,
    text: str,
    reply_markup: dict[str, Any] | None = None,
) -> dict[str, Any] | None:
    payload: dict[str, Any] = {
        "chat_id": chat_id,
        "text": text,
        "parse_mode": "HTML",
        "disable_web_page_preview": True,
    }
    if reply_markup is not None:
        payload["reply_markup"] = reply_markup
    return await _api_call(client, "sendMessage", payload)


async def _edit_or_send(
    client: httpx.AsyncClient,
    chat_id: int,
    message_id: int | None,
    text: str,
    reply_markup: dict[str, Any] | None = None,
) -> dict[str, Any] | None:
    """Перерисовать экран в том же сообщении; если не вышло — отправить новое.

    Экран выбора тарифа живёт в одном сообщении: список ⇄ описание — это
    editMessageText, а не новая пачка сообщений в чате. Сообщение могли удалить
    (или Telegram отказал по любой другой причине) — тогда молча отправляем новое,
    участник ошибки не видит (см. «Assumptions» ARG-94).
    """
    if message_id is not None:
        payload: dict[str, Any] = {
            "chat_id": chat_id,
            "message_id": message_id,
            "text": text,
            "parse_mode": "HTML",
            "disable_web_page_preview": True,
        }
        if reply_markup is not None:
            payload["reply_markup"] = reply_markup
        edited = await _api_call(client, "editMessageText", payload)
        if edited is not None:
            return edited
    return await _send(client, chat_id, text, reply_markup=reply_markup)


async def _edit_text(
    client: httpx.AsyncClient,
    chat_id: int,
    message_id: int,
    text: str,
    reply_markup: dict[str, Any] | None = None,
) -> dict[str, Any] | None:
    """Отредактировать уже отправленное сообщение на месте (без фолбэка на send —

    в отличие от `_edit_or_send`, вызывающий точно знает, что сообщение существует:
    это то самое сообщение, у которого только что нажали кнопку.
    """
    payload: dict[str, Any] = {
        "chat_id": chat_id,
        "message_id": message_id,
        "text": text,
        "parse_mode": "HTML",
        "disable_web_page_preview": True,
    }
    if reply_markup is not None:
        payload["reply_markup"] = reply_markup
    return await _api_call(client, "editMessageText", payload)


async def _edit_caption(
    client: httpx.AsyncClient,
    chat_id: int,
    message_id: int,
    caption: str,
    reply_markup: dict[str, Any] | None = None,
) -> dict[str, Any] | None:
    """То же, что `_edit_text`, но для caption фото/документа (чек)."""
    payload: dict[str, Any] = {
        "chat_id": chat_id,
        "message_id": message_id,
        "caption": caption,
        "parse_mode": "HTML",
    }
    if reply_markup is not None:
        payload["reply_markup"] = reply_markup
    return await _api_call(client, "editMessageCaption", payload)


async def _send_photo(
    client: httpx.AsyncClient,
    chat_id: int,
    file_id: str,
    caption: str,
    reply_markup: dict[str, Any] | None = None,
) -> None:
    payload: dict[str, Any] = {
        "chat_id": chat_id,
        "photo": file_id,
        "caption": caption,
        "parse_mode": "HTML",
    }
    if reply_markup is not None:
        payload["reply_markup"] = reply_markup
    try:
        await client.post(f"{API}/sendPhoto", json=payload)
    except httpx.HTTPError as exc:  # noqa: BLE001
        print(f"sendPhoto failed: {type(exc).__name__}: {exc!r}", flush=True)


async def _send_document(
    client: httpx.AsyncClient,
    chat_id: int,
    file_id: str,
    caption: str,
    reply_markup: dict[str, Any] | None = None,
) -> None:
    payload: dict[str, Any] = {
        "chat_id": chat_id,
        "document": file_id,
        "caption": caption,
        "parse_mode": "HTML",
    }
    if reply_markup is not None:
        payload["reply_markup"] = reply_markup
    try:
        await client.post(f"{API}/sendDocument", json=payload)
    except httpx.HTTPError as exc:  # noqa: BLE001
        print(f"sendDocument failed: {type(exc).__name__}: {exc!r}", flush=True)


async def _answer_callback(
    client: httpx.AsyncClient, callback_id: str, text: str | None = None, alert: bool = False
) -> None:
    payload: dict[str, Any] = {"callback_query_id": callback_id}
    if text:
        payload["text"] = text
        payload["show_alert"] = alert
    try:
        await client.post(f"{API}/answerCallbackQuery", json=payload)
    except httpx.HTTPError as exc:  # noqa: BLE001
        print(f"answerCallbackQuery failed: {type(exc).__name__}: {exc!r}", flush=True)


async def _log_action(client: httpx.AsyncClient, text: str) -> None:
    """Служебный лог действия — в LOG_CHAT_ID, если он задан, иначе в ADMIN_CHAT_ID

    (прежнее поведение). Отдельный чат позволяет не мешать инфо-шум (сменил пароль
    и т.п.) с чатом, где админ реально нажимает кнопки/отвечает reply'ем."""
    print(f"[action] {text}", flush=True)
    target = LOG_CHAT_ID if LOG_CHAT_ID is not None else ADMIN_CHAT_ID
    if target is not None:
        await _send(client, target, f"📋 {text}")


# --- Работа с БД -----------------------------------------------------------


async def _find_application(session: AsyncSession, tg_id: int) -> IntakeApplication | None:
    return (
        await session.execute(
            select(IntakeApplication).where(IntakeApplication.tg_id == tg_id)
        )
    ).scalar_one_or_none()


async def _current_intake(session: AsyncSession) -> Intake | None:
    """Активный набор — с максимальной starts_on (см. docs/DATA_MODEL.md)."""
    return (
        await session.execute(select(Intake).order_by(Intake.starts_on.desc()).limit(1))
    ).scalars().first()


async def _active_plans(session: AsyncSession) -> list[Plan]:
    return list(
        (
            await session.execute(
                select(Plan).where(Plan.is_active.is_(True)).order_by(Plan.price)
            )
        )
        .scalars()
        .all()
    )


def _price_str(price: int) -> str:
    return f"{price:,} ₽".replace(",", " ")


def _plans_keyboard(app_id: int, plans: list[Plan]) -> dict[str, Any]:
    """Ровно одна кнопка на активный тариф — «название — цена», ведёт на описание.

    Никаких вторых кнопок и никаких посторонних рядов: это последний экран перед
    оплатой, и выбирать человек должен тариф, а не кнопку (ARG-94).
    """
    return {
        "inline_keyboard": [
            [
                {
                    "text": f"{plan.name} — {_price_str(plan.price)}",
                    "callback_data": f"pd:{app_id}:{plan.id}",
                }
            ]
            for plan in plans
        ]
    }


def _plan_details_keyboard(app_id: int, plan_id: int) -> dict[str, Any]:
    return {
        "inline_keyboard": [
            [
                {"text": "⬅️ Назад", "callback_data": f"pl:{app_id}"},
                {
                    "text": "✅ Перейти к оплате",
                    "callback_data": f"pc:{app_id}:{plan_id}",
                    "style": "success",
                },
            ]
        ]
    }


def _offer_keyboard(app_id: int) -> dict[str, Any]:
    """Экран согласия: WebApp-кнопка с текстом оферты + явное согласие.

    Без нажатия «Согласен» заявитель не получает TEXT_ACCEPTED (реквизиты) —
    см. `_handle_offer_accept`.
    """
    return {
        "inline_keyboard": [
            [{"text": "📄 Читать оферту", "web_app": {"url": f"{PLATFORM_URL}/oferta"}}],
            [{"text": "✅ Согласен, к оплате", "callback_data": f"of:{app_id}"}],
        ]
    }


def _payment_keyboard() -> dict[str, Any]:
    """Кнопки на шаге оплаты (TEXT_ACCEPTED) — самый частый момент, где у заявителя

    возникают вопросы (реквизиты, чек) или проблема с РФ-картой:
    - «Связаться по техническим вопросам» переиспользует существующий
      CB_ASK_QUESTION/_handle_ask_question (висит прямо на сообщении, а не только
      через /question);
    - «Оплатить зарубежной картой» — обычная ссылка (не web_app: это deep-link в
      чужой мини-апп Tribute, а не наш /oferta), один и тот же startapp-код на все
      тарифы (сумму и оффер Tribute настраивает у себя).
    """
    return {
        "inline_keyboard": [
            [{"text": "💬 Связаться по техническим вопросам", "callback_data": CB_ASK_QUESTION}],
            [{"text": "💳 Оплатить зарубежной картой", "url": TRIBUTE_PAYMENT_URL}],
        ]
    }


def _service_keyboard() -> dict[str, Any]:
    return {
        "inline_keyboard": [
            [{"text": "🔑 Сменить пароль", "callback_data": CB_CHANGE_PASSWORD}],
        ]
    }


async def _rate_ok(tg_id: int) -> bool:
    key = f"intakebot:pwd:{tg_id}"
    count = await redis_client.incr(key)
    if count == 1:
        await redis_client.expire(key, RATE_WINDOW_SEC)
    return bool(count <= RATE_LIMIT)


# --- Гарантия цены: дедлайн, сгорание, свип (ARG-108) --------------------------


def _deadline_str(deadline: datetime) -> str:
    """«21:40 27 августа» — момент в МСК, как его читает участник."""
    local = deadline.astimezone(MSK)
    return f"{local:%H:%M} {local.day} {MONTHS_RU[local.month - 1]}"


def _with_deadline(text: str, app: IntakeApplication) -> str:
    """Добавить к сообщению строку про гарантию цены, если часы тикают.

    Напоминаний «осталось N часов» нет намеренно — дедлайн называется один раз,
    сразу на экране реквизитов (единственном, где часы уже идут).
    """
    if app.payment_deadline_at is None or app.status not in STATUSES_ON_PAYMENT_CLOCK:
        return text
    note = TEXT_DEADLINE_NOTE.format(deadline=_deadline_str(app.payment_deadline_at))
    return f"{text}\n\n{note}"


def _deadline_passed(app: IntakeApplication) -> bool:
    """Окно вышло — и вышло именно на том шаге, где часы вообще тикают."""
    return (
        app.status in STATUSES_ON_PAYMENT_CLOCK
        and app.payment_deadline_at is not None
        and app.payment_deadline_at <= datetime.now(UTC)
    )


async def _mark_expired(session: AsyncSession, app: IntakeApplication) -> None:
    app.status = STATUS_EXPIRED
    app.expired_at = datetime.now(UTC)
    await session.flush()


async def _notify_expired(client: httpx.AsyncClient, app: IntakeApplication) -> None:
    """Сообщить обоим: участнику — что цена больше не гарантирована, админу — что
    можно принять заявку заново, с кнопкой «Принять снова» (она же «продлить»)."""
    await _send(client, app.tg_id, TEXT_EXPIRED)
    if ADMIN_CHAT_ID is None:
        return
    tag = _user_tag(app.tg_username, app.tg_id)
    await _send(
        client, ADMIN_CHAT_ID,
        f"⌛️ <b>Заявка #{app.id}</b> ({html.escape(tag)}): время на оплату истекло, "
        f"цена больше не гарантирована.\n\n{html.escape(app.about or '')}",
        reply_markup={
            "inline_keyboard": [[{"text": "✅ Принять снова", "callback_data": f"acc:{app.id}"}]]
        },
    )
    print(f"[action] окно оплаты заявки #{app.id} ({tag}) истекло", flush=True)


async def _expire_now(
    client: httpx.AsyncClient, session: AsyncSession, app: IntakeApplication
) -> None:
    await _mark_expired(session, app)
    await _notify_expired(client, app)


async def _expired_guard(
    client: httpx.AsyncClient,
    session: AsyncSession,
    app: IntakeApplication,
    cb: dict[str, Any],
) -> bool:
    """True — заявка сгорела, обработчик кнопки должен остановиться.

    Проверка синхронная, а не «дождёмся свипа»: между истечением и проходом свипа
    до минуты, и всё это время кнопки в чате живые.
    """
    if app.status != STATUS_EXPIRED and not _deadline_passed(app):
        return False
    if app.status != STATUS_EXPIRED:
        await _expire_now(client, session, app)
    await _answer_callback(client, cb["id"], TEXT_EXPIRED_ALERT, alert=True)
    return True


async def _expire_overdue(client: httpx.AsyncClient, session: AsyncSession) -> int:
    """Снять гарантию цены со всех заявок с вышедшим окном. Возвращает число снятых.

    Сначала статусы в БД + commit, и только потом сообщения: иначе упавший commit
    оставит участника с сообщением «истекло» при живой заявке, а следующий проход
    пришлёт то же самое ещё раз.
    """
    overdue = list(
        (
            await session.execute(
                select(IntakeApplication)
                .where(
                    IntakeApplication.status.in_(STATUSES_ON_PAYMENT_CLOCK),
                    IntakeApplication.payment_deadline_at.is_not(None),
                    IntakeApplication.payment_deadline_at <= datetime.now(UTC),
                )
                .order_by(IntakeApplication.payment_deadline_at)
            )
        )
        .scalars()
        .all()
    )
    if not overdue:
        return 0
    for app in overdue:
        await _mark_expired(session, app)
    await session.commit()
    for app in overdue:
        await _notify_expired(client, app)
    return len(overdue)


async def _expire_sweep_loop(client: httpx.AsyncClient) -> None:
    """Часы брони. Отдельная корутина рядом с long-poll-циклом: участник, который
    просто молчит, не даёт боту ни одного повода проснуться."""
    while True:
        try:
            async with SessionLocal() as session:
                await _expire_overdue(client, session)
        except Exception as exc:  # noqa: BLE001 — свип не должен ронять бота
            print(f"expire sweep error: {type(exc).__name__}: {exc!r}", flush=True)
        await asyncio.sleep(EXPIRE_SWEEP_INTERVAL_SEC)


# --- Шаги воронки ------------------------------------------------------------


async def _status_reminder(client: httpx.AsyncClient, chat_id: int, app: IntakeApplication) -> None:
    """Повторить текущий статус, если участник написал что-то мимо ожидаемого шага."""
    reminders = {
        STATUS_AWAITING_ABOUT: TEXT_ASK_ABOUT,
        STATUS_SUBMITTED: TEXT_WAIT_DECISION,
        STATUS_AWAITING_OFFER: TEXT_OFFER_PROMPT,
        STATUS_AWAITING_RECEIPT: TEXT_NEED_RECEIPT,
        STATUS_PAYMENT_REVIEW: TEXT_WAIT_PAYMENT_CHECK,
        STATUS_EXPIRED: TEXT_EXPIRED,
    }
    text = reminders.get(app.status)
    if text:
        await _send(client, chat_id, text)


TEXT_PLAN_LIST = "Выбери тариф — покажу, что входит, и переведу к оплате:"
TEXT_NO_PLANS = f"Список тарифов временно пуст — мы уже знаем и разберёмся. Жди весточку. {SHIP}"


async def _send_plan_list(
    client: httpx.AsyncClient,
    session: AsyncSession,
    chat_id: int,
    app: IntakeApplication,
    message_id: int | None = None,
) -> None:
    """Экран списка тарифов. `message_id` — перерисовать его в том же сообщении."""
    plans = await _active_plans(session)
    if not plans:
        await _edit_or_send(client, chat_id, message_id, TEXT_NO_PLANS)
        return
    await _edit_or_send(
        client, chat_id, message_id, TEXT_PLAN_LIST,
        reply_markup=_plans_keyboard(app.id, plans),
    )


async def _handle_about(
    client: httpx.AsyncClient,
    session: AsyncSession,
    chat_id: int,
    app: IntakeApplication,
    text: str,
) -> None:
    app.about = text
    app.status = STATUS_SUBMITTED
    app.submitted_at = datetime.now(UTC)
    await session.flush()
    await _send(client, chat_id, TEXT_SUBMITTED)
    await _send_anketa_to_admin(client, app)


async def _send_anketa_to_admin(
    client: httpx.AsyncClient, app: IntakeApplication, *, repeat: bool = False
) -> None:
    """Карточка анкеты в admin-чат с кнопкой «Принять».

    `repeat=True` — заявка вернулась после истёкшего окна на оплату (ARG-108): та же
    кнопка, тот же `acc:`-callback, отличается только шапка, чтобы админ видел, что
    это второй заход, а не новый человек.
    """
    if ADMIN_CHAT_ID is None:
        return
    tag = _user_tag(app.tg_username, app.tg_id)
    if repeat:
        header = (
            f"🔁 <b>Повторная заявка от {html.escape(tag)}</b>\n"
            "<i>Не успел оплатить в срок по прошлой заявке — цена больше не гарантирована.</i>"
        )
    else:
        header = f"📝 <b>Новая заявка от {html.escape(tag)}</b>"
    await _send(
        client, ADMIN_CHAT_ID,
        f"{header}\n\n{html.escape(app.about or '')}",
        reply_markup={
            "inline_keyboard": [[{"text": "✅ Принять", "callback_data": f"acc:{app.id}"}]]
        },
    )


async def _handle_receipt(
    client: httpx.AsyncClient,
    session: AsyncSession,
    chat_id: int,
    app: IntakeApplication,
    file_id: str,
    kind: str,
) -> None:
    app.receipt_file_id = file_id
    app.receipt_kind = kind
    app.status = STATUS_PAYMENT_REVIEW
    app.receipt_at = datetime.now(UTC)
    await session.flush()
    await _send(client, chat_id, TEXT_RECEIPT_GOT)

    if ADMIN_CHAT_ID is not None:
        tag = _user_tag(app.tg_username, app.tg_id)
        caption = f"🧾 Чек от {html.escape(tag)} (заявка #{app.id})"
        markup = {
            "inline_keyboard": [[{"text": "✅ Подтвердить оплату", "callback_data": f"pay:{app.id}"}]]
        }
        if kind == "photo":
            await _send_photo(client, ADMIN_CHAT_ID, file_id, caption, reply_markup=markup)
        else:
            await _send_document(client, ADMIN_CHAT_ID, file_id, caption, reply_markup=markup)


async def _create_platform_user(
    session: AsyncSession, app: IntakeApplication
) -> tuple[str, str] | None:
    """Создать пользователя платформы. None, если у заявителя нет @username."""
    if not app.tg_username:
        return None
    intake = await _current_intake(session)
    if intake is None:
        return None
    body = AdminCreateUserRequest(
        username=app.tg_username,
        display_name=_display_name(app),
        role="participant",
        intake_id=intake.id,
        plan_id=app.plan_id,
    )
    response = await create_user(body, session)
    app.user_id = response.id
    await _assign_intake_welcome_tasks(session, intake.id, response.id)
    return response.username, response.one_time_password


async def _assign_intake_welcome_tasks(
    session: AsyncSession, intake_id: int, user_id: int
) -> None:
    """Назначить новичку индивидуальные задания-приветствия его набора.

    Заводятся provisioning-скриптом (scripts/provision_second_intake.py) с пустым
    списком получателей — здесь список наполняется по мере регистрации. `intake_id`
    у individual-заданий тут — метка «чьё это приветствие», видимость по-прежнему
    решает исключительно назначение (task.py:70-73), поэтому 0 заявителей до сих пор
    ничего никому не показывал.
    """
    tasks = (
        await session.execute(
            select(Task.id).where(
                Task.type == "individual",
                Task.intake_id == intake_id,
                Task.deleted_at.is_(None),
            )
        )
    ).scalars().all()
    for task_id in tasks:
        session.add(TaskAssignment(task_id=task_id, user_id=user_id))
    if tasks:
        await session.flush()


# --- Обработчики callback-кнопок ---------------------------------------------


async def _handle_accept(client: httpx.AsyncClient, session: AsyncSession, cb: dict[str, Any]) -> None:
    chat_id = (cb.get("message") or {}).get("chat", {}).get("id")
    if chat_id != ADMIN_CHAT_ID:
        return
    app_id = int(cb["data"].split(":", 1)[1])
    app = await session.get(IntakeApplication, app_id)
    if app is None or app.status not in (STATUS_SUBMITTED, STATUS_EXPIRED):
        await _answer_callback(client, cb["id"], "Уже обработано", alert=True)
        return
    # Приём сгоревшей заявки — это и «принять заново», и «продлить»: воронка
    # начинается с выбора тарифа, оферта принимается ещё раз (согласие привязано к
    # конкретной оплате). Часы брони по-прежнему не тикают — они заводятся заново
    # только когда участник дойдёт до «Согласен, к оплате» (см. _handle_offer_accept).
    if app.status == STATUS_EXPIRED:
        app.plan_id = None
        app.offer_accepted_at = None
        app.offer_version = None
        app.expired_at = None
        app.payment_deadline_at = None
    app.status = STATUS_CHOOSING_PLAN
    app.accepted_at = datetime.now(UTC)
    await session.flush()
    await _answer_callback(client, cb["id"], "Принято")

    tag = _user_tag(app.tg_username, app.tg_id)
    message_id = (cb.get("message") or {}).get("message_id")
    if message_id is not None:
        await _edit_text(
            client, ADMIN_CHAT_ID, message_id,  # type: ignore[arg-type]
            f"📝 <b>Заявка от {html.escape(tag)}</b> — ✅ Принята\n\n"
            f"{html.escape(app.about or '')}",
            reply_markup={"inline_keyboard": []},
        )
    await _send_plan_list(client, session, app.tg_id, app)
    print(f"[action] заявка #{app.id} ({tag}) принята", flush=True)


def _plan_screen_context(
    cb: dict[str, Any], app: IntakeApplication | None
) -> tuple[int, int | None] | None:
    """(chat_id, message_id) экрана тарифа — либо None, если это чужой чат."""
    message = cb.get("message") or {}
    chat_id = message.get("chat", {}).get("id")
    if app is None or chat_id != app.tg_id:
        return None
    return chat_id, message.get("message_id")


async def _handle_plan_details(client: httpx.AsyncClient, session: AsyncSession, cb: dict[str, Any]) -> None:
    _, app_id_s, plan_id_s = cb["data"].split(":")
    app = await session.get(IntakeApplication, int(app_id_s))
    plan = await session.get(Plan, int(plan_id_s))
    context = _plan_screen_context(cb, app)
    if app is None or context is None:
        await _answer_callback(client, cb["id"])
        return
    if await _expired_guard(client, session, app, cb):
        return
    if app.status != STATUS_CHOOSING_PLAN:
        await _answer_callback(client, cb["id"], TEXT_STEP_DONE, alert=True)
        return
    if plan is None:
        await _answer_callback(client, cb["id"], "Тариф больше не доступен", alert=True)
        return
    await _answer_callback(client, cb["id"])
    chat_id, message_id = context
    description = plan.description or "Описание пока не заполнено."
    await _edit_or_send(
        client, chat_id, message_id,
        f"<b>{html.escape(plan.name)}</b> — {_price_str(plan.price)}\n\n{html.escape(description)}",
        reply_markup=_plan_details_keyboard(app.id, plan.id),
    )


async def _handle_plan_list(client: httpx.AsyncClient, session: AsyncSession, cb: dict[str, Any]) -> None:
    app_id = int(cb["data"].split(":", 1)[1])
    app = await session.get(IntakeApplication, app_id)
    context = _plan_screen_context(cb, app)
    if app is None or context is None:
        await _answer_callback(client, cb["id"])
        return
    if await _expired_guard(client, session, app, cb):
        return
    if app.status != STATUS_CHOOSING_PLAN:
        await _answer_callback(client, cb["id"], TEXT_STEP_DONE, alert=True)
        return
    await _answer_callback(client, cb["id"])
    chat_id, message_id = context
    await _send_plan_list(client, session, chat_id, app, message_id=message_id)


async def _handle_plan_choose(client: httpx.AsyncClient, session: AsyncSession, cb: dict[str, Any]) -> None:
    _, app_id_s, plan_id_s = cb["data"].split(":")
    app = await session.get(IntakeApplication, int(app_id_s))
    context = _plan_screen_context(cb, app)
    if app is None or context is None:
        await _answer_callback(client, cb["id"])
        return
    if await _expired_guard(client, session, app, cb):
        return
    # Экран мог устареть: заявку уже увели дальше по воронке из другого места.
    # Тогда данные не трогаем вообще — только алерт (ARG-94).
    if app.status != STATUS_CHOOSING_PLAN:
        await _answer_callback(client, cb["id"], TEXT_STEP_DONE, alert=True)
        return
    plan = await session.get(Plan, int(plan_id_s))
    if plan is None:
        await _answer_callback(client, cb["id"], "Тариф больше не доступен", alert=True)
        return
    app.plan_id = plan.id
    app.status = STATUS_AWAITING_OFFER
    app.plan_chosen_at = datetime.now(UTC)
    await session.flush()
    await _answer_callback(client, cb["id"], f"Выбрано: {plan.name}")
    chat_id, _ = context
    await _send(client, chat_id, TEXT_OFFER_PROMPT, reply_markup=_offer_keyboard(app.id))


async def _handle_offer_accept(client: httpx.AsyncClient, session: AsyncSession, cb: dict[str, Any]) -> None:
    """«✅ Согласен, к оплате» — фиксирует согласие с офертой (ARG-43) и только
    после этого открывает шаг присылки чека (реквизиты — в TEXT_ACCEPTED)."""
    app_id = int(cb["data"].split(":", 1)[1])
    app = await session.get(IntakeApplication, app_id)
    context = _plan_screen_context(cb, app)
    if app is None or context is None:
        await _answer_callback(client, cb["id"])
        return
    if await _expired_guard(client, session, app, cb):
        return
    if app.status != STATUS_AWAITING_OFFER:
        await _answer_callback(client, cb["id"], TEXT_STEP_DONE, alert=True)
        return
    plan = await session.get(Plan, app.plan_id) if app.plan_id else None
    if plan is None:
        await _answer_callback(client, cb["id"], "Тариф больше не доступен", alert=True)
        return
    app.offer_accepted_at = datetime.now(UTC)
    app.offer_version = OFFER_VERSION
    app.status = STATUS_AWAITING_RECEIPT
    # Часы брони (ARG-108) заводятся здесь, а не на «Принять»: участник только что
    # прочитал и принял оферту — окно на оплату должно отсчитываться от этого
    # момента, а не съедаться временем на выбор тарифа и чтение оферты.
    app.payment_deadline_at = datetime.now(UTC) + timedelta(hours=PAYMENT_WINDOW_HOURS)
    await session.flush()
    await _answer_callback(client, cb["id"], "Принято")
    chat_id, _ = context
    await _send(
        client, chat_id,
        _with_deadline(TEXT_ACCEPTED.format(price=_price_str(plan.price)), app),
        reply_markup=_payment_keyboard(),
    )


async def _finalize_payment(
    client: httpx.AsyncClient, session: AsyncSession, app: IntakeApplication, *, manual: bool
) -> tuple[str, str] | None:
    """Создать аккаунт участника и завершить заявку — общий хвост для кнопки

    «Подтвердить оплату» и для ручной команды `/confirm` (ARG — оплата мимо чека,
    например из-за рубежа через Tribute). None — нет @username или нет активного
    набора (см. `_create_platform_user`); вызывающий уже знает, какой из двух
    случаев у него на руках, и формулирует сообщение админу сам.
    HTTPException (логин занят / набор не найден на уровне create_user) не
    ловится тут — откат транзакции делает вызывающий.
    """
    created = await _create_platform_user(session, app)
    if created is None:
        return None
    username, password = created
    app.status = STATUS_CONFIRMED
    app.confirmed_at = datetime.now(UTC)
    await session.flush()

    await _send(
        client, app.tg_id,
        f"{TEXT_CONFIRMED}\n\n"
        f"🔗 Ссылка: {PLATFORM_URL}\n"
        f"👤 Логин: <code>{html.escape(username)}</code>\n"
        f"🔑 Пароль: <code>{html.escape(password)}</code>\n\n"
        f"При первом входе система попросит сменить пароль.",
        reply_markup=_service_keyboard(),
    )
    tag = _user_tag(app.tg_username, app.tg_id)
    suffix = " вручную (без чека)" if manual else ""
    print(f"[action] заявка #{app.id} ({tag}) подтверждена{suffix}, юзер {username}", flush=True)
    return username, password


async def _handle_confirm_payment(client: httpx.AsyncClient, session: AsyncSession, cb: dict[str, Any]) -> None:
    chat_id = (cb.get("message") or {}).get("chat", {}).get("id")
    if chat_id != ADMIN_CHAT_ID:
        return
    app_id = int(cb["data"].split(":", 1)[1])
    app = await session.get(IntakeApplication, app_id)
    if app is None or app.status != STATUS_PAYMENT_REVIEW:
        await _answer_callback(client, cb["id"], "Уже обработано", alert=True)
        return

    try:
        created = await _finalize_payment(client, session, app, manual=False)
    except HTTPException:
        await session.rollback()
        await _answer_callback(client, cb["id"], "Такой логин уже занят или набор не найден", alert=True)
        return
    if created is None:
        await _answer_callback(
            client, cb["id"], "У участника нет @username в Telegram — не могу завести логин", alert=True
        )
        await _send(client, app.tg_id, TEXT_NEED_USERNAME)
        return

    username, _password = created
    await _answer_callback(client, cb["id"], "Подтверждено")

    tag = _user_tag(app.tg_username, app.tg_id)
    message_id = (cb.get("message") or {}).get("message_id")
    if message_id is not None:
        await _edit_caption(
            client, ADMIN_CHAT_ID, message_id,  # type: ignore[arg-type]
            f"🧾 Чек от {html.escape(tag)} (заявка #{app.id}) — ✅ Подтверждено, логин "
            f"{html.escape(username)}",
            reply_markup={"inline_keyboard": []},
        )


async def _await_question(client: httpx.AsyncClient, chat_id: int, tg_id: int) -> None:
    """Взять у участника вопрос следующим сообщением (флаг в Redis, TTL — час)."""
    await redis_client.set(f"intakebot:await_q:{tg_id}", "1", ex=AWAIT_QUESTION_TTL_SEC)
    await _send(client, chat_id, TEXT_ASK_QUESTION_PROMPT)


async def _handle_ask_question(client: httpx.AsyncClient, cb: dict[str, Any]) -> None:
    """Инлайн-кнопка «Задать вопрос» — сейчас только на шаге оплаты (_payment_keyboard),
    в остальных клавиатурах вместо неё /question и кнопка меню. В уже отправленных
    старых чатах кнопка тоже могла остаться — должна продолжать работать."""
    chat_id = (cb.get("message") or {}).get("chat", {}).get("id")
    from_user = cb.get("from") or {}
    tg_id = from_user.get("id", chat_id)
    if chat_id is None:
        return
    await _answer_callback(client, cb["id"])
    await _await_question(client, chat_id, tg_id)


async def _handle_change_password(client: httpx.AsyncClient, session: AsyncSession, cb: dict[str, Any]) -> None:
    chat_id = (cb.get("message") or {}).get("chat", {}).get("id")
    from_user = cb.get("from") or {}
    tg_id = from_user.get("id", chat_id)
    if chat_id is None:
        return
    app = await _find_application(session, tg_id)
    if app is None or app.status != STATUS_CONFIRMED or app.user_id is None:
        await _answer_callback(client, cb["id"], "Доступно только после зачисления", alert=True)
        return
    if not await _rate_ok(tg_id):
        await _answer_callback(client, cb["id"], "Слишком много запросов, попробуй позже", alert=True)
        return
    await _answer_callback(client, cb["id"])

    password = generate_one_time_password()
    user = await session.get(User, app.user_id)
    if user is None:
        return
    user.password_hash = hash_password(password)
    user.must_change_password = True
    await session.flush()

    await _send(
        client, chat_id,
        f"✅ Новый пароль\n\n"
        f"🔗 Ссылка: {PLATFORM_URL}\n"
        f"👤 Логин: <code>{html.escape(user.username)}</code>\n"
        f"🔑 Пароль: <code>{html.escape(password)}</code>\n\n"
        f"При входе система попросит сменить пароль.",
        reply_markup=_service_keyboard(),
    )
    await _log_action(client, f"{_user_tag(app.tg_username, tg_id)} сменил пароль (сервисный режим)")


async def _handle_callback(client: httpx.AsyncClient, session: AsyncSession, cb: dict[str, Any]) -> None:
    data = cb.get("data") or ""
    if data.startswith("acc:"):
        await _handle_accept(client, session, cb)
    elif data.startswith("pd:"):
        await _handle_plan_details(client, session, cb)
    elif data.startswith("pl:"):
        await _handle_plan_list(client, session, cb)
    elif data.startswith("pc:"):
        await _handle_plan_choose(client, session, cb)
    elif data.startswith("of:"):
        await _handle_offer_accept(client, session, cb)
    elif data.startswith("pay:"):
        await _handle_confirm_payment(client, session, cb)
    elif data == CB_ASK_QUESTION:
        await _handle_ask_question(client, cb)
    elif data == CB_CHANGE_PASSWORD:
        await _handle_change_password(client, session, cb)
    else:
        await _answer_callback(client, cb["id"])


# --- Вопрос в поддержку (доступно на любом шаге) ------------------------------


async def _forward_question(
    client: httpx.AsyncClient,
    session: AsyncSession,
    chat_id: int,
    tg_id: int,
    tg_username: str | None,
    question: str,
) -> None:
    await redis_client.delete(f"intakebot:await_q:{tg_id}")

    if ADMIN_CHAT_ID is None:
        await _send(client, chat_id, "Вопрос принят, но канал поддержки временно не настроен.")
        return

    app = await _find_application(session, tg_id)
    plan_label = "тариф ещё не выбран"
    if app is not None and app.plan_id is not None:
        plan = await session.get(Plan, app.plan_id)
        if plan is not None:
            plan_label = f"тариф: {plan.name} — {_price_str(plan.price)}"

    tag = _user_tag(tg_username, tg_id)
    question_text = (
        f"💬 <b>Вопрос от {html.escape(tag)}</b> ({html.escape(plan_label)})\n\n"
        f"{html.escape(question)}\n\n"
        f"<i>Ответь reply на это сообщение — бот доставит ответ.</i>"
    )
    sent = await _send(client, ADMIN_CHAT_ID, question_text)
    if sent is not None:
        # JSON, а не голый chat_id: чтобы при доставке ответа отметить это же
        # сообщение «✅ Отвечено» вместо отдельного сообщения-эха в чат.
        await redis_client.set(
            f"intakebot:qmap:{sent['message_id']}",
            json.dumps({"chat_id": chat_id, "text": question_text}),
            ex=QMAP_TTL_SEC,
        )

    await _send(client, chat_id, TEXT_QUESTION_SENT)
    print(f"[action] {tag} задал вопрос (воронка приёма)", flush=True)


async def _deliver_admin_reply(client: httpx.AsyncClient, reply_to_msg_id: int, answer: str) -> None:
    raw = await redis_client.get(f"intakebot:qmap:{reply_to_msg_id}")
    if raw is None:
        await _send(
            client, ADMIN_CHAT_ID,  # type: ignore[arg-type]
            "⚠️ Не нашёл, кому доставить этот ответ (вопрос устарел или это не reply на пересланный вопрос).",
        )
        return

    original_text: str | None = None
    try:
        data = json.loads(raw)
        asker_chat_id = int(data["chat_id"])
        original_text = data.get("text")
    except (ValueError, KeyError, TypeError):
        # Ключ старого формата (голый chat_id) — вопрос отправлен до этого релиза,
        # текста для edit-in-place у нас нет, фолбэк на прежнее поведение.
        asker_chat_id = int(raw)

    await _send(client, asker_chat_id, f"💬 <b>Ответ поддержки</b>\n\n{html.escape(answer)}")

    if original_text is not None:
        await _edit_text(
            client, ADMIN_CHAT_ID, reply_to_msg_id,  # type: ignore[arg-type]
            f"{original_text}\n\n✅ <b>Отвечено</b>",
        )
    else:
        await _send(client, ADMIN_CHAT_ID, "✅ Ответ доставлен участнику.")  # type: ignore[arg-type]


# --- /reset: сброс прогона воронки (ARG-95) -----------------------------------


def _reset_actor() -> User:
    """«От чьего имени» вызывается admin-хендлер `delete_user`.

    У бота нет учётки на платформе, а `delete_user` использует actor'а ровно для
    одной проверки — «не удаляй сам себя». Транзиентный объект с несуществующим id
    (BIGSERIAL начинается с 1) её проходит и в сессию не попадает.
    """
    return User(id=0)


async def _find_application_by_username(
    session: AsyncSession, username: str
) -> IntakeApplication | None:
    return (
        await session.execute(
            select(IntakeApplication).where(
                func.lower(IntakeApplication.tg_username) == username.lower()
            )
        )
    ).scalars().first()


async def _reset_application(
    session: AsyncSession, app: IntakeApplication
) -> tuple[str, str | None]:
    """Удалить заявку и созданного ей пользователя. Возвращает (статус, логин|None).

    Порядок обязателен: сначала заявка, потом пользователь — `intake_applications.user_id`
    ссылается на `users.id` без ON DELETE, обратный порядок упрётся в FK.
    """
    status = app.status
    user_id = app.user_id
    tg_id = app.tg_id

    username: str | None = None
    if user_id is not None:
        user = await session.get(User, user_id)
        username = user.username if user is not None else None

    await session.delete(app)
    await session.flush()

    if user_id is not None and username is not None:
        await delete_user(user_id, _reset_actor(), session)

    await redis_client.delete(f"intakebot:await_q:{tg_id}")
    await redis_client.delete(f"intakebot:pwd:{tg_id}")
    return status, username


async def _handle_reset(
    client: httpx.AsyncClient, session: AsyncSession, chat_id: int, text: str, tg_id: int
) -> None:
    """Служебная команда админского DM: снести прогон, чтобы пройти воронку заново.

    В `setMyCommands` намеренно не попадает — участнику её в меню видеть незачем.
    Из любого другого чата не делает и не отвечает ничего.
    """
    if ADMIN_CHAT_ID is None or chat_id != ADMIN_CHAT_ID:
        return
    if not ALLOW_RESET:
        await _send(client, chat_id, TEXT_RESET_DISABLED)
        return

    parts = text.split()
    target = parts[1].lstrip("@") if len(parts) > 1 else None
    if len(parts) > 2 or (target is not None and not target):
        await _send(client, chat_id, TEXT_RESET_USAGE)
        return

    if target is None:
        app = await _find_application(session, tg_id)
        who = "для этого чата"
    else:
        app = await _find_application_by_username(session, target)
        who = f"для @{html.escape(target)}"

    if app is None:
        await _send(client, chat_id, f"Заявки {who} не найдено — сбрасывать нечего.")
        return

    tag = _user_tag(app.tg_username, app.tg_id)
    try:
        status, username = await _reset_application(session, app)
    except HTTPException as exc:
        await session.rollback()
        await _send(
            client, chat_id,
            f"⚠️ Не удалось сбросить {html.escape(tag)}: {html.escape(str(exc.detail))}",
        )
        return

    user_line = (
        f"пользователь платформы <code>{html.escape(username)}</code> удалён"
        if username
        else "пользователь платформы не создавался"
    )
    await _send(
        client, chat_id,
        f"🧹 Сброшено: заявка {html.escape(tag)} (статус <code>{html.escape(status)}</code>), "
        f"{user_line}. Redis-состояние очищено — можно проходить воронку заново.",
    )


# --- /confirm: подтвердить оплату вручную, без чека -----------------------------


async def _handle_confirm_command(
    client: httpx.AsyncClient, session: AsyncSession, chat_id: int, text: str
) -> None:
    """Ручное подтверждение оплаты — админ увидел зачисление другим путём (выписка,

    Tribute без скрина, платёж из-за рубежа), а участник чек так и не прислал.
    В отличие от `/reset`, работает на любом окружении, включая прод — это штатная
    эксплуатационная потребность, не дев-утилита.
    """
    if ADMIN_CHAT_ID is None or chat_id != ADMIN_CHAT_ID:
        return

    parts = text.split()
    target = parts[1].lstrip("@") if len(parts) > 1 else None
    if len(parts) != 2 or not target:
        await _send(client, chat_id, TEXT_CONFIRM_USAGE)
        return

    app = await _find_application_by_username(session, target)
    if app is None:
        await _send(client, chat_id, f"Заявки для @{html.escape(target)} не найдено.")
        return
    if app.status == STATUS_CONFIRMED:
        await _send(client, chat_id, f"Заявка @{html.escape(target)} уже подтверждена.")
        return
    if app.plan_id is None:
        await _send(
            client, chat_id,
            f"У @{html.escape(target)} ещё не выбран тариф — нечего подтверждать.",
        )
        return

    try:
        created = await _finalize_payment(client, session, app, manual=True)
    except HTTPException as exc:
        await session.rollback()
        await _send(client, chat_id, f"⚠️ Не удалось подтвердить: {html.escape(str(exc.detail))}")
        return
    if created is None:
        # tg_username гарантированно есть — нашли заявку именно по нему; значит
        # причина — нет активного набора (см. `_create_platform_user`).
        await _send(
            client, chat_id,
            "⚠️ Нет активного набора (таблица intakes пуста) — не могу завести аккаунт.",
        )
        return

    username, _password = created
    await _send(
        client, chat_id,
        f"✅ Заявка #{app.id} (@{html.escape(target)}) подтверждена вручную (без чека), "
        f"создан пользователь <code>{html.escape(username)}</code>.",
    )


# --- /info: статус бота (админский DM) -----------------------------------------


async def _handle_info(client: httpx.AsyncClient, session: AsyncSession, chat_id: int) -> None:
    """Служебная команда админского DM: к какому набору привязан бот, какие тарифы
    отдаёт и какие реквизиты уходят в TEXT_ACCEPTED. В `BOT_COMMANDS` не попадает —
    видна только в меню самого админского чата (см. `_setup_bot_menu`).
    """
    if ADMIN_CHAT_ID is None or chat_id != ADMIN_CHAT_ID:
        return

    intake = await _current_intake(session)
    if intake is None:
        intake_line = "⚠️ Активного набора нет (таблица intakes пуста) — заявки не смогут получить аккаунт."
    else:
        intake_line = (
            f"📅 Набор: <b>{intake.starts_on:%d.%m.%Y}</b> — {intake.ends_on:%d.%m.%Y} "
            f"(id {intake.id})"
        )

    plans = await _active_plans(session)
    if plans:
        plans_lines = "\n".join(
            f"• {html.escape(plan.name)} — {_price_str(plan.price)}" for plan in plans
        )
    else:
        plans_lines = "⚠️ Активных тарифов нет — на «Выбери тариф» список будет пуст."

    booked = list(
        (
            await session.execute(
                select(IntakeApplication)
                .where(
                    IntakeApplication.status.in_(STATUSES_ON_PAYMENT_CLOCK),
                    IntakeApplication.payment_deadline_at.is_not(None),
                )
                .order_by(IntakeApplication.payment_deadline_at)
                .limit(10)
            )
        )
        .scalars()
        .all()
    )
    booked_lines = "\n".join(
        f"• {html.escape(_user_tag(app.tg_username, app.tg_id))} — до {_deadline_str(deadline)}"
        for app in booked
        if (deadline := app.payment_deadline_at) is not None
    ) or "— никого"

    await _send(
        client, chat_id,
        f"ℹ️ <b>Статус бота</b>\n\n"
        f"{intake_line}\n\n"
        f"💳 Тарифы:\n{plans_lines}\n\n"
        f"🏦 Реквизиты: {html.escape(PAYMENT_DETAILS)}\n\n"
        f"⏳ Окно оплаты: {PAYMENT_WINDOW_HOURS:g} ч\n"
        f"Брони в силе:\n{booked_lines}",
    )


# --- Сообщения -----------------------------------------------------------------


async def _handle_start(
    client: httpx.AsyncClient, session: AsyncSession, chat_id: int, from_user: dict[str, Any]
) -> None:
    tg_id = from_user.get("id", chat_id)
    tg_username = from_user.get("username")
    await redis_client.delete(f"intakebot:await_q:{tg_id}")

    app = await _find_application(session, tg_id)
    if app is None:
        app = IntakeApplication(
            tg_id=tg_id,
            tg_username=tg_username,
            tg_first_name=from_user.get("first_name"),
            tg_last_name=from_user.get("last_name"),
        )
        session.add(app)
        await session.flush()
        await _send(client, chat_id, TEXT_START)
        return

    # Обновляем TG-профиль на случай смены ника/имени между визитами.
    app.tg_username = tg_username
    app.tg_first_name = from_user.get("first_name")
    app.tg_last_name = from_user.get("last_name")
    await session.flush()

    # Гарантия цены могла истечь, пока участник молчал, а свип ещё не дошёл до
    # заявки. Отмечаем молча: TEXT_EXPIRED зовёт нажать /start, а он уже нажат —
    # вместо него человек сразу получает «заявка снова на рассмотрении».
    if _deadline_passed(app):
        await _mark_expired(session, app)

    if app.status == STATUS_AWAITING_ABOUT:
        await _send(client, chat_id, TEXT_START)
    elif app.status == STATUS_EXPIRED:
        await _resubmit_after_expiry(client, session, chat_id, app)
    elif app.status == STATUS_SUBMITTED:
        await _send(client, chat_id, TEXT_WAIT_DECISION)
    elif app.status == STATUS_CHOOSING_PLAN:
        await _send_plan_list(client, session, chat_id, app)
    elif app.status == STATUS_AWAITING_OFFER:
        await _send(client, chat_id, TEXT_OFFER_PROMPT, reply_markup=_offer_keyboard(app.id))
    elif app.status == STATUS_AWAITING_RECEIPT:
        await _send(client, chat_id, TEXT_NEED_RECEIPT)
    elif app.status == STATUS_PAYMENT_REVIEW:
        await _send(client, chat_id, TEXT_WAIT_PAYMENT_CHECK)
    elif app.status == STATUS_CONFIRMED:
        await _send(client, chat_id, TEXT_ALREADY_DONE, reply_markup=_service_keyboard())


async def _resubmit_after_expiry(
    client: httpx.AsyncClient, session: AsyncSession, chat_id: int, app: IntakeApplication
) -> None:
    """/start на сгоревшей заявке — заново к админу, а не сразу к тарифам (ARG-108).

    Строка та же (`tg_id` уникален): чистим выбор тарифа и согласие с офертой, но
    сохраняем анкету — админ видит её в карточке «повторная заявка».
    """
    if not app.about:  # сгореть без анкеты нельзя, но и падать на этом незачем
        app.status = STATUS_AWAITING_ABOUT
        await session.flush()
        await _send(client, chat_id, TEXT_START)
        return
    app.status = STATUS_SUBMITTED
    app.submitted_at = datetime.now(UTC)  # ARG-107: re-entering submitted resets the clock
    app.payment_deadline_at = None
    app.expired_at = None
    app.plan_id = None
    app.offer_accepted_at = None
    app.offer_version = None
    await session.flush()
    await _send(client, chat_id, TEXT_RESUBMITTED)
    await _send_anketa_to_admin(client, app, repeat=True)


def _should_handle_message(message: dict[str, Any]) -> bool:
    """Гейт диспетчера: приватный чат заявителя ИЛИ сконфигурированный admin-чат.

    Раньше пропускался только `chat.type == "private"` — если ADMIN_CHAT_ID
    настроен на группу/супергруппу (а не личку админа, как в докe), реплаи
    админа там никогда не доходили до `_handle_message`: ни ответ на пересланный
    вопрос, ни /reset, ни /info не срабатывали, без единой ошибки в логах.
    """
    chat = message.get("chat", {})
    return bool(chat.get("type") == "private" or chat.get("id") == ADMIN_CHAT_ID)


async def _handle_message(client: httpx.AsyncClient, session: AsyncSession, message: dict[str, Any]) -> None:
    chat_id = message["chat"]["id"]
    text = (message.get("text") or "").strip()
    from_user = message.get("from") or {}
    tg_id = from_user.get("id", chat_id)
    tg_username = from_user.get("username")

    # Служебные команды админского чата — раньше ветки ответа админа: обе могут
    # прийти и реплаем, и это всё равно команда, а не ответ участнику.
    if text.startswith("/reset"):
        await _handle_reset(client, session, chat_id, text, tg_id)
        return
    if text.startswith("/info"):
        await _handle_info(client, session, chat_id)
        return
    if text.startswith("/confirm"):
        await _handle_confirm_command(client, session, chat_id, text)
        return

    # Ответ админа reply на пересланный вопрос → доставить участнику.
    if ADMIN_CHAT_ID is not None and chat_id == ADMIN_CHAT_ID:
        reply_to = message.get("reply_to_message")
        if reply_to and text:
            await _deliver_admin_reply(client, reply_to["message_id"], text)
            return
        if message.get("chat", {}).get("type") != "private":
            # Групповой админ-чат (в отличие от личного DM админа, который
            # исторически мог им же тестироваться как заявитель — see docs/
            # INTAKE_BOT.md) — не пропускаем непонятные ей сообщения (обычную
            # переписку между админами) дальше, в логику воронки заявителя.
            return

    if text.startswith("/start"):
        await _handle_start(client, session, chat_id, from_user)
        return

    # «Задать вопрос» — командой/кнопкой меню бота, доступна на любом шаге воронки.
    if text.startswith("/question"):
        await _await_question(client, chat_id, tg_id)
        return

    # «Задать вопрос» работает на любом шаге воронки, приоритет выше состояния анкеты.
    if text and await redis_client.get(f"intakebot:await_q:{tg_id}"):
        await _forward_question(client, session, chat_id, tg_id, tg_username, text)
        return

    app = await _find_application(session, tg_id)
    if app is None:
        await _send(client, chat_id, TEXT_NEED_START)
        return

    # Одна точка на все шаги: чек, присланный после дедлайна, тоже опоздал.
    if _deadline_passed(app):
        await _expire_now(client, session, app)
        return

    photo = message.get("photo")
    document = message.get("document")

    if app.status == STATUS_AWAITING_ABOUT:
        if text:
            await _handle_about(client, session, chat_id, app, text)
        else:
            await _send(client, chat_id, TEXT_ASK_ABOUT)
        return

    if app.status == STATUS_AWAITING_RECEIPT and (photo or document):
        if photo:
            file_id = photo[-1]["file_id"]  # последний элемент — самое крупное фото
            await _handle_receipt(client, session, chat_id, app, file_id, "photo")
        else:
            await _handle_receipt(client, session, chat_id, app, document["file_id"], "document")
        return

    if app.status == STATUS_CONFIRMED:
        await _send(client, chat_id, TEXT_SERVICE_MENU, reply_markup=_service_keyboard())
        return

    await _status_reminder(client, chat_id, app)


BOT_COMMANDS = [
    {"command": "start", "description": "Начать или продолжить заявку"},
    {"command": "question", "description": "Задать вопрос поддержке"},
]
# /info поверх общего списка — только в scope этого чата (BotCommandScopeChat), поэтому
# участникам в их собственных чатах не видна, а админу открывается прямо в меню-кнопке,
# без /reset (тот и так спрятан за INTAKE_BOT_ALLOW_RESET и не нужен в UI).
ADMIN_COMMANDS = [
    *BOT_COMMANDS,
    {"command": "info", "description": "Набор, тарифы, реквизиты"},
    {"command": "confirm", "description": "Подтвердить оплату вручную (без чека)"},
]


async def _setup_bot_menu(client: httpx.AsyncClient) -> None:
    """Команды бота + кнопка меню: «Задать вопрос» доступна на любом шаге воронки,
    не занимая ряд в каждой инлайн-клавиатуре (ARG-94). Настраивается кодом при
    старте сервиса, а не руками в BotFather."""
    await _api_call(client, "setMyCommands", {"commands": BOT_COMMANDS})
    await _api_call(client, "setChatMenuButton", {"menu_button": {"type": "commands"}})
    if ADMIN_CHAT_ID is not None:
        await _api_call(
            client, "setMyCommands",
            {
                "commands": ADMIN_COMMANDS,
                "scope": {"type": "chat", "chat_id": ADMIN_CHAT_ID},
            },
        )


async def main() -> None:
    if not BOT_TOKEN:
        raise SystemExit("TELEGRAM_INTAKE_BOT_TOKEN не задан")

    print(
        f"Intake bot started. Platform URL: {PLATFORM_URL}. Proxy: {TELEGRAM_PROXY or 'none'}. "
        f"Admin chat: {ADMIN_CHAT_ID if ADMIN_CHAT_ID is not None else 'not set'}. "
        f"Payment window: {PAYMENT_WINDOW_HOURS:g}h",
        flush=True,
    )
    async with httpx.AsyncClient(timeout=40, proxy=TELEGRAM_PROXY) as client:
        await _setup_bot_menu(client)
        # Два независимых цикла: апдейты от Telegram и часы брони (ARG-108).
        await asyncio.gather(_poll_loop(client), _expire_sweep_loop(client))


async def _poll_loop(client: httpx.AsyncClient) -> None:
    offset = 0
    while True:
        try:
            resp = await client.get(
                f"{API}/getUpdates", params={"offset": offset, "timeout": 30}
            )
            updates = resp.json().get("result", [])
        except (httpx.HTTPError, ValueError) as exc:  # noqa: BLE001
            print(f"getUpdates failed: {type(exc).__name__}: {exc!r}", flush=True)
            await asyncio.sleep(3)
            continue

        for upd in updates:
            offset = upd["update_id"] + 1
            try:
                async with SessionLocal() as session:
                    if "callback_query" in upd:
                        await _handle_callback(client, session, upd["callback_query"])
                    else:
                        message = upd.get("message") or upd.get("edited_message")
                        if message and _should_handle_message(message):
                            await _handle_message(client, session, message)
                    await session.commit()
            except Exception as exc:  # noqa: BLE001 — один сбой не роняет бота
                print(f"handle update error: {type(exc).__name__}: {exc!r}", flush=True)


if __name__ == "__main__":
    asyncio.run(main())
