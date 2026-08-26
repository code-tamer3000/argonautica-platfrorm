"""Бот приёма: экран выбора тарифа (ARG-94) и служебный /reset (ARG-95).

Бот — не HTTP-приложение, поэтому Telegram-транспорт подменён фейком (записывает
вызовы Bot API), а Postgres — настоящий: статусы заявки проверяем в БД.
"""
import importlib.util
import json
import random
import sys
from datetime import UTC, date, datetime, timedelta
from pathlib import Path
from types import ModuleType
from typing import Any

from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

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
    IntakeApplication,
)
from app.models.plan import Plan
from app.models.user import User

from .conftest import MakeUser, get_or_create_intake


def _load_bot() -> ModuleType:
    """Скрипт лежит в `scripts/` (не пакет `app`) — подгружаем по пути, как в
    test_backfill_media_derivatives."""
    path = Path(__file__).resolve().parent.parent / "scripts" / "intake_bot.py"
    spec = importlib.util.spec_from_file_location("intake_bot", path)
    assert spec is not None and spec.loader is not None
    module = importlib.util.module_from_spec(spec)
    sys.modules[spec.name] = module
    spec.loader.exec_module(module)
    return module


intake_bot = _load_bot()


class FakeResponse:
    def __init__(self, body: dict[str, Any]) -> None:
        self._body = body

    def json(self) -> dict[str, Any]:
        return self._body


class FakeClient:
    """Минимальный httpx-совместимый клиент: пишет (метод, payload) в calls."""

    def __init__(self, ok: bool = True, description: str = "") -> None:
        self.calls: list[tuple[str, dict[str, Any]]] = []
        self._ok = ok
        self._description = description

    async def post(self, url: str, json: dict[str, Any]) -> FakeResponse:
        method = url.rsplit("/", 1)[-1]
        self.calls.append((method, json))
        if self._ok:
            return FakeResponse({"ok": True, "result": {"message_id": 777}})
        return FakeResponse({"ok": False, "description": self._description})

    def methods(self) -> list[str]:
        return [method for method, _ in self.calls]

    def payload(self, method: str) -> dict[str, Any]:
        return next(payload for name, payload in self.calls if name == method)


async def make_plan(
    session: AsyncSession, name: str, price: int, description: str = "что входит"
) -> Plan:
    plan = Plan(name=name, price=price, description=description)
    session.add(plan)
    await session.commit()
    await session.refresh(plan)
    return plan


async def make_application(
    session: AsyncSession, status: str = STATUS_CHOOSING_PLAN
) -> IntakeApplication:
    app = IntakeApplication(
        tg_id=random.randint(10**9, 10**12),
        # Диапазон настолько же широкий, как у tg_id — узкий (1000-9999) давал
        # реальные коллизии username между тестами: `_find_application_by_username`
        # без ORDER BY подхватывал произвольную из двух заявок с тем же именем.
        tg_username=f"u{random.randint(10**8, 10**9 - 1)}",
        status=status,
    )
    session.add(app)
    await session.commit()
    await session.refresh(app)
    return app


def callback(app: IntakeApplication, data: str, message_id: int = 42) -> dict[str, Any]:
    return {
        "id": "cb1",
        "data": data,
        "from": {"id": app.tg_id},
        "message": {"message_id": message_id, "chat": {"id": app.tg_id}},
    }


def test_plans_keyboard_has_one_button_per_plan() -> None:
    plans = [
        Plan(id=1, name="Вода", price=12000, description="d"),
        Plan(id=2, name="Огонь", price=9000, description="d"),
    ]
    rows = intake_bot._plans_keyboard(7, plans)["inline_keyboard"]

    assert [len(row) for row in rows] == [1, 1]
    assert rows[0][0] == {"text": "Вода — 12 000 ₽", "callback_data": "pd:7:1"}
    flat = [button for row in rows for button in row]
    assert all(b["callback_data"].startswith("pd:") for b in flat)
    assert intake_bot.CB_ASK_QUESTION not in [b["callback_data"] for b in flat]


def test_plan_details_keyboard_is_back_plus_styled_pay() -> None:
    rows = intake_bot._plan_details_keyboard(7, 2)["inline_keyboard"]

    assert len(rows) == 1 and len(rows[0]) == 2
    back, pay = rows[0]
    assert back["callback_data"] == "pl:7" and "style" not in back
    assert pay["callback_data"] == "pc:7:2" and pay["style"] == "success"


def test_service_keyboard_has_no_ask_question_button() -> None:
    flat = [b for row in intake_bot._service_keyboard()["inline_keyboard"] for b in row]
    assert [b["callback_data"] for b in flat] == [intake_bot.CB_CHANGE_PASSWORD]


async def test_details_and_back_edit_the_same_message(session: AsyncSession) -> None:
    app = await make_application(session)
    plan = await make_plan(session, "Земля", 15000, "28 дней в поле")
    client = FakeClient()

    await intake_bot._handle_plan_details(client, session, callback(app, f"pd:{app.id}:{plan.id}"))

    assert "sendMessage" not in client.methods()
    edit = client.payload("editMessageText")
    assert edit["message_id"] == 42
    assert "28 дней в поле" in edit["text"] and "15 000 ₽" in edit["text"]
    assert edit["reply_markup"] == intake_bot._plan_details_keyboard(app.id, plan.id)

    client = FakeClient()
    await intake_bot._handle_plan_list(client, session, callback(app, f"pl:{app.id}"))

    assert "sendMessage" not in client.methods()
    back = client.payload("editMessageText")
    assert back["message_id"] == 42
    assert back["text"] == intake_bot.TEXT_PLAN_LIST


async def test_edit_falls_back_to_new_message(session: AsyncSession) -> None:
    """Сообщение-экран удалили — editMessageText падает, участник видит новый экран."""
    app = await make_application(session)
    await make_plan(session, "Воздух", 7000)
    client = FakeClient(ok=False, description="Bad Request: message to edit not found")

    await intake_bot._send_plan_list(client, session, app.tg_id, app, message_id=42)

    assert client.methods() == ["editMessageText", "sendMessage"]


