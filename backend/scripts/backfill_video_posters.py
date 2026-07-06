"""One-shot: досгенерировать постеры (и длительность) для уже загруженных видео.

Постер видео (`media_assets.thumb_key`) снимает клиент при загрузке. Но видео, залитые
до появления этой фичи, остались без постера: в ленте `<video>` показывал вечный
скелетон/спиннер (особенно на мобиле, где первый кадр с `preload="metadata"` не
декодируется до старта воспроизведения). Этот скрипт проходит по видео без превью,
через ffmpeg вынимает кадр, ужимает в WebP (та же полка `thumbnails/`, что у картинок) и
проставляет `thumb_key`; заодно заполняет `duration`, если её не было.

Свойства:
  * идемпотентно — берёт только `kind='video'` с `thumb_key IS NULL`;
  * best-effort — если по конкретному видео кадр не собрался (нет ffmpeg, битый файл,
    объекта нет), пропускаем и идём дальше, не роняя прогон;
  * duration обновляем, даже если постер не собрался, но ffprobe дал длительность;
  * коммитит пачками, чтобы прогресс не терялся.

ВНИМАНИЕ: тянет видеофайлы на бэкенд (против принципа «байты видео мимо FastAPI»,
CLAUDE.md п.7) — это осознанный трейд-офф для офлайн-бэкфилла, НЕ горячий путь.

Запуск внутри backend-контейнера (нужен ffmpeg в образе, есть пакет app и доступ к БД/MinIO):
    python scripts/backfill_video_posters.py            # все видео без постера
    python scripts/backfill_video_posters.py --dry-run  # только показать, сколько их
"""
from __future__ import annotations

import asyncio
import os
import sys

# Пакет ставится как `packages = ["app"]` (без подпакетов), поэтому установленный в
# site-packages `app` неполный. Запуск `python scripts/foo.py` кладёт в sys.path только
# `scripts/` → `import app.db` цепляет неполный wheel и падает. Кладём корень бэкенда
# (родитель `scripts/`, где лежит исходный `app/`) в начало пути — берутся исходники.
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from fastapi.concurrency import run_in_threadpool  # noqa: E402
from sqlalchemy import select  # noqa: E402

from app.db.session import SessionLocal  # noqa: E402
from app.models.media import MediaAsset  # noqa: E402
from app.services.media import generate_video_poster  # noqa: E402

BATCH = 20  # коммитим пачками — прогресс не теряется, транзакция не пухнет


async def main() -> None:
    dry_run = "--dry-run" in sys.argv[1:]

    async with SessionLocal() as session:
        assets = (
            (
                await session.execute(
                    select(MediaAsset)
                    .where(MediaAsset.kind == "video", MediaAsset.thumb_key.is_(None))
                    .order_by(MediaAsset.id)
                )
            )
            .scalars()
            .all()
        )

        total = len(assets)
        print(f"Видео без постера: {total}", file=sys.stderr)
        if dry_run or total == 0:
            return

        done = 0
        failed = 0
        for i, asset in enumerate(assets, start=1):
            # Тяжёлая операция (скачивание + ffmpeg) — в threadpool, как в API.
            thumb_key, duration = await run_in_threadpool(
                generate_video_poster, asset.bucket, asset.storage_key
            )
            if duration is not None and asset.duration is None:
                asset.duration = duration
            if thumb_key is None:
                failed += 1
                print(f"  ✗ #{asset.id} {asset.storage_key}", file=sys.stderr)
            else:
                asset.thumb_key = thumb_key
                done += 1
                print(f"  ✓ #{asset.id} → {thumb_key}", file=sys.stderr)
            if i % BATCH == 0:
                await session.commit()
                print(f"  … {i}/{total}", file=sys.stderr)
        await session.commit()

        print(
            f"Готово: постеров собрано {done}, пропущено {failed} из {total}.",
            file=sys.stderr,
        )


if __name__ == "__main__":
    asyncio.run(main())
