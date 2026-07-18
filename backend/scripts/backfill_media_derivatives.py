"""One-shot: догнать деривативы по историческим медиа — МЕДЛЕННО, по одному объекту.

Замеры прода: ~90% медиа-трафика — полноразмерные оригиналы. Две причины:
  * видео, залитые до серверного транскода, остались с `transcode_status IS NULL` и
    отдаются как исходники (docs/FILES.md «Транскод видео» → Rollout);
  * картинки, залитые до среднего деривата для лайтбокса, остались с
    `preview_key IS NULL` (docs/FILES.md «Превью для лайтбокса»).

Скрипт НЕ содержит своего транскодера. Для видео он просто **кормит уже существующую
очередь transcode-воркера** тем же механизмом, что и горячий путь загрузки
(`app/api/media.py::confirm_upload` → `transcode_queue.enqueue`): ставит ОДНУ джобу →
ждёт, пока воркер доведёт её до терминального состояния в БД (`transcode_status` стал
'done'/'failed') → пауза → следующая. Воркер остаётся однопоточным, ffmpeg не съедает
машину, платформа (~20–30 юзеров) продолжает жить. Для картинок — та же
`services/media.generate_image_preview`, что и на confirm, тоже по одной с паузой.

Свойства:
  * **дросселирование** — строго последовательно, пауза `--delay-seconds` (по умолчанию
    30 с) между объектами; никакого параллелизма;
  * **резюмируемость** — кандидаты выбираются ИЗ СОСТОЯНИЯ БД (`transcode_status`,
    `variant_key`, `preview_key`), файла прогресса нет: прервал и запустил снова —
    продолжит с недоделанного, готовое не переделает;
  * **dry-run по умолчанию** — без `--apply` печатается только план (сколько кандидатов,
    какого типа, суммарный объём);
  * **best-effort** — сбой на одном объекте логируется и НЕ роняет прогон; в конце сводка
    неуспешных;
  * **graceful stop** — по SIGINT доделывает текущий объект и выходит со сводкой, без
    стектрейса.

Операция строго additive: оригиналы не удаляются и не перезаписываются.

ВНИМАНИЕ (видео): требуется ЖИВОЙ transcode-воркер — сам скрипт ничего не кодирует.
Если воркер не запущен, джоба просто висит в очереди и объект отвалится по таймауту
`--job-timeout-seconds`.

Запуск внутри backend-контейнера (есть пакет app и доступ к БД/Redis/MinIO):
    python scripts/backfill_media_derivatives.py                 # план (dry-run), оба вида
    python scripts/backfill_media_derivatives.py --images --apply --limit 3
    python scripts/backfill_media_derivatives.py --videos --apply --limit 3 --delay-seconds 60
"""
from __future__ import annotations

import argparse
import asyncio
import os
import signal
import sys
from collections.abc import Awaitable, Callable
from dataclasses import dataclass, field
from time import perf_counter

# Пакет ставится как `packages = ["app"]` (без подпакетов), поэтому установленный в
# site-packages `app` неполный. Запуск `python scripts/foo.py` кладёт в sys.path только
# `scripts/` → `import app.db` цепляет неполный wheel и падает. Кладём корень бэкенда
# (родитель `scripts/`, где лежит исходный `app/`) в начало пути — берутся исходники.
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from fastapi.concurrency import run_in_threadpool  # noqa: E402
from sqlalchemy import or_, select  # noqa: E402
from sqlalchemy.ext.asyncio import AsyncSession  # noqa: E402

from app.core.config import settings  # noqa: E402
from app.db.session import SessionLocal  # noqa: E402
from app.models.media import MediaAsset  # noqa: E402
from app.services.media import generate_image_preview  # noqa: E402
from app.services.transcode_queue import enqueue as enqueue_transcode  # noqa: E402

DEFAULT_DELAY_SECONDS = 30.0
POLL_SECONDS = 5.0
PLAN_PREVIEW_ROWS = 25  # в dry-run печатаем не весь список, а голову + «и ещё N»

# Флаг graceful stop: SIGINT/SIGTERM только взводят его, текущий объект дорабатывается.
_stop_requested = False


def _request_stop(*_args: object) -> None:
    global _stop_requested
    if _stop_requested:  # второй Ctrl+C — выходим сразу
        raise KeyboardInterrupt
    _stop_requested = True
    print(
        "\n⏸  Получен сигнал остановки: доработаю текущий объект и выйду "
        "(ещё раз Ctrl+C — прервать немедленно).",
        file=sys.stderr,
    )


def _mb(size: int) -> str:
    return f"{size / 1024 / 1024:.1f} МБ"


@dataclass
class Report:
    """Итог прогона: что сделано, что нет."""

    done: int = 0
    failed: list[tuple[int, str]] = field(default_factory=list)
    elapsed: float = 0.0


