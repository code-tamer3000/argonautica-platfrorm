"""Экран выбора тарифа в боте приёма (ARG-94).

Бот — не HTTP-приложение, поэтому Telegram-транспорт подменён фейком (записывает
вызовы Bot API), а Postgres — настоящий: статусы заявки проверяем в БД.
"""
import importlib.util
import random
import sys
from pathlib import Path
from types import ModuleType
from typing import Any

from sqlalchemy.ext.asyncio import AsyncSession

from app.models.intake_application import (
    STATUS_AWAITING_RECEIPT,
    STATUS_CHOOSING_PLAN,
    STATUS_PAYMENT_REVIEW,
    IntakeApplication,
)
from app.models.plan import Plan


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
        tg_username=f"u{random.randint(1000, 9999)}",
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


async def test_choose_plan_moves_to_awaiting_receipt(session: AsyncSession) -> None:
    app = await make_application(session)
    plan = await make_plan(session, "Вода", 12000)
    client = FakeClient()

    await intake_bot._handle_plan_choose(client, session, callback(app, f"pc:{app.id}:{plan.id}"))
    await session.commit()
    await session.refresh(app)

    assert app.status == STATUS_AWAITING_RECEIPT
    assert app.plan_id == plan.id
    assert "12 000 ₽" in client.payload("sendMessage")["text"]


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