async def test_choose_plan_moves_to_awaiting_offer(session: AsyncSession) -> None:
    """Выбор тарифа больше не открывает реквизиты напрямую (ARG-43) — сперва
    экран согласия с офертой."""
    app = await make_application(session)
    plan = await make_plan(session, "Вода", 12000)
    client = FakeClient()

    await intake_bot._handle_plan_choose(client, session, callback(app, f"pc:{app.id}:{plan.id}"))
    await session.commit()
    await session.refresh(app)

    assert app.status == STATUS_AWAITING_OFFER
    assert app.plan_id == plan.id
    assert app.offer_accepted_at is None
    sent = client.payload("sendMessage")
    assert sent["text"] == intake_bot.TEXT_OFFER_PROMPT
    assert "12 000" not in sent["text"]  # реквизиты ещё не раскрыты
    buttons = [b for row in sent["reply_markup"]["inline_keyboard"] for b in row]
    assert any(b.get("web_app", {}).get("url", "").endswith("/oferta") for b in buttons)
    assert any(b.get("callback_data") == f"of:{app.id}" for b in buttons)


async def test_offer_accept_records_consent_and_reveals_payment(session: AsyncSession) -> None:
    app = await make_application(session, status=STATUS_AWAITING_OFFER)
    plan = await make_plan(session, "Вода", 12000)
    app.plan_id = plan.id
    await session.commit()
    client = FakeClient()

    await intake_bot._handle_offer_accept(client, session, callback(app, f"of:{app.id}"))
    await session.commit()
    await session.refresh(app)

    assert app.status == STATUS_AWAITING_RECEIPT
    assert app.offer_accepted_at is not None
    assert app.offer_version == intake_bot.OFFER_VERSION
    payload = client.payload("sendMessage")
    assert "12 000 ₽" in payload["text"]
    buttons = [b for row in payload["reply_markup"]["inline_keyboard"] for b in row]
    assert any(b.get("callback_data") == intake_bot.CB_ASK_QUESTION for b in buttons)
    assert any(b.get("url") == intake_bot.TRIBUTE_PAYMENT_URL for b in buttons)


async def test_offer_accept_on_stale_screen_does_not_reveal_payment(
    session: AsyncSession,
) -> None:
    app = await make_application(session, status=STATUS_PAYMENT_REVIEW)
    client = FakeClient()

    await intake_bot._handle_offer_accept(client, session, callback(app, f"of:{app.id}"))
    await session.commit()
    await session.refresh(app)

    assert app.status == STATUS_PAYMENT_REVIEW
    assert app.offer_accepted_at is None
    assert client.methods() == ["answerCallbackQuery"]


async def test_stale_screen_does_not_change_data_and_alerts(session: AsyncSession) -> None:
    """Заявку увели дальше по воронке — старая кнопка экрана только алертит."""
    app = await make_application(session, status=STATUS_PAYMENT_REVIEW)
    plan = await make_plan(session, "Огонь", 9000)
    client = FakeClient()

    await intake_bot._handle_plan_choose(client, session, callback(app, f"pc:{app.id}:{plan.id}"))
    await session.commit()
    await session.refresh(app)

    assert app.status == STATUS_PAYMENT_REVIEW
    assert app.plan_id is None
    assert client.methods() == ["answerCallbackQuery"]
    answer = client.payload("answerCallbackQuery")
    assert answer["show_alert"] is True
    assert answer["text"] == intake_bot.TEXT_STEP_DONE


async def test_question_command_sets_redis_flag(session: AsyncSession) -> None:
    app = await make_application(session)
    client = FakeClient()
    key = f"intakebot:await_q:{app.tg_id}"
    await intake_bot.redis_client.delete(key)

    await intake_bot._handle_message(
        client, session,
        {"chat": {"id": app.tg_id}, "text": "/question", "from": {"id": app.tg_id}},
    )

    assert await intake_bot.redis_client.get(key) is not None
    assert client.payload("sendMessage")["text"] == intake_bot.TEXT_ASK_QUESTION_PROMPT
    await intake_bot.redis_client.delete(key)


async def test_button_styles_are_dropped_when_api_rejects_them(session: AsyncSession) -> None:
    """Bot API без поддержки стилей не должен ломать экран оплаты — стиль снимается."""
    intake_bot._button_styles_supported = True
    try:
        client = FakeClient(ok=False, description='Bad Request: unknown field "style"')
        await intake_bot._send(
            client, 1, "текст", reply_markup=intake_bot._plan_details_keyboard(1, 2)
        )

        assert intake_bot._button_styles_supported is False
        retried = client.calls[-1][1]["reply_markup"]["inline_keyboard"][0]
        assert all("style" not in button for button in retried)
    finally:
        intake_bot._button_styles_supported = True


