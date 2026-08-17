"""ASGI-middleware наблюдаемости: время ответа, сквозной `request_id`, структурный лог.

Зачем: без этого на жалобу «висит» нельзя ответить, виноват ли сервер, а упавший
запрос не оставляет следа, по которому его можно найти.

Почему чистый ASGI, а не `BaseHTTPMiddleware`: последний оборачивает ответ в свою
задачу и мешает потоковой отдаче. Здесь же мы только подменяем `send`, считая
статус и размер ответа по проходящим сообщениям, — накладные расходы нулевые, а
потоковые ответы проходят насквозь.

Порядок важен: `record_http` вызывается ПОСЛЕ того, как приложение отдало ответ,
то есть запись в Redis не добавляет пользователю ни миллисекунды ожидания.

WebSocket не инструментируется сознательно: соединение долгоживущее, метрика
«время ответа» к нему неприменима (см. границы задачи ARG-79).
"""
import time
import uuid
from typing import Any

from starlette.types import ASGIApp, Message, Receive, Scope, Send

from app.core.context import get_current_user_id, get_request_id, reset_context, set_request_id
from app.core.metrics import log_structured, record_http, scenario_for

REQUEST_ID_HEADER = "x-request-id"

# Шаблон для запросов, не совпавших ни с одним роутом (404 по неизвестному пути).
# Без этого каждый несуществующий URL заводил бы свой ключ в Redis — идеальный
# способ получить неограниченную кардинальность от любого сканера.
UNMATCHED_ROUTE = "<unmatched>"


def _route_template(scope: Scope) -> str:
    """Шаблон совпавшего роута (`/api/rooms/{room_id}/messages`), не подставленный путь.

    Роутер Starlette кладёт совпавший роут в scope уже после нашего входа, поэтому
    читать это можно только ПОСЛЕ вызова приложения. Имя атрибута отличается между
    версиями (`path_format` у FastAPI, `path` у Starlette) — берём то, что есть.
    """
    route: Any = scope.get("route")
    if route is None:
        return UNMATCHED_ROUTE
    template = getattr(route, "path_format", None) or getattr(route, "path", None)
    return template if isinstance(template, str) else UNMATCHED_ROUTE


class ObservabilityMiddleware:
    """Меряет каждый HTTP-запрос и оставляет ровно одну структурную строку в stdout."""

    def __init__(self, app: ASGIApp) -> None:
        self.app = app

    async def __call__(self, scope: Scope, receive: Receive, send: Send) -> None:
        if scope["type"] != "http":
            await self.app(scope, receive, send)
            return

        reset_context()
        request_id = self._incoming_request_id(scope) or uuid.uuid4().hex
        set_request_id(request_id)

        started = time.perf_counter()
        status = 500  # если приложение упадёт до response.start — это 500
        body_bytes = 0

        async def send_wrapper(message: Message) -> None:
            nonlocal status, body_bytes
            if message["type"] == "http.response.start":
                status = int(message["status"])
                # Отдаём идентификатор клиенту: по нему он может назвать свой запрос
                # в поддержке, а мы — найти его целиком в логах.
                headers = list(message.get("headers", []))
                headers.append((REQUEST_ID_HEADER.encode(), request_id.encode()))
                message = {**message, "headers": headers}
            elif message["type"] == "http.response.body":
                body_bytes += len(message.get("body", b""))
            await send(message)

        error: str | None = None
        try:
            await self.app(scope, receive, send_wrapper)
        except Exception as exc:
            # Необработанное исключение: фиксируем как 5xx и оставляем след с
            # контекстом, затем пробрасываем — ответ формирует сам FastAPI.
            error = f"{type(exc).__name__}: {exc}"
            raise
        finally:
            await self._finish(
                scope=scope,
                started=started,
                status=status,
                body_bytes=body_bytes,
                error=error,
                request_id=request_id,
            )

    @staticmethod
    def _incoming_request_id(scope: Scope) -> str | None:
        """Идентификатор из заголовка, если его проставил edge. Чужому не доверяем
        дальше 64 символов — это ключ только для логов, но мусор в логах не нужен."""
        for name, value in scope.get("headers", []):
            if name.decode().lower() == REQUEST_ID_HEADER:
                incoming = value.decode(errors="replace").strip()[:64]
                return incoming or None
        return None

    async def _finish(
        self,
        *,
        scope: Scope,
        started: float,
        status: int,
        body_bytes: int,
        error: str | None,
        request_id: str,
    ) -> None:
        """Записать метрику и лог. Никогда не бросает: наблюдение не важнее запроса."""
        try:
            elapsed_ms = (time.perf_counter() - started) * 1000
            route = _route_template(scope)
            method = str(scope.get("method", "?"))
            log_structured(
                {
                    "event": "http_error" if error else "http_request",
                    "request_id": get_request_id() or request_id,
                    "user_id": get_current_user_id(),
                    "method": method,
                    "route": route,
                    "scenario": scenario_for(route),
                    "status": status,
                    "server_ms": round(elapsed_ms),
                    "bytes": body_bytes,
                    "error": error,
                }
            )
            await record_http(method, route, status, elapsed_ms)
        except Exception:  # noqa: BLE001 — наблюдение не важнее запроса
            pass