async def select_video_candidates(
    session: AsyncSession, limit: int | None = None, retry_failed: bool = False
) -> list[MediaAsset]:
    """Видео без готового варианта: легаси-строки (`transcode_status IS NULL`).

    Состояние читается из БД, поэтому выборка сама по себе резюмируема: как только
    воркер довёл видео до 'done' (+ `variant_key`), оно из кандидатов исчезает.
    'processing' НЕ трогаем — это живая загрузка прямо сейчас, её и так обрабатывает
    воркер. 'failed' берём только по `--retry-failed` (обычно провал детерминирован:
    битый файл или гардрейл по размеру/длительности).
    """
    # Отдельным `IS NULL`, а не `IN (NULL, ...)`: в SQL сравнение с NULL внутри IN
    # никогда не истинно, и легаси-строки (ровно те, ради которых всё это) выпали бы.
    status_match = MediaAsset.transcode_status.is_(None)
    if retry_failed:
        status_match = or_(status_match, MediaAsset.transcode_status == "failed")
    stmt = (
        select(MediaAsset)
        .where(
            MediaAsset.kind == "video",
            MediaAsset.variant_key.is_(None),
            status_match,
        )
        .order_by(MediaAsset.id)
    )
    if limit is not None:
        stmt = stmt.limit(limit)
    return list((await session.execute(stmt)).scalars().all())


async def select_image_candidates(
    session: AsyncSession, limit: int | None = None
) -> list[MediaAsset]:
    """Картинки без среднего деривата (`preview_key IS NULL`).

    Оговорка: NULL здесь означает и «не пытались», и «дериват вышел не легче оригинала»
    (маленькая картинка — см. `generate_image_preview`). Отличить их в БД нечем, так что
    такие картинки будут перепробованы на каждом прогоне; это дёшево (одна картинка,
    один прогон) и безопасно — результат тот же NULL, ничего не портится.
    """
    stmt = (
        select(MediaAsset)
        .where(MediaAsset.kind == "image", MediaAsset.preview_key.is_(None))
        .order_by(MediaAsset.id)
    )
    if limit is not None:
        stmt = stmt.limit(limit)
    return list((await session.execute(stmt)).scalars().all())


async def _wait_for_transcode(asset_id: int, timeout: float) -> str | None:
    """Дождаться, пока воркер доведёт видео до терминального статуса в БД.

    Возвращает 'done'/'failed', либо None по таймауту (воркер не запущен / завис).
    Читаем каждый раз в НОВОЙ сессии: строку меняет другой процесс, и внутри уже
    открытой транзакции его коммит не виден.
    """
    deadline = perf_counter() + timeout
    while perf_counter() < deadline:
        await asyncio.sleep(POLL_SECONDS)
        async with SessionLocal() as session:
            status = await session.scalar(
                select(MediaAsset.transcode_status).where(MediaAsset.id == asset_id)
            )
        if status in ("done", "failed"):
            return status
    return None


async def _process_video(asset: MediaAsset, job_timeout: float) -> tuple[bool, str]:
    """Поставить одну джобу в очередь воркера и дождаться её завершения."""
    if asset.transcode_status == "failed":
        # Ретрай провалившегося: воркер закрывает 'failed'-джобу без работы
        # (`process_one_job`), поэтому сначала возвращаем статус в исходный NULL.
        async with SessionLocal() as session:
            row = await session.get(MediaAsset, asset.id)
            if row is not None:
                row.transcode_status = None
                await session.commit()
    # Ровно тот же механизм, что на горячем пути загрузки видео (api/media.py).
    await enqueue_transcode(asset.id)
    status = await _wait_for_transcode(asset.id, job_timeout)
    if status == "done":
        return True, "вариант готов"
    if status == "failed":
        return False, "воркер отметил failed (оригинал остаётся отдаваемым)"
    return False, (
        f"нет терминального статуса за {job_timeout:.0f} с — воркер запущен?"
    )


async def _process_image(asset: MediaAsset) -> tuple[bool, str]:
    """Сгенерировать средний дериват той же функцией, что и на confirm."""
    preview_key = await run_in_threadpool(
        generate_image_preview, asset.bucket, asset.storage_key, asset.mime_type
    )
    if preview_key is None:
        # Штатный исход для маленьких картинок: дериват не легче оригинала.
        return False, "превью не создано (не легче оригинала либо ошибка чтения)"
    async with SessionLocal() as session:
        row = await session.get(MediaAsset, asset.id)
        if row is None:
            return False, "строка исчезла из БД"
        row.preview_key = preview_key
        await session.commit()
    return True, f"preview_key={preview_key}"