async def test_funnel_run_keeps_plan_screen_in_one_message(
    session: AsyncSession, monkeypatch: Any
) -> None:
    """Прогон участка воронки анкета → тарифы → оплата: экран тарифов остаётся
    одним сообщением, застреваний нет (ARG-94, «Как проверить» п.2 — офлайн-часть)."""
    admin_chat = 999_001
    monkeypatch.setattr(intake_bot, "ADMIN_CHAT_ID", admin_chat)
    plan = await make_plan(session, "Вода", 12000, "что входит в тариф")
    tg_id = random.randint(10**9, 10**12)
    client = FakeClient()

    await intake_bot._handle_message(
        client, session,
        {"chat": {"id": tg_id}, "text": "/start", "from": {"id": tg_id, "username": "arg"}},
    )
    await intake_bot._handle_message(
        client, session,
        {
            "chat": {"id": tg_id},
            "text": "кто я и куда иду",
            "from": {"id": tg_id, "username": "arg"},
        },
    )
    await session.commit()
    app = await intake_bot._find_application(session, tg_id)
    assert app is not None and app.status == "submitted"

    # Админ принимает заявку из своего DM → участнику приходит экран тарифов.
    await intake_bot._handle_accept(
        client, session,
        {
            "id": "cb",
            "data": f"acc:{app.id}",
            "message": {"message_id": 5, "chat": {"id": admin_chat}},
        },
    )
    await session.commit()
    await session.refresh(app)
    assert app.status == STATUS_CHOOSING_PLAN

    screen_id = 42
    client = FakeClient()
    details = callback(app, f"pd:{app.id}:{plan.id}", screen_id)
    await intake_bot._handle_plan_details(client, session, details)
    await intake_bot._handle_plan_list(client, session, callback(app, f"pl:{app.id}", screen_id))
    await intake_bot._handle_plan_details(client, session, details)

    # Ни одного нового сообщения в чате — только перерисовка того же экрана.
    assert set(client.methods()) == {"answerCallbackQuery", "editMessageText"}
    edited = [payload for m, payload in client.calls if m == "editMessageText"]
    assert {payload["message_id"] for payload in edited} == {screen_id}

    await intake_bot._handle_plan_choose(
        client, session, callback(app, f"pc:{app.id}:{plan.id}", screen_id)
    )
    await session.commit()
    await session.refresh(app)
    assert app.status == STATUS_AWAITING_OFFER

    # Согласие с офертой (ARG-43) — без него бот не откроет шаг присылки чека.
    await intake_bot._handle_offer_accept(client, session, callback(app, f"of:{app.id}"))
    await session.commit()
    await session.refresh(app)
    assert app.status == STATUS_AWAITING_RECEIPT

    await intake_bot._handle_message(
        client, session,
        {
            "chat": {"id": tg_id},
            "from": {"id": tg_id, "username": "arg"},
            "document": {"file_id": "receipt-1"},
        },
    )
    await session.commit()
    await session.refresh(app)
    assert app.status == STATUS_PAYMENT_REVIEW
    assert app.plan_id == plan.id and app.receipt_file_id == "receipt-1"


# --- приветственные задания набора (provision_second_intake.py) --------------


async def test_new_user_is_assigned_intake_welcome_tasks(
    session: AsyncSession, make_user: MakeUser
) -> None:
    """Individual-задание с tasks.intake_id набора, заведённое provisioning-скриптом
    заранее с пустым списком получателей, назначается новичку в момент регистрации."""
    from app.models.task import Task, TaskAssignment

    admin = await make_user(role="admin")

    # Тестовая БД переживает прогоны, intakes.starts_on UNIQUE — берём дату строго
    # позже текущего максимума (тот же приём, что test_admin_intakes.py::free_starts_on),
    # иначе _current_intake (max starts_on = «активный» набор) подхватит чужой,
    # более поздний набор, оставшийся от другого теста.
    current_max = await session.scalar(select(func.max(Intake.starts_on)))
    starts_on = (current_max or date.today()) + timedelta(days=1)
    other_starts_on = starts_on - timedelta(days=1000)
    intake = await get_or_create_intake(session, starts_on)
    other_intake = await get_or_create_intake(session, other_starts_on)

    welcome = Task(
        type="individual", title="Придумай себе имя аргонавта",
        created_by=admin.id, intake_id=intake.id, sets_display_name=True,
    )
    other_stream_task = Task(
        type="individual", title="Чужой поток", created_by=admin.id, intake_id=other_intake.id,
    )
    session.add_all([welcome, other_stream_task])
    await session.commit()

    plan = await make_plan(session, f"Вода-{random.randint(100, 999)}", 12000)
    app = await make_application(session, status=STATUS_CHOOSING_PLAN)
    app.plan_id = plan.id
    session.add(app)
    await session.flush()

    created = await intake_bot._create_platform_user(session, app)
    await session.commit()
    assert created is not None
    user = await session.scalar(select(User).where(User.username == created[0]))
    assert user is not None

    assigned_task_ids = set(
        (
            await session.execute(
                select(TaskAssignment.task_id).where(TaskAssignment.user_id == user.id)
            )
        ).scalars().all()
    )
    assert welcome.id in assigned_task_ids
    assert other_stream_task.id not in assigned_task_ids


# --- /reset: сброс прогона воронки (ARG-95) -----------------------------------


async def make_confirmed_application(session: AsyncSession) -> IntakeApplication:
    """Заявка в `confirmed` с реально созданным пользователем платформы."""
    await get_or_create_intake(session, date(2026, 3, 1))
    plan = await make_plan(session, f"Вода-{random.randint(100, 999)}", 12000)
    app = await make_application(session, status=STATUS_CHOOSING_PLAN)
    app.plan_id = plan.id
    created = await intake_bot._create_platform_user(session, app)
    assert created is not None
    app.status = STATUS_CONFIRMED
    await session.commit()
    return app


async def test_confirm_payment_links_application_to_created_user(
    session: AsyncSession, monkeypatch: Any
) -> None:
    """`intake_applications.user_id` должен указывать на созданного юзера сразу
    после подтверждения оплаты — на нём держится /reset (см. `_reset_application`,
    без этой связи он не находит, кого удалять, и оставляет учётку сиротой)."""
    admin_chat = 999_006
    monkeypatch.setattr(intake_bot, "ADMIN_CHAT_ID", admin_chat)
    await get_or_create_intake(session, date(2026, 4, 1))
    plan = await make_plan(session, f"Вода-{random.randint(100, 999)}", 12000)
    app = await make_application(session, status=STATUS_PAYMENT_REVIEW)
    app.plan_id = plan.id
    await session.commit()
    client = FakeClient()

    await intake_bot._handle_confirm_payment(
        client, session,
        {"id": "cb", "data": f"pay:{app.id}", "message": {"chat": {"id": admin_chat}}},
    )
    await session.commit()
    await session.refresh(app)

    assert app.status == STATUS_CONFIRMED
    assert app.user_id is not None
    user = await session.get(User, app.user_id)
    assert user is not None and user.username == app.tg_username


