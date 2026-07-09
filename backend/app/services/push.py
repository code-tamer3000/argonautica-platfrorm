"""Нативные push-уведомления через Web Push (VAPID, стандарт W3C).

Транспорт поверх той же точки генерации, что и in-app лента: там, где мы кладём
уведомление в Postgres и шлём WS-событие в `user:{id}`, дополнительно ставим
фоновую отправку native push (`enqueue_push`). Push best-effort: любые ошибки
логируем и глотаем — основной путь отправки/выдачи никогда не роняем.

Почему отдельная фоновая задача, а не inline в транзакции запроса:
- pywebpush ходит по сети в push-сервис браузера (Google/Mozilla/Apple) —
  держать открытой транзакцию БД на время этих round-trip нельзя;
- отправка не должна задерживать HTTP-ответ отправителю сообщения.
Поэтому `enqueue_push` планирует независимую корутину со своей сессией БД.

Мёртвые подписки (404/410 от push-сервиса — юзер отписался/сменил браузер)
удаляем на месте, чтобы таблица не копила мусор.
"""
import asyncio
import json
import logging
from typing import Any

from fastapi.concurrency import run_in_threadpool
from pywebpush import WebPushException, webpush  # type: ignore[import-untyped]
from sqlalchemy import delete, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import settings
from app.db.session import SessionLocal
from app.models.push import PushSubscription

logger = logging.getLogger(__name__)

# Держим ссылки на фоновые задачи, чтобы их не собрал GC до завершения
# (asyncio держит только weak-ref на задачу).
_background_tasks: set[asyncio.Task[Any]] = set()


def _vapid_claims() -> dict[str, str]:
    return {"sub": settings.vapid_subject}


def build_payload(
    title: str,
    body: str | None,
    *,
    url: str = "/",
    tag: str | None = None,
) -> dict[str, Any]:
    """Payload, который читает service worker в обработчике `push` (см. фронт sw.ts).

    `url` — куда вести по клику (навигация внутри SPA). `tag` — чтобы новые пуши
    того же разговора заменяли старые в шторке, а не копились.
    """
    payload: dict[str, Any] = {"title": title, "body": body or "", "url": url}
    if tag is not None:
        payload["tag"] = tag
    return payload


def _send_one(subscription: PushSubscription, data: str) -> None:
    """Синхронная отправка одной подписке (pywebpush работает через requests).

    Бросает WebPushException; статус смотрим у вызывающего для чистки мёртвых.
    """
    webpush(
        subscription_info={
            "endpoint": subscription.endpoint,
            "keys": {"p256dh": subscription.p256dh, "auth": subscription.auth},
        },
        data=data,
        vapid_private_key=settings.vapid_private_key,
        vapid_claims=_vapid_claims(),
        timeout=10,
    )


async def _deliver(user_id: int, payload: dict[str, Any]) -> None:
    """Разослать payload по всем подпискам пользователя (в собственной сессии)."""
    data = json.dumps(payload)
    async with SessionLocal() as session:
        subs = list(
            (
                await session.execute(
                    select(PushSubscription).where(
                        PushSubscription.user_id == user_id
                    )
                )
            )
            .scalars()
            .all()
        )
        if not subs:
            return

        dead_ids: list[int] = []
        for sub in subs:
            try:
                await run_in_threadpool(_send_one, sub, data)
            except WebPushException as exc:
                status = getattr(exc.response, "status_code", None)
                if status in (404, 410):
                    # Подписка протухла (юзер отписался/сменил устройство) — удаляем.
                    dead_ids.append(sub.id)
                else:
                    logger.warning(
                        "Web push failed (status=%s) for sub %s", status, sub.id
                    )
            except Exception:
                logger.exception("Unexpected web push error for sub %s", sub.id)

        if dead_ids:
            await session.execute(
                delete(PushSubscription).where(PushSubscription.id.in_(dead_ids))
            )
            await session.commit()


def enqueue_push(user_id: int, payload: dict[str, Any]) -> None:
    """Поставить фоновую отправку native push пользователю. Не ждёт результата.

    Безопасно вызывать без ключей VAPID (dev/тесты) — просто ничего не делает.
    Ошибку планирования (нет event loop и т.п.) глотаем: push best-effort.
    """
    if not settings.push_enabled:
        return
    try:
        task = asyncio.create_task(_safe_deliver(user_id, payload))
        _background_tasks.add(task)
        task.add_done_callback(_background_tasks.discard)
    except RuntimeError:
        # Нет запущенного event loop — вне обычного request-контекста. Молча пропускаем.
        logger.debug("enqueue_push called without a running loop; skipped")


async def _safe_deliver(user_id: int, payload: dict[str, Any]) -> None:
    try:
        await _deliver(user_id, payload)
    except Exception:
        logger.exception("Failed to deliver push to user %s", user_id)


async def save_subscription(
    session: AsyncSession,
    user_id: int,
    endpoint: str,
    p256dh: str,
    auth: str,
    user_agent: str | None,
) -> None:
    """Сохранить/обновить подписку. Идемпотентно по endpoint (natural key).

    Если этот endpoint уже был у другого юзера (например, общий браузер сменил
    залогиненного пользователя) — переназначаем его текущему и обновляем ключи.
    """
    existing = await session.scalar(
        select(PushSubscription).where(PushSubscription.endpoint == endpoint)
    )
    if existing is not None:
        existing.user_id = user_id
        existing.p256dh = p256dh
        existing.auth = auth
        existing.user_agent = user_agent
    else:
        session.add(
            PushSubscription(
                user_id=user_id,
                endpoint=endpoint,
                p256dh=p256dh,
                auth=auth,
                user_agent=user_agent,
            )
        )
    await session.flush()


async def delete_subscription(
    session: AsyncSession, user_id: int, endpoint: str
) -> None:
    """Удалить подписку по endpoint (только свою — не трогаем чужие строки)."""
    await session.execute(
        delete(PushSubscription).where(
            PushSubscription.endpoint == endpoint,
            PushSubscription.user_id == user_id,
        )
    )
    await session.flush()
