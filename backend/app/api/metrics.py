"""Приём и свод метрик производительности медиа (измерительный слой).

Поток: клиент инструментирует свои шаги upload/download (presign → PUT → confirm →
GET, время до onload) и шлёт трейсы сюда пачками. Бэкенд пишет их JSON-строкой в
stdout (`docker logs | grep '"metric":"media"'`) и копит перцентили в Redis.
Свод (`GET`) — для админа, чтобы быстро увидеть «где хвост», не парся логи.

Приём открыт любому активному пользователю (шлёт метрики только со своих операций);
свод — только админам. Значения клиентские, не доверенные: наблюдение, не контроль.
См. docs/FILES.md «Сбор метрик».

Здесь же живёт `GET /api/metrics/system` — снимок инфраструктурных гейджей «сейчас»
(очередь транскода, онлайн, пул БД, Redis, диск). Сбор — в
`app/services/system_metrics.py`, это уже не про медиа, но тот же измерительный слой
и тот же префикс.
"""
from typing import Annotated, Any

from fastapi import APIRouter, Depends, Response, status

from app.api.deps import get_current_active_user, require_admin
from app.core.config import settings
from app.core.metrics import (
    log_client_metric,
    log_media_metric,
    record_client_bytes,
    record_client_error,
    record_client_nav,
    record_client_scenario,
    record_step,
    summarize,
    summarize_client,
    summarize_http,
)
from app.models.user import User
from app.schemas.metrics import ClientMetric, ClientMetricsBatch, MetricsBatch
from app.services.ratelimit import enforce_rate_limit
from app.services.system_metrics import collect_snapshot

router = APIRouter(prefix="/api/metrics", tags=["metrics"])

# Отображение «имя шага из трейса → короткая метка шага в агрегате». Клиент шлёт
# `presign_ms`, храним под `presign` (суффикс `_ms` не несёт смысла в ключе).
_STEP_SUFFIX = "_ms"


@router.post("/media", status_code=status.HTTP_204_NO_CONTENT)
async def ingest_media_metrics(
    batch: MetricsBatch,
    current_user: Annotated[User, Depends(get_current_active_user)],
) -> Response:
    """Принять пачку клиентских трейсов медиа: лог + агрегация в Redis.

    Возвращает 204 всегда (даже при выключенном сборе) — метрики не должны влиять
    на UX клиента. Rate-limit щадящий: клиент шлёт редко, пачками.
    """
    await enforce_rate_limit(
        f"rl:metrics:{current_user.id}", settings.rate_limit_upload_per_minute
    )
    if not settings.media_metrics_enabled:
        return Response(status_code=status.HTTP_204_NO_CONTENT)

    for item in batch.items:
        log_media_metric(
            {
                "op": item.op,
                "kind": item.kind,
                "source": "client",
                "size": item.size,
                "net": item.net,
                "total_ms": round(item.total_ms),
                "steps": {k: round(v) for k, v in item.steps.items()},
                "user_id": current_user.id,
            }
        )
        # Полная длительность как отдельный «шаг» total — удобно смотреть перцентиль.
        await record_step(item.op, item.kind, "client", "total", item.total_ms)
        for name, ms in item.steps.items():
            step = name[: -len(_STEP_SUFFIX)] if name.endswith(_STEP_SUFFIX) else name
            await record_step(item.op, item.kind, "client", step, ms)

    return Response(status_code=status.HTTP_204_NO_CONTENT)


@router.post("/client", status_code=status.HTTP_204_NO_CONTENT)
async def ingest_client_metrics(
    batch: ClientMetricsBatch,
    current_user: Annotated[User, Depends(get_current_active_user)],
) -> Response:
    """Принять пачку клиентских событий RUM: лог + агрегация в Redis.

    Виды событий — загрузка приложения, открытие комнаты, скачанные байты по типам
    медиа, упавший экран (см. `ClientMetric`). Как и у медиа, отвечаем 204 всегда:
    приёмник метрик не имеет права влиять на UX и уж тем более ронять экран.
    """
    await enforce_rate_limit(
        f"rl:metrics:client:{current_user.id}", settings.rate_limit_upload_per_minute
    )
    if not settings.client_metrics_enabled:
        return Response(status_code=status.HTTP_204_NO_CONTENT)

    for item in batch.items:
        log_client_metric({**item.model_dump(exclude_none=True), "user_id": current_user.id})
        await _aggregate_client_metric(item)

    return Response(status_code=status.HTTP_204_NO_CONTENT)