def admin_message(text: str, chat_id: int, tg_id: int | None = None) -> dict[str, Any]:
    return {
        "chat": {"id": chat_id},
        "text": text,
        "from": {"id": tg_id if tg_id is not None else chat_id},
    }


async def test_reset_removes_application_user_and_redis_state(
    session: AsyncSession, monkeypatch: Any
) -> None:
    admin_chat = 999_002
    monkeypatch.setattr(intake_bot, "ADMIN_CHAT_ID", admin_chat)
    monkeypatch.setattr(intake_bot, "ALLOW_RESET", True)
    app = await make_confirmed_application(session)
    tg_id, username, user_id = app.tg_id, app.tg_username, app.user_id
    assert username is not None
    await intake_bot.redis_client.set(f"intakebot:await_q:{tg_id}", "1")
    await intake_bot.redis_client.set(f"intakebot:pwd:{tg_id}", "3")
    client = FakeClient()

    await intake_bot._handle_message(
        client, session, admin_message(f"/reset @{username}", admin_chat)
    )
    await session.commit()

    assert await intake_bot._find_application(session, tg_id) is None
    assert await session.get(User, user_id) is None
    assert await intake_bot.redis_client.get(f"intakebot:await_q:{tg_id}") is None
    assert await intake_bot.redis_client.get(f"intakebot:pwd:{tg_id}") is None
    reply = client.payload("sendMessage")["text"]
    assert username in reply and STATUS_CONFIRMED in reply

    # Тот же аккаунт проходит воронку заново — /start заводит новую заявку.
    await intake_bot._handle_message(
        client, session,
        {"chat": {"id": tg_id}, "text": "/start", "from": {"id": tg_id, "username": username}},
    )
    await session.commit()
    fresh = await intake_bot._find_application(session, tg_id)
    assert fresh is not None and fresh.status == STATUS_AWAITING_ABOUT


async def test_reset_without_argument_targets_own_application(
    session: AsyncSession, monkeypatch: Any
) -> None:
    """Без аргумента сбрасывается заявка самого админа, чужая не трогается."""
    app = await make_application(session)
    other = await make_application(session)
    monkeypatch.setattr(intake_bot, "ADMIN_CHAT_ID", app.tg_id)
    monkeypatch.setattr(intake_bot, "ALLOW_RESET", True)
    client = FakeClient()

    await intake_bot._handle_message(client, session, admin_message("/reset", app.tg_id))
    await session.commit()

    assert await intake_bot._find_application(session, app.tg_id) is None
    assert await intake_bot._find_application(session, other.tg_id) is not None


async def test_reset_from_participant_chat_does_nothing(
    session: AsyncSession, monkeypatch: Any
) -> None:
    app = await make_application(session)
    monkeypatch.setattr(intake_bot, "ADMIN_CHAT_ID", 999_003)
    monkeypatch.setattr(intake_bot, "ALLOW_RESET", True)
    client = FakeClient()

    await intake_bot._handle_message(client, session, admin_message("/reset", app.tg_id))
    await session.commit()

    assert await intake_bot._find_application(session, app.tg_id) is not None
    assert client.methods() == []


async def test_reset_is_refused_when_flag_is_off(
    session: AsyncSession, monkeypatch: Any
) -> None:
    admin_chat = 999_004
    app = await make_application(session)
    monkeypatch.setattr(intake_bot, "ADMIN_CHAT_ID", admin_chat)
    monkeypatch.setattr(intake_bot, "ALLOW_RESET", False)
    client = FakeClient()

    await intake_bot._handle_message(
        client, session, admin_message(f"/reset @{app.tg_username}", admin_chat)
    )
    await session.commit()

    assert await intake_bot._find_application(session, app.tg_id) is not None
    assert client.payload("sendMessage")["text"] == intake_bot.TEXT_RESET_DISABLED


async def test_reset_reports_missing_application(
    session: AsyncSession, monkeypatch: Any
) -> None:
    admin_chat = 999_005
    monkeypatch.setattr(intake_bot, "ADMIN_CHAT_ID", admin_chat)
    monkeypatch.setattr(intake_bot, "ALLOW_RESET", True)
    client = FakeClient()

    await intake_bot._handle_message(
        client, session, admin_message("/reset @no-such-user", admin_chat)
    )

    assert "не найдено" in client.payload("sendMessage")["text"]


def test_reset_is_not_in_bot_commands() -> None:
    assert "reset" not in [c["command"] for c in intake_bot.BOT_COMMANDS]


# --- /info: статус бота ---------------------------------------------------------


async def test_info_reports_intake_plans_and_payment_details(
    session: AsyncSession, monkeypatch: Any
) -> None:
    admin_chat = 999_006
    monkeypatch.setattr(intake_bot, "ADMIN_CHAT_ID", admin_chat)
    # Далёкая дата — гарантированно max(starts_on) среди всех intakes, которые уже
    # насажали другие тесты в общую (не откатываемую между тестами) БД.
    intake = await get_or_create_intake(session, date(2099, 1, 1))
    plan = await make_plan(session, f"Огонь-{random.randint(100, 999)}", 15000)
    inactive = await make_plan(session, f"Скрытый-{random.randint(100, 999)}", 5000)
    inactive.is_active = False
    await session.commit()
    client = FakeClient()

    await intake_bot._handle_message(client, session, admin_message("/info", admin_chat))

    reply = client.payload("sendMessage")["text"]
    assert f"{intake.starts_on:%d.%m.%Y}" in reply
    assert plan.name in reply and "15 000 ₽" in reply
    assert inactive.name not in reply
    assert intake_bot.PAYMENT_DETAILS in reply


