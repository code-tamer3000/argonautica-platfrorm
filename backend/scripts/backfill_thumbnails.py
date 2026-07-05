"""One-shot: досгенерировать превью для уже загруженных картинок.

Превью (`media_assets.thumb_key`) появились не сразу — старые картинки грузились в
ленте оригиналом. Этот скрипт проходит по всем картинкам без превью, тянет оригинал
из MinIO, ужимает и кладёт thumbnail рядом (та же функция, что и при загрузке —
`generate_image_thumbnail`), затем проставляет `thumb_key`.

Свойства:
  * идемпотентно — берёт только `kind='image'` с `thumb_key IS NULL`, повторный
    запуск ничего лишнего не делает;
  * best-effort — если по конкретной картинке превью не собралось (битый файл,
    объекта нет в хранилище), пропускаем её и идём дальше, не роняя весь прогон;
  * коммитит пачками, чтобы прогресс не терялся и транзакция не пухла.

Видео здесь НЕ трогаем — для них отдельный скрипт `backfill_video_posters.py`
(кадр через ffmpeg): у видео другой путь получения постера.

Запуск внутри backend-контейнера (есть пакет app и доступ к БД/MinIO):
    python scripts/backfill_thumbnails.py           # все картинки без превью
    python scripts/backfill_thumbnails.py --dry-run  # только показать, сколько их
"""
from __future__ import annotations

import asyncio
import sys

from fastapi.concurrency import run_in_threadpool
from sqlalchemy import select

from app.db.session import SessionLocal
from app.models.media import MediaAsset
from app.services.media import generate_image_thumbnail

BATCH = 50  # коммитим пачками — прогресс не теряется, транзакция не пухнет


async def main() -> None:
    dry_run = "--dry-run" in sys.argv[1:]

    async with SessionLocal() as session:
        assets = (
            (
                await session.execute(
                    select(MediaAsset)
                    .where(MediaAsset.kind == "image", MediaAsset.thumb_key.is_(None))
                    .order_by(MediaAsset.id)
                )
            )
            .scalars()
            .all()
        )

        total = len(assets)
        print(f"Картинок без превью: {total}", file=sys.stderr)
        if dry_run or total == 0:
            return

        done = 0
        failed = 0
        for i, asset in enumerate(assets, start=1):
            # Тяжёлая операция (сеть + декодирование) — в threadpool, как в API.
            thumb_key = await run_in_threadpool(
                generate_image_thumbnail, asset.bucket, asset.storage_key, asset.mime_type
            )
            if thumb_key is None:
                failed += 1
                print(f"  ✗ #{asset.id} {asset.storage_key}", file=sys.stderr)
            else:
                asset.thumb_key = thumb_key
                done += 1
            if i % BATCH == 0:
                await session.commit()
                print(f"  … {i}/{total}", file=sys.stderr)
        await session.commit()

        print(
            f"Готово: превью собрано {done}, пропущено {failed} из {total}.",
            file=sys.stderr,
        )


if __name__ == "__main__":
    asyncio.run(main())
