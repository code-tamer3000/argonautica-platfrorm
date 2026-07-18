"""Воркер серверного транскода видео (docs/FILES.md «Транскод видео»).

Отдельный процесс/контейнер (в проде — свой сервис compose; в dev/тестах гоняется
как host-процесс `python -m app.worker.transcode`). Тянет джобы из Redis-очереди
(transcode_queue), по одной за раз (ffmpeg сатурирует ядра), обрабатывает через
services/transcode и обновляет media_assets + шлёт WS-событие в комнаты чата.

`process_one_job` вынесен отдельно и самодостаточен (сам открывает сессию) — его
дёргает и цикл воркера, и интеграционные тесты (реальные Postgres/Redis/MinIO, без
моков): один вызов = обработка одной джобы из очереди.
"""
import asyncio
import logging

from fastapi.concurrency import run_in_threadpool
from sqlalchemy import select

from app.core.config import settings
from app.db.session import SessionLocal
from app.models.media import MediaAsset
from app.services import transcode_queue as q
from app.services.media import build_attachment_out, message_targets_for_asset
from app.services.transcode import TranscodeError, transcode_asset
from app.ws.pubsub import publish_room_event
from app.ws.schemas import attachment_updated_event

logger = logging.getLogger(__name__)


async def _publish_asset_update(asset: MediaAsset) -> None:
    """Разослать `attachment.updated` во все комнаты чата, где висит это видео.

    Отдельная сессия только на чтение целей + сборку payload'а. Задачи/БЗ пропускаем
    (нет room-канала) — там вариант подхватится при следующем чтении ленты."""
    async with SessionLocal() as session:
        targets = await message_targets_for_asset(session, asset.id)
    attachment = build_attachment_out(asset).model_dump(mode="json")
    for room_id, message_id in targets:
        await publish_room_event(
            room_id, attachment_updated_event(room_id, message_id, attachment)
        )


async def process_one_job() -> int | None:
    """Обработать одну джобу из очереди. Возвращает asset_id (обработанный/провалённый)
    или None, если очередь пуста.

    Терминальные состояния идут в Postgres (media_assets.transcode_status):
      - успех → 'done' + variant_key/variant_mime (+ постер/длительность);
      - провал после max_attempts → 'failed' (оригинал остаётся скачиваемым);
      - провал до лимита → строку не трогаем (остаётся 'processing'), джоба в pending.
    После терминального состояния — WS-событие в комнаты чата.
    """
    asset_id = await q.claim()
    if asset_id is None:
        return None

    async with SessionLocal() as session:
        asset = (
            await session.execute(select(MediaAsset).where(MediaAsset.id == asset_id))
        ).scalar_one_or_none()

    # Строки нет / уже не видео / уже обработано — джобу закрываем без работы.
    if asset is None or asset.kind != "video" or asset.transcode_status in (
        "done",
        "failed",
    ):
        await q.ack(asset_id)
        return asset_id

    attempt = await q.bump_attempts(asset_id)
    try:
        result = await run_in_threadpool(
            transcode_asset, asset.bucket, asset.storage_key
        )
    except TranscodeError:
        logger.warning(
            "transcode attempt %s/%s failed for asset %s",
            attempt, settings.transcode_max_attempts, asset_id, exc_info=True,
        )
        if attempt >= settings.transcode_max_attempts:
            # Терминальный провал: помечаем failed, ack. Оригинал остаётся отдаваемым.
            async with SessionLocal() as session:
                asset = await session.get(MediaAsset, asset_id)
                if asset is not None:
                    asset.transcode_status = "failed"
                    await session.commit()
            await q.ack(asset_id)
            if asset is not None:
                await _publish_asset_update(asset)
            return asset_id
        # Есть ещё попытки — вернуть в очередь (экспоненциальный бэкофф перед этим).
        await asyncio.sleep(min(2 ** attempt, 30))
        await q.requeue(asset_id)
        return asset_id

    # Успех: пишем метаданные варианта + постер/длительность, статус done.
    async with SessionLocal() as session:
        asset = await session.get(MediaAsset, asset_id)
        if asset is None:
            await q.ack(asset_id)
            return asset_id
        asset.variant_key = result.variant_key
        asset.variant_mime = result.variant_mime
        asset.transcode_status = "done"
        if result.poster_key is not None:
            asset.thumb_key = result.poster_key
        if result.duration is not None and asset.duration is None:
            asset.duration = result.duration
        await session.commit()
        await session.refresh(asset)
    await q.ack(asset_id)
    await _publish_asset_update(asset)
    return asset_id


async def _run() -> None:
    """Бесконечный цикл воркера: реклейм зависших → обработка джоб → пауза при пустой."""
    logger.info("transcode worker started")
    while True:
        try:
            reclaimed = await q.reclaim_stale()
            if reclaimed:
                logger.info("reclaimed stale transcode jobs: %s", reclaimed)
            processed = await process_one_job()
            if processed is None:
                await asyncio.sleep(2)  # очередь пуста — не крутим CPU впустую
        except asyncio.CancelledError:
            raise
        except Exception:
            # Любой неожиданный сбой цикла не должен убивать воркер — логируем и живём.
            logger.exception("transcode worker loop error")
            await asyncio.sleep(2)


def main() -> None:
    try:
        asyncio.run(_run())
    except KeyboardInterrupt:
        pass


if __name__ == "__main__":
    logging.basicConfig(level=logging.INFO)
    main()
