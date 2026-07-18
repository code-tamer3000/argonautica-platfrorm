"""Очередь транскод-джоб в Redis (эфемерное состояние, CLAUDE.md: «очередь — Redis»).

Простой list + claim/ack с реклеймом по таймауту (спека: «reclaim-on-timeout list
pattern, простейший»):

  - `transcode:pending`     — LIST id'ов ассетов, ждущих обработки (RPUSH в хвост).
  - `transcode:inflight`    — HASH {asset_id: claimed_at_ts} забранных, но не закрытых
                              джоб. Воркер атомарно перекладывает id из pending сюда.
  - `transcode:attempts`    — HASH {asset_id: n} счётчик попыток.

Живучесть при падении воркера (спека, п.5): если джоба висит в `inflight` дольше
CLAIM_TIMEOUT (воркер умер/завис, не сделал ack), `reclaim_stale()` возвращает её в
`pending` — не теряется молча. Долговечное состояние отдачи (processing/done/failed)
живёт в Postgres (media_assets.transcode_status), здесь — только рабочая механика.

Одна джоба за раз на воркер (спека: ffmpeg сатурирует ядра) — воркер вызывает
`claim()` в цикле по одной. Клиент Redis создан с decode_responses=True → строки.
"""
import time
from typing import cast

from app.core.config import settings
from app.core.redis import redis_client

PENDING_KEY = "transcode:pending"
INFLIGHT_KEY = "transcode:inflight"
ATTEMPTS_KEY = "transcode:attempts"


async def enqueue(asset_id: int) -> None:
    """Поставить ассет в очередь на транскод (хвост pending). Идемпотентность не нужна:
    повторная постановка того же id — редкость (один confirm на видео), а воркер и так
    свяжет её с актуальным состоянием строки в Postgres."""
    await redis_client.rpush(PENDING_KEY, asset_id)


async def claim() -> int | None:
    """Забрать одну джобу: снять id с головы pending, отметить в inflight с меткой
    времени. None — очередь пуста. Не блокирующий (воркер сам делает паузу при пустой).
    """
    # decode_responses=True → строка, но стабы redis этого флага не моделируют.
    raw = cast("str | None", await redis_client.lpop(PENDING_KEY))
    if raw is None:
        return None
    asset_id = int(raw)
    await redis_client.hset(INFLIGHT_KEY, str(asset_id), str(time.time()))
    return asset_id


async def bump_attempts(asset_id: int) -> int:
    """Увеличить и вернуть число попыток обработки ассета."""
    n: int = await redis_client.hincrby(ATTEMPTS_KEY, str(asset_id), 1)
    return n


async def ack(asset_id: int) -> None:
    """Закрыть джобу (успех или терминальный провал): снять из inflight и attempts."""
    await redis_client.hdel(INFLIGHT_KEY, str(asset_id))
    await redis_client.hdel(ATTEMPTS_KEY, str(asset_id))


async def requeue(asset_id: int) -> None:
    """Вернуть джобу в очередь на ретрай: снять из inflight, дописать в хвост pending.
    Счётчик попыток НЕ трогаем (его ведёт bump_attempts)."""
    await redis_client.hdel(INFLIGHT_KEY, str(asset_id))
    await redis_client.rpush(PENDING_KEY, asset_id)


async def reclaim_stale() -> list[int]:
    """Вернуть в pending джобы, зависшие в inflight дольше claim-таймаута (воркер упал).

    Возвращает список реклейменных id (для логов). Вызывать периодически из воркера.
    """
    now = time.time()
    inflight = cast("dict[str, str]", await redis_client.hgetall(INFLIGHT_KEY))
    reclaimed: list[int] = []
    for asset_id_str, claimed_at in inflight.items():
        if now - float(claimed_at) > settings.transcode_claim_timeout_seconds:
            await requeue(int(asset_id_str))
            reclaimed.append(int(asset_id_str))
    return reclaimed