async def test_info_warns_when_no_intake_or_plans(
    session: AsyncSession, monkeypatch: Any
) -> None:
    """Другие тесты в сессии уже насажали intakes/plans в общую тестовую БД (она не
    откатывается между тестами) — «нет данных» подделываем через сами запросы, а не
    надеемся на пустые таблицы."""
    admin_chat = 999_007
    monkeypatch.setattr(intake_bot, "ADMIN_CHAT_ID", admin_chat)
    monkeypatch.setattr(intake_bot, "_current_intake", lambda _session: _none())
    monkeypatch.setattr(intake_bot, "_active_plans", lambda _session: _empty_list())
    client = FakeClient()

    await intake_bot._handle_message(client, session, admin_message("/info", admin_chat))

    reply = client.payload("sendMessage")["text"]
    assert "Активного набора нет" in reply
    assert "Активных тарифов нет" in reply


async def _none() -> None:
    return None


async def _empty_list() -> list[Any]:
    return []


async def test_info_from_participant_chat_does_nothing(
    session: AsyncSession, monkeypatch: Any
) -> None:
    app = await make_application(session)
    monkeypatch.setattr(intake_bot, "ADMIN_CHAT_ID", 999_008)
    client = FakeClient()

    await intake_bot._handle_message(client, session, admin_message("/info", app.tg_id))

    assert client.methods() == []


def test_info_is_admin_scoped_not_global() -> None:
    """Видна только в меню самого админского чата, а не всем участникам."""
    assert "info" not in [c["command"] for c in intake_bot.BOT_COMMANDS]
    assert "info" in [c["command"] for c in intake_bot.ADMIN_COMMANDS]


# --- Диспетчерский гейт: групповой admin-чат (регрессия) ------------------------


def test_dispatch_gate_allows_admin_group_chat(monkeypatch: Any) -> None:
    """Регрессия: раньше гейт пропускал в `_handle_message` только приватные

    чаты — если ADMIN_CHAT_ID настроен на группу (а не личку админа, как в доке),
    реплаи админа там никогда не доходили до кода, без единой ошибки в логах."""
    admin_chat = 999_020
    monkeypatch.setattr(intake_bot, "ADMIN_CHAT_ID", admin_chat)

    assert intake_bot._should_handle_message({"chat": {"id": admin_chat, "type": "supergroup"}})
    assert intake_bot._should_handle_message({"chat": {"id": 123, "type": "private"}})
    assert not intake_bot._should_handle_message({"chat": {"id": 123, "type": "supergroup"}})


# --- Кнопки воронки: edit-in-place вместо отдельных сообщений в admin-чат -------


async def test_accept_edits_anketa_in_place(session: AsyncSession, monkeypatch: Any) -> None:
    """«Принять» перерисовывает то же сообщение анкеты (кнопка снимается) вместо

    отдельного «✅ Заявка принята» + лог-эха в чат — иначе на одно действие
    приходится 3 сообщения, и легко зареплаить не на то (см. живой инцидент)."""
    admin_chat = 999_021
    monkeypatch.setattr(intake_bot, "ADMIN_CHAT_ID", admin_chat)
    tg_id = random.randint(10**9, 10**12)
    app = IntakeApplication(tg_id=tg_id, tg_username="arg", status="submitted", about="кто я")
    session.add(app)
    await session.commit()
    await session.refresh(app)
    client = FakeClient()

    await intake_bot._handle_accept(
        client, session,
        {
            "id": "cb", "data": f"acc:{app.id}",
            "message": {"message_id": 55, "chat": {"id": admin_chat}},
        },
    )
    await session.commit()

    edit = client.payload("editMessageText")
    assert edit["message_id"] == 55 and edit["chat_id"] == admin_chat
    assert "✅ Принята" in edit["text"] and "кто я" in edit["text"]
    assert edit["reply_markup"] == {"inline_keyboard": []}
    # Единственный sendMessage — экран тарифов участнику, не эхо в admin-чат.
    sends = [p for m, p in client.calls if m == "sendMessage"]
    assert len(sends) == 1 and sends[0]["chat_id"] == tg_id


async def test_confirm_payment_edits_caption_in_place(session: AsyncSession, monkeypatch: Any) -> None:
    admin_chat = 999_022
    monkeypatch.setattr(intake_bot, "ADMIN_CHAT_ID", admin_chat)
    await get_or_create_intake(session, date(2026, 5, 1))
    plan = await make_plan(session, f"Вода-{random.randint(100, 999)}", 12000)
    app = await make_application(session, status=STATUS_PAYMENT_REVIEW)
    app.plan_id = plan.id
    await session.commit()
    client = FakeClient()

    await intake_bot._handle_confirm_payment(
        client, session,
        {
            "id": "cb", "data": f"pay:{app.id}",
            "message": {"message_id": 77, "chat": {"id": admin_chat}},
        },
    )
    await session.commit()

    edit = client.payload("editMessageCaption")
    assert edit["message_id"] == 77 and edit["chat_id"] == admin_chat
    assert "✅ Подтверждено, логин" in edit["caption"]
    assert edit["reply_markup"] == {"inline_keyboard": []}
    # Никакого отдельного «✅ Заявка ... подтверждена» сообщения в admin-чат —
    # единственный sendMessage тут — логин/пароль участнику.
    sends = [p for m, p in client.calls if m == "sendMessage"]
    assert len(sends) == 1 and sends[0]["chat_id"] == app.tg_id


# --- Вопрос: тариф в тексте + edit-in-place «Отвечено» --------------------------


