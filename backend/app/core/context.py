"""Контекст текущего запроса: сквозной `request_id` и опознанный пользователь.

Зачем: чтобы «пропавшее сообщение» можно было проследить целиком, каждая лог-строка
одного запроса должна нести один и тот же идентификатор. Держим его в contextvars —
они корректно изолированы по задачам asyncio, поэтому параллельные запросы не смешивают
свои значения (в отличие от любого глобального словаря).

Заполняет: `ObservabilityMiddleware` (request_id, на входе) и `get_current_user`
(user_id, когда токен уже разобран). Читает: структурный лог в `core/metrics.py`.
"""
from contextvars import ContextVar

# Пусто вне запроса (фоновые задачи, тесты, стартап) — читатели обязаны это учитывать.
_request_id: ContextVar[str | None] = ContextVar("request_id", default=None)
_user_id: ContextVar[int | None] = ContextVar("user_id", default=None)


def set_request_id(value: str) -> None:
    _request_id.set(value)


def get_request_id() -> str | None:
    return _request_id.get()


def set_current_user_id(value: int) -> None:
    """Вызывается из `get_current_user` — до неё личность запроса неизвестна."""
    _user_id.set(value)


def get_current_user_id() -> int | None:
    return _user_id.get()


def reset_context() -> None:
    """Сбросить контекст (для тестов: contextvars переживают запрос в том же таске)."""
    _request_id.set(None)
    _user_id.set(None)
