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
from app.core.metrics import log_media_metric, record_step, summarize
from app.models.user import User
from app.schemas.metrics import MetricsBatch
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