async def test_question_forward_includes_chosen_tariff(session: AsyncSession, monkeypatch: Any) -> None:
    admin_chat = 999_023
    monkeypatch.setattr(intake_bot, "ADMIN_CHAT_ID", admin_chat)
    plan = await make_plan(session, f"Огонь-{random.randint(100, 999)}", 20000)
    app = await make_application(session, status=STATUS_AWAITING_RECEIPT)
    app.plan_id = plan.id
    await session.commit()
    client = FakeClient()

    await intake_bot._forward_question(
        client, session, app.tg_id, app.tg_id, app.tg_username, "когда старт?"
    )

    forwarded = client.payload("sendMessage")["text"]
    assert plan.name in forwarded and "20 000 ₽" in forwarded

    raw = await intake_bot.redis_client.get("intakebot:qmap:777")
    assert raw is not None
    data = json.loads(raw)
    assert data["chat_id"] == app.tg_id and plan.name in data["text"]
    await intake_bot.redis_client.delete("intakebot:qmap:777")


async def test_question_forward_notes_missing_tariff(session: AsyncSession, monkeypatch: Any) -> None:
    admin_chat = 999_024
    monkeypatch.setattr(intake_bot, "ADMIN_CHAT_ID", admin_chat)
    app = await make_application(session, status=STATUS_AWAITING_ABOUT)
    app.plan_id = None
    await session.commit()
    client = FakeClient()

    await intake_bot._forward_question(
        client, session, app.tg_id, app.tg_id, app.tg_username, "привет"
    )

    assert "тариф ещё не выбран" in client.payload("sendMessage")["text"]
    await intake_bot.redis_client.delete("intakebot:qmap:777")


async def test_admin_reply_marks_question_answered_in_place(
    session: AsyncSession, monkeypatch: Any
) -> None:
    admin_chat = 999_025
    monkeypatch.setattr(intake_bot, "ADMIN_CHAT_ID", admin_chat)
    app = await make_application(session, status=STATUS_AWAITING_ABOUT)
    await session.commit()
    forward_client = FakeClient()
    await intake_bot._forward_question(
        forward_client, session, app.tg_id, app.tg_id, app.tg_username, "вопрос"
    )
    forwarded_msg_id = 777  # FakeClient всегда отвечает message_id 777

    reply_client = FakeClient()
    await intake_bot._deliver_admin_reply(reply_client, forwarded_msg_id, "ответ тут")

    delivered = reply_client.payload("sendMessage")
    assert delivered["chat_id"] == app.tg_id and "ответ тут" in delivered["text"]
    edit = reply_client.payload("editMessageText")
    assert edit["message_id"] == forwarded_msg_id and "Отвечено" in edit["text"]
    await intake_bot.redis_client.delete(f"intakebot:qmap:{forwarded_msg_id}")


async def test_admin_reply_falls_back_for_legacy_qmap_format(
    session: AsyncSession, monkeypatch: Any
) -> None:
    """Ключ старого формата (голый chat_id, не JSON) — вопрос, отправленный до

    этого релиза — должен и дальше доставляться, просто без edit-in-place
    отметки (сохранённого текста для правки у нас для него нет)."""
    admin_chat = 999_026
    monkeypatch.setattr(intake_bot, "ADMIN_CHAT_ID", admin_chat)
    asker_chat_id = random.randint(10**9, 10**12)
    await intake_bot.redis_client.set("intakebot:qmap:555", str(asker_chat_id), ex=60)
    client = FakeClient()

    await intake_bot._deliver_admin_reply(client, 555, "старый формат ответа")

    delivered = client.payload("sendMessage")
    assert delivered["chat_id"] == asker_chat_id and "старый формат ответа" in delivered["text"]
    assert "editMessageText" not in client.methods()
    admin_sends = [p["text"] for m, p in client.calls if m == "sendMessage" and p["chat_id"] == admin_chat]
    assert admin_sends == ["✅ Ответ доставлен участнику."]
    await intake_bot.redis_client.delete("intakebot:qmap:555")


# --- /confirm: подтвердить оплату вручную, без чека -----------------------------


async def test_confirm_command_creates_user_without_receipt(
    session: AsyncSession, monkeypatch: Any
) -> None:
    admin_chat = 999_027
    monkeypatch.setattr(intake_bot, "ADMIN_CHAT_ID", admin_chat)
    await get_or_create_intake(session, date(2026, 6, 1))
    plan = await make_plan(session, f"Земля-{random.randint(100, 999)}", 18000)
    app = await make_application(session, status=STATUS_AWAITING_RECEIPT)
    app.plan_id = plan.id
    await session.commit()
    client = FakeClient()

    await intake_bot._handle_message(
        client, session, admin_message(f"/confirm @{app.tg_username}", admin_chat)
    )
    await session.commit()
    await session.refresh(app)

    assert app.status == STATUS_CONFIRMED
    assert app.user_id is not None
    admin_reply = next(
        p["text"] for m, p in client.calls if m == "sendMessage" and p["chat_id"] == admin_chat
    )
    assert "вручную" in admin_reply


async def test_confirm_command_requires_tariff(session: AsyncSession, monkeypatch: Any) -> None:
    admin_chat = 999_028
    monkeypatch.setattr(intake_bot, "ADMIN_CHAT_ID", admin_chat)
    app = await make_application(session, status=STATUS_CHOOSING_PLAN)
    await session.commit()
    client = FakeClient()

    await intake_bot._handle_message(
        client, session, admin_message(f"/confirm @{app.tg_username}", admin_chat)
    )
    await session.refresh(app)

    assert "не выбран" in client.payload("sendMessage")["text"]
    assert app.status == STATUS_CHOOSING_PLAN


async def test_confirm_command_reports_missing_application(
    session: AsyncSession, monkeypatch: Any
) -> None:
    admin_chat = 999_029
    monkeypatch.setattr(intake_bot, "ADMIN_CHAT_ID", admin_chat)
    client = FakeClient()

    await intake_bot._handle_message(
        client, session, admin_message("/confirm @no-such-user", admin_chat)
    )

    assert "не найдено" in client.payload("sendMessage")["text"]