async def _run_batch(
    assets: list[MediaAsset],
    kind_label: str,
    delay: float,
    handler: Callable[[MediaAsset], Awaitable[tuple[bool, str]]],
) -> Report:
    """Последовательно обработать список объектов с паузой между ними."""
    report = Report()
    started = perf_counter()
    total = len(assets)
    for i, asset in enumerate(assets, start=1):
        if _stop_requested:
            print(f"⏹  Остановлено перед {i}/{total}.", file=sys.stderr)
            break
        t0 = perf_counter()
        print(
            f"[{i}/{total}] {kind_label} #{asset.id} {asset.storage_key} "
            f"({_mb(asset.size)}) …",
            file=sys.stderr,
            flush=True,
        )
        try:
            ok, note = await handler(asset)
        except Exception as exc:  # noqa: BLE001 — один объект не роняет прогон
            ok, note = False, f"{type(exc).__name__}: {exc}"
        took = perf_counter() - t0
        if ok:
            report.done += 1
            print(f"    ✓ {note} ({took:.1f} с)", file=sys.stderr, flush=True)
        else:
            report.failed.append((asset.id, note))
            print(f"    ✗ {note} ({took:.1f} с)", file=sys.stderr, flush=True)
        if i < total and not _stop_requested and delay > 0:
            print(f"    … пауза {delay:.0f} с", file=sys.stderr, flush=True)
            await asyncio.sleep(delay)
    report.elapsed = perf_counter() - started
    return report


def _print_plan(videos: list[MediaAsset], images: list[MediaAsset]) -> None:
    print("План бэкфила (dry-run, ничего не изменено):", file=sys.stderr)
    for label, assets in (("видео", videos), ("картинки", images)):
        total_size = sum(a.size for a in assets)
        print(
            f"  {label}: {len(assets)} шт, суммарно {_mb(total_size)}", file=sys.stderr
        )
        for asset in assets[:PLAN_PREVIEW_ROWS]:
            print(
                f"    #{asset.id} {asset.storage_key} ({_mb(asset.size)})",
                file=sys.stderr,
            )
        if len(assets) > PLAN_PREVIEW_ROWS:
            print(
                f"    … и ещё {len(assets) - PLAN_PREVIEW_ROWS}", file=sys.stderr
            )
    print("Запустить по-настоящему: добавьте --apply.", file=sys.stderr)


def _parse_args(argv: list[str]) -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="Догнать деривативы (видео-вариант 720p / превью картинок) "
        "по историческим медиа, по одному объекту с паузой."
    )
    parser.add_argument(
        "--videos", action="store_true", help="обработать видео (транскод через воркер)"
    )
    parser.add_argument(
        "--images", action="store_true", help="обработать картинки (preview_key)"
    )
    parser.add_argument(
        "--apply",
        action="store_true",
        help="реально применить; без флага — только план (dry-run)",
    )
    parser.add_argument(
        "--limit", type=int, default=None, help="максимум объектов за прогон (на вид)"
    )
    parser.add_argument(
        "--delay-seconds",
        type=float,
        default=DEFAULT_DELAY_SECONDS,
        help=f"пауза между объектами, по умолчанию {DEFAULT_DELAY_SECONDS:.0f}",
    )
    parser.add_argument(
        "--job-timeout-seconds",
        type=float,
        default=float(settings.transcode_claim_timeout_seconds),
        help="сколько ждать воркер по одному видео (по умолчанию claim-таймаут)",
    )
    parser.add_argument(
        "--retry-failed",
        action="store_true",
        help="включить видео с transcode_status='failed' (обычно провал детерминирован)",
    )
    args = parser.parse_args(argv)
    if not args.videos and not args.images:  # ни одного вида — значит оба
        args.videos = args.images = True
    return args


async def main(argv: list[str] | None = None) -> int:
    args = _parse_args(sys.argv[1:] if argv is None else argv)

    async with SessionLocal() as session:
        videos = (
            await select_video_candidates(session, args.limit, args.retry_failed)
            if args.videos
            else []
        )
        images = (
            await select_image_candidates(session, args.limit) if args.images else []
        )

    if not args.apply:
        _print_plan(videos, images)
        return 0

    if not videos and not images:
        print("Кандидатов нет — всё уже догнано.", file=sys.stderr)
        return 0

    for sig in (signal.SIGINT, signal.SIGTERM):
        signal.signal(sig, _request_stop)

    print(
        f"Старт: видео {len(videos)}, картинки {len(images)}, "
        f"пауза {args.delay_seconds:.0f} с между объектами.",
        file=sys.stderr,
    )

    reports: list[tuple[str, Report]] = []
    if images:
        reports.append(
            ("картинки", await _run_batch(images, "картинка", args.delay_seconds, _process_image))
        )
    if videos and not _stop_requested:
        reports.append(
            (
                "видео",
                await _run_batch(
                    videos,
                    "видео",
                    args.delay_seconds,
                    lambda a: _process_video(a, args.job_timeout_seconds),
                ),
            )
        )

    print("\nИтог:", file=sys.stderr)
    for label, report in reports:
        print(
            f"  {label}: успешно {report.done}, неуспешно {len(report.failed)}, "
            f"заняло {report.elapsed:.0f} с",
            file=sys.stderr,
        )
        for asset_id, note in report.failed:
            print(f"    ✗ #{asset_id}: {note}", file=sys.stderr)
    if _stop_requested:
        print(
            "  (прогон остановлен по сигналу — повторный запуск продолжит с "
            "недоделанного)",
            file=sys.stderr,
        )
    return 0


if __name__ == "__main__":
    try:
        sys.exit(asyncio.run(main()))
    except KeyboardInterrupt:
        print("\nПрервано.", file=sys.stderr)
        sys.exit(130)