async def _aggregate_client_metric(item: ClientMetric) -> None:
    """Разложить одно клиентское событие по гистограммам/счётчикам Redis."""
    if item.kind == "navigation":
        steps = {k[: -len(_STEP_SUFFIX)] if k.endswith(_STEP_SUFFIX) else k: v
                 for k, v in item.steps.items()}
        # Собственно фронт = LCP − TTFB: канал и сервер уже посчитаны в ttfb, и без
        # этой разности «первый экран тормозит» ни на кого не разложить (ARG-15).
        if "lcp" in steps and "ttfb" in steps and steps["lcp"] >= steps["ttfb"]:
            steps["frontend"] = steps["lcp"] - steps["ttfb"]
        for step, ms in steps.items():
            await record_client_nav(item.cold, item.net, step, ms)
    elif item.kind == "room_open":
        for name, ms in item.steps.items():
            step = name[: -len(_STEP_SUFFIX)] if name.endswith(_STEP_SUFFIX) else name
            await record_client_scenario("room_open", step, ms)
        if item.total_ms is not None:
            await record_client_scenario("room_open", "total", item.total_ms)
    elif item.kind == "resources":
        visit = item.visit or "first"
        for kind, size in item.bytes.items():
            await record_client_bytes(visit, kind, size)
    elif item.kind == "error":
        await record_client_error(item.build, item.route, item.message or "")


@router.get("/client")
async def client_metrics_summary(
    _admin: Annotated[User, Depends(require_admin)],
) -> dict[str, Any]:
    """Свод клиентского RUM (админ): первый экран, сценарии, байты, упавшие экраны.

    `{enabled, first_screen: {"cold:4g:lcp": {count, avg_ms, p50, p90, p99}},
    scenarios: {"room_open:ttfb": {...}}, bytes: {"first:image": {count, sum_bytes,
    avg_bytes}}, errors: {counts, recent}}`. Значения клиентские — наблюдение,
    не контроль. См. docs/FRONTEND.md «Клиентский RUM».
    """
    return {
        "enabled": settings.client_metrics_enabled,
        **await summarize_client(),
    }


@router.get("/http")
async def http_metrics_summary(
    _admin: Annotated[User, Depends(require_admin)],
) -> dict[str, Any]:
    """Свод по HTTP-запросам (админ): перцентили времени ответа и статусы.

    `{enabled, routes: {"GET:/api/rooms/{room_id}/messages": {count, avg_ms, p50, p90,
    p99, statuses, error_rate}}, scenarios: {"room_open": {...}}}`. Разрез — шаблон
    роута, не подставленный путь. Собирает ObservabilityMiddleware.
    """
    return {
        "enabled": settings.http_metrics_enabled,
        **await summarize_http(),
    }


@router.get("/media")
async def media_metrics_summary(
    _admin: Annotated[User, Depends(require_admin)],
) -> dict[str, Any]:
    """Свод перцентилей по шагам медиа (админ). `{enabled, steps:{key:{count,avg,p50,p90,p99}}}`.

    Ключ шага — `<source>:<op>:<kind>:<step>`, напр. `client:upload:image:put` или
    `server:upload:image:thumbnail`. Смотреть в браузере; логи — для сырых событий.
    """
    return {
        "enabled": settings.media_metrics_enabled,
        "steps": await summarize(),
    }


@router.get("/system")
async def system_metrics_snapshot(
    _admin: Annotated[User, Depends(require_admin)],
) -> dict[str, Any]:
    """Снимок инфраструктурных гейджей «сейчас» (админ): очередь транскода, онлайн,
    пул соединений к БД, память и latency Redis, свободное место под медиа.

    Считается на лету при запросе — фонового сборщика нет (гейджей мало, запрос редкий).
    Сбой отдельного источника отдаётся как `{"error": ...}` внутри его блока, снимок всё
    равно приходит: диагностика нужна ровно тогда, когда что-то лежит. См.
    `app/services/system_metrics.py` и docs/FILES.md «Снимок инфраструктуры».
    """
    return await collect_snapshot()