async def test_confirm_command_reports_already_confirmed(
    session: AsyncSession, monkeypatch: Any
) -> None:
    admin_chat = 999_030
    monkeypatch.setattr(intake_bot, "ADMIN_CHAT_ID", admin_chat)
    app = await make_confirmed_application(session)
    client = FakeClient()

    await intake_bot._handle_message(
        client, session, admin_message(f"/confirm @{app.tg_username}", admin_chat)
    )

    assert "уже подтверждена" in client.payload("sendMessage")["text"]


async def test_confirm_command_usage_without_username(
    session: AsyncSession, monkeypatch: Any
) -> None:
    admin_chat = 999_031
    monkeypatch.setattr(intake_bot, "ADMIN_CHAT_ID", admin_chat)
    client = FakeClient()

    await intake_bot._handle_message(client, session, admin_message("/confirm", admin_chat))

    assert client.payload("sendMessage")["text"] == intake_bot.TEXT_CONFIRM_USAGE


async def test_confirm_command_from_participant_chat_does_nothing(
    session: AsyncSession, monkeypatch: Any
) -> None:
    app = await make_application(session)
    monkeypatch.setattr(intake_bot, "ADMIN_CHAT_ID", 999_032)
    client = FakeClient()

    await intake_bot._handle_message(
        client, session, admin_message(f"/confirm @{app.tg_username}", app.tg_id)
    )

    assert client.methods() == []


def test_confirm_is_admin_scoped_not_global() -> None:
    assert "confirm" not in [c["command"] for c in intake_bot.BOT_COMMANDS]
    assert "confirm" in [c["command"] for c in intake_bot.ADMIN_COMMANDS]


# --- Логи действий: редирект в отдельный чат (TELEGRAM_INTAKE_BOT_LOG_CHAT_ID) --


async def test_log_action_goes_to_dedicated_chat_when_configured(
    session: AsyncSession, monkeypatch: Any
) -> None:
    admin_chat = 999_033
    log_chat = 999_034
    monkeypatch.setattr(intake_bot, "ADMIN_CHAT_ID", admin_chat)
    monkeypatch.setattr(intake_bot, "LOG_CHAT_ID", log_chat)
    app = await make_confirmed_application(session)
    client = FakeClient()

    await intake_bot._handle_change_password(
        client, session, callback(app, intake_bot.CB_CHANGE_PASSWORD)
    )

    log_sends = [p for m, p in client.calls if m == "sendMessage" and p["chat_id"] == log_chat]
    assert len(log_sends) == 1 and "сменил пароль" in log_sends[0]["text"]
    assert all(p["chat_id"] != admin_chat for m, p in client.calls if m == "sendMessage")


async def test_log_action_falls_back_to_admin_chat_when_not_configured(
    session: AsyncSession, monkeypatch: Any
) -> None:
    admin_chat = 999_035
    monkeypatch.setattr(intake_bot, "ADMIN_CHAT_ID", admin_chat)
    monkeypatch.setattr(intake_bot, "LOG_CHAT_ID", None)
    app = await make_confirmed_application(session)
    client = FakeClient()

    await intake_bot._handle_change_password(
        client, session, callback(app, intake_bot.CB_CHANGE_PASSWORD)
    )

    log_sends = [p for m, p in client.calls if m == "sendMessage" and p["chat_id"] == admin_chat]
    assert len(log_sends) == 1 and "сменил пароль" in log_sends[0]["text"]


# --- Бронь места: 24 часа на оплату (ARG-108) ----------------------------------


def sent_to(client: FakeClient, chat_id: int) -> dict[str, Any]:
    """Первое sendMessage в конкретный чат."""
    return next(p for m, p in client.calls if m == "sendMessage" and p["chat_id"] == chat_id)


def admin_callback(app_id: int, admin_chat: int, message_id: int = 1) -> dict[str, Any]:
    return {
        "id": "cb",
        "data": f"acc:{app_id}",
        "message": {"message_id": message_id, "chat": {"id": admin_chat}},
    }


async def make_booked_application(
    session: AsyncSession, status: str, deadline: datetime | None
) -> IntakeApplication:
    """Заявка с уже заведёнными (и, как правило, просроченными) часами брони."""
    app = await make_application(session, status=status)
    app.about = "кто я"
    app.payment_deadline_at = deadline
    await session.commit()
    await session.refresh(app)
    return app


async def test_accept_starts_the_payment_clock(session: AsyncSession, monkeypatch: Any) -> None:
    admin_chat = 999_101
    monkeypatch.setattr(intake_bot, "ADMIN_CHAT_ID", admin_chat)
    await make_plan(session, f"Вода-{random.randint(100, 999)}", 12000)
    app = await make_application(session, status=STATUS_SUBMITTED)
    client = FakeClient()

    await intake_bot._handle_accept(
        client, session,
        admin_callback(app.id, admin_chat),
    )
    await session.commit()
    await session.refresh(app)

    assert app.status == STATUS_CHOOSING_PLAN
    assert app.payment_deadline_at is not None
    window = app.payment_deadline_at - datetime.now(UTC)
    assert timedelta(hours=23, minutes=59) < window <= timedelta(hours=24)
    # Напоминаний до сгорания нет, поэтому дедлайн виден прямо на экране тарифов.
    plans_screen = sent_to(client, app.tg_id)
    assert intake_bot._deadline_str(app.payment_deadline_at) in plans_screen["text"]


async def test_offer_accept_repeats_the_deadline_with_payment_details(
    session: AsyncSession,
) -> None:
    plan = await make_plan(session, f"Вода-{random.randint(100, 999)}", 12000)
    app = await make_booked_application(
        session, STATUS_AWAITING_OFFER, datetime.now(UTC) + timedelta(hours=5)
    )
    app.plan_id = plan.id
    await session.commit()
    client = FakeClient()

    await intake_bot._handle_offer_accept(client, session, callback(app, f"of:{app.id}"))
    await session.commit()

    text = client.payload("sendMessage")["text"]
    assert "12 000 ₽" in text
    assert app.payment_deadline_at is not None
    assert intake_bot._deadline_str(app.payment_deadline_at) in text


