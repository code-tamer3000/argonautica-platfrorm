"""One-shot: досконвертировать HEIC/HEIF-оригиналы, залитые до ARG-143.

До ARG-143 сервер не умел декодировать HEIC (Pillow без heif-опенера) — такие фото
(iPhone иногда шлёт их под видом `image/jpeg`) не только оставались без превью
(`thumb_key`/`preview_key`), но и сам оригинал не рендерился в `<img>` ни в одном
браузере, кроме Safari/iOS. Этот скрипт проходит по картинкам без `variant_key`,
открывает оригинал через тот же Pillow (`generate_image_variant`) и, если это
действительно HEIC/HEIF (проверка по байтам, не по заявленному Content-Type),
кладёт JPEG-вариант рядом и проставляет `variant_key`/`variant_mime` — `serving_key`
начинает отдавать его вместо необработанного оригинала.

Свойства:
  * идемпотентно — берёт только `kind='image'` с `variant_key IS NULL`, повторный
    запуск не переделывает готовое;
  * best-effort — обычная картинка (не HEIC) тоже проходит через это, конвертация
    для неё — no-op (`generate_image_variant` вернёт `(None, None)`), пропускаем;
  * коммитит пачками, чтобы прогресс не терялся и транзакция не пухла.

thumb_key/preview_key эта команда не трогает — для них уже есть
`backfill_thumbnails.py` и `backfill_media_derivatives.py --images`; оба начинают
успешно обрабатывать HEIC-строки той же регистрацией heif-опенера, отдельного
скрипта под них заводить не нужно. Порядок запуска не важен — независимые поля.

Запуск внутри backend-контейнера (есть пакет app и доступ к БД/MinIO):
    python scripts/backfill_heic_variant.py           # все картинки без variant_key
    python scripts/backfill_heic_variant.py --dry-run  # только показать, сколько их
"""
from __future__ import annotations

import asyncio
import sys

from fastapi.concurrency import run_in_threadpool
from sqlalchemy import select

from app.db.session import SessionLocal
from app.models.media import MediaAsset
from app.services.media import generate_image_variant

BATCH = 50  # коммитим пачками — прогресс не теряется, транзакция не пухнет


async def main() -> None:
    dry_run = "--dry-run" in sys.argv[1:]

    async with SessionLocal() as session:
        assets = (
            (
                await session.execute(
                    select(MediaAsset)
                    .where(MediaAsset.kind == "image", MediaAsset.variant_key.is_(None))
                    .order_by(MediaAsset.id)
                )
            )
            .scalars()
            .all()
        )

        total = len(assets)
        print(f"Картинок без variant_key (кандидаты на проверку HEIC): {total}", file=sys.stderr)
        if dry_run or total == 0:
            return

        converted = 0
        not_heic = 0
        for i, asset in enumerate(assets, start=1):
            # Тяжёлая операция (сеть + декодирование) — в threadpool, как в API.
            variant_key, variant_mime = await run_in_threadpool(
                generate_image_variant, asset.bucket, asset.storage_key
            )
            if variant_key is not None:
                asset.variant_key = variant_key
                asset.variant_mime = variant_mime
                converted += 1
                print(f"  ✓ #{asset.id} {asset.storage_key} → {variant_key}", file=sys.stderr)
            else:
                # Либо не HEIC (штатно, большинство строк), либо конвертация не удалась —
                # обе ветки best-effort и неотличимы отсюда (см. generate_image_variant).
                not_heic += 1
            if i % BATCH == 0:
                await session.commit()
                print(f"  … {i}/{total}", file=sys.stderr)
        await session.commit()

        print(
            f"Готово: сконвертировано {converted}, без изменений {not_heic} "
            f"(не HEIC либо сбой конвертации) из {total}.",
            file=sys.stderr,
        )


if __name__ == "__main__":
    asyncio.run(main())
