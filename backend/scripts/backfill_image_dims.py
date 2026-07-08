"""One-shot: заполнить width/height для легаси картинок в media_assets.

Размеры (`media_assets.width/height`) стали приходить от клиента не сразу — старые
картинки в БД остались с NULL. Без размеров фронтенд не может зарезервировать коробку
под `aspect-ratio` до загрузки байтов → лента прыгает, когда картинка выше догружается.
Этот скрипт проходит по картинкам без размеров, тянет **оригинал** (`storage_key`, не
thumb) из MinIO, читает размеры через Pillow (`Image.open(...).size`) и проставляет
`width/height`.

Свойства:
  * идемпотентно — берёт только `kind='image'` с `width IS NULL OR height IS NULL`,
    повторный запуск ничего лишнего не делает;
  * best-effort — если по конкретной картинке размеры не прочитались (битый файл,
    объекта нет в хранилище), пропускаем её и идём дальше, не роняя весь прогон;
  * коммитит пачками, чтобы прогресс не терялся и транзакция не пухла.

Видео здесь НЕ трогаем — у них свой путь постера (`backfill_video_posters.py`); аудио и
файлы размеров не имеют.

Запуск внутри backend-контейнера (есть пакет app и доступ к БД/MinIO):
    python scripts/backfill_image_dims.py           # все картинки без размеров
    python scripts/backfill_image_dims.py --dry-run  # только показать, сколько их
"""
from __future__ import annotations

import asyncio
import sys

from fastapi.concurrency import run_in_threadpool
from sqlalchemy import or_, select

from app.db.session import SessionLocal
from app.models.media import MediaAsset
from app.services.media import read_image_dimensions

BATCH = 50  # коммитим пачками — прогресс не теряется, транзакция не пухнет


async def main() -> None:
    dry_run = "--dry-run" in sys.argv[1:]

    async with SessionLocal() as session:
        assets = (
            (
                await session.execute(
                    select(MediaAsset)
                    .where(
                        MediaAsset.kind == "image",
                        or_(MediaAsset.width.is_(None), MediaAsset.height.is_(None)),
                    )
                    .order_by(MediaAsset.id)
                )
            )
            .scalars()
            .all()
        )

        total = len(assets)
        print(f"Картинок без размеров: {total}", file=sys.stderr)
        if dry_run or total == 0:
            return

        done = 0
        failed = 0
        for i, asset in enumerate(assets, start=1):
            # Тяжёлая операция (сеть + декодирование) — в threadpool, как в API.
            dims = await run_in_threadpool(
                read_image_dimensions, asset.bucket, asset.storage_key
            )
            if dims is None:
                failed += 1
                print(f"  ✗ #{asset.id} {asset.storage_key}", file=sys.stderr)
            else:
                asset.width, asset.height = dims
                done += 1
            if i % BATCH == 0:
                await session.commit()
                print(f"  … {i}/{total}", file=sys.stderr)
        await session.commit()

        print(
            f"Готово: размеры проставлены {done}, пропущено {failed} из {total}.",
            file=sys.stderr,
        )


if __name__ == "__main__":
    asyncio.run(main())