async def test_sweep_expires_overdue_booking(session: AsyncSession, monkeypatch: Any) -> None:
    admin_chat = 999_102
    monkeypatch.setattr(intake_bot, "ADMIN_CHAT_ID", admin_chat)
    app = await make_booked_application(
        session, STATUS_AWAITING_RECEIPT, datetime.now(UTC) - timedelta(minutes=1)
    )
    client = FakeClient()

    expired = await intake_bot._expire_overdue(client, session)
    await session.refresh(app)

    assert expired >= 1
    assert app.status == STATUS_EXPIRED
    assert app.expired_at is not None
    assert sent_to(client, app.tg_id)["text"] == intake_bot.TEXT_EXPIRED
    to_admin = sent_to(client, admin_chat)
    assert "истекла" in to_admin["text"]
    buttons = [b for row in to_admin["reply_markup"]["inline_keyboard"] for b in row]
    assert any(b["callback_data"] == f"acc:{app.id}" for b in buttons)


async def test_sweep_does_not_expire_application_under_review(session: AsyncSession) -> None:
    """Чек уже прислан — дальше ход админа, и заявка не должна сгореть, пока он спит."""
    app = await make_booked_application(
        session, STATUS_PAYMENT_REVIEW, datetime.now(UTC) - timedelta(hours=48)
    )
    client = FakeClient()

    await intake_bot._expire_overdue(client, session)
    await session.refresh(app)

    assert app.status == STATUS_PAYMENT_REVIEW
    assert app.expired_at is None
    assert not [p for m, p in client.calls if m == "sendMessage" and p["chat_id"] == app.tg_id]


async def test_button_after_deadline_expires_the_application(
    session: AsyncSession, monkeypatch: Any
) -> None:
    """Свип мог ещё не дойти до заявки — кнопка в чате обязана отбиться сама."""
    monkeypatch.setattr(intake_bot, "ADMIN_CHAT_ID", 999_103)
    plan = await make_plan(session, f"Огонь-{random.randint(100, 999)}", 9000)
    app = await make_booked_application(
        session, STATUS_CHOOSING_PLAN, datetime.now(UTC) - timedelta(seconds=30)
    )
    client = FakeClient()

    data = f"pc:{app.id}:{plan.id}"
    await intake_bot._handle_plan_choose(client, session, callback(app, data))
    await session.commit()
    await session.refresh(app)

    assert app.status == STATUS_EXPIRED
    assert app.plan_id is None
    answer = client.payload("answerCallbackQuery")
    assert answer["show_alert"] is True
    assert answer["text"] == intake_bot.TEXT_EXPIRED_ALERT


async def test_receipt_after_deadline_is_too_late(
    session: AsyncSession, monkeypatch: Any
) -> None:
    monkeypatch.setattr(intake_bot, "ADMIN_CHAT_ID", 999_104)
    app = await make_booked_application(
        session, STATUS_AWAITING_RECEIPT, datetime.now(UTC) - timedelta(minutes=5)
    )
    client = FakeClient()

    await intake_bot._handle_message(
        client, session,
        {
            "chat": {"id": app.tg_id, "type": "private"},
            "from": {"id": app.tg_id},
            "photo": [{"file_id": "late-receipt"}],
        },
    )
    await session.commit()
    await session.refresh(app)

    assert app.status == STATUS_EXPIRED
    assert app.receipt_file_id is None
    assert sent_to(client, app.tg_id)["text"] == intake_bot.TEXT_EXPIRED


async def test_start_on_expired_sends_application_back_to_admin(
    session: AsyncSession, monkeypatch: Any
) -> None:
    admin_chat = 999_105
    monkeypatch.setattr(intake_bot, "ADMIN_CHAT_ID", admin_chat)
    app = await make_booked_application(
        session, STATUS_EXPIRED, datetime.now(UTC) - timedelta(hours=1)
    )
    client = FakeClient()

    from_user = {"id": app.tg_id, "username": "arg"}
    await intake_bot._handle_start(client, session, app.tg_id, from_user)
    await session.commit()
    await session.refresh(app)

    assert app.status == STATUS_SUBMITTED
    assert app.payment_deadline_at is None and app.expired_at is None
    to_admin = sent_to(client, admin_chat)
    assert "Повторная заявка" in to_admin["text"] and "кто я" in to_admin["text"]
    buttons = [b for row in to_admin["reply_markup"]["inline_keyboard"] for b in row]
    assert any(b["callback_data"] == f"acc:{app.id}" for b in buttons)


async def test_accept_of_expired_restarts_funnel_with_fresh_deadline(
    session: AsyncSession, monkeypatch: Any
) -> None:
    """«Принять снова» — она же «продлить»: тариф и оферта выбираются заново."""
    admin_chat = 999_106
    monkeypatch.setattr(intake_bot, "ADMIN_CHAT_ID", admin_chat)
    plan = await make_plan(session, f"Вода-{random.randint(100, 999)}", 12000)
    app = await make_booked_application(
        session, STATUS_EXPIRED, datetime.now(UTC) - timedelta(hours=2)
    )
    app.expired_at = datetime.now(UTC) - timedelta(hours=2)
    app.plan_id = plan.id
    app.offer_accepted_at = datetime.now(UTC) - timedelta(hours=3)
    app.offer_version = "old"
    await session.commit()
    client = FakeClient()

    await intake_bot._handle_accept(
        client, session,
        admin_callback(app.id, admin_chat, message_id=2),
    )
    await session.commit()
    await session.refresh(app)

    assert app.status == STATUS_CHOOSING_PLAN
    assert app.plan_id is None
    assert app.offer_accepted_at is None and app.offer_version is None
    assert app.expired_at is None
    assert app.payment_deadline_at is not None
    assert app.payment_deadline_at > datetime.now(UTC)
