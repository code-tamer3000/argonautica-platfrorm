#!/usr/bin/env python3
"""Фактура бумаги под блок и обложка на титул.

Художник кладёт в `assets/paper/`:
  * `page.*`  — скан старой бумаги, фон всех страниц;
  * `cover.*` — обложка пиратского дневника, фон только титула.

Оба файла приходят «сфотографированными на подложке»: вокруг листа видна рамка
фона и тень. На странице она читалась бы как грязная кайма, поэтому здесь края
срезаются, картинка ужимается до разумного для экранного PDF разрешения и
кладётся в `.build/`.

Если файла нет — страница остаётся на плоском кремовом `--paper`, книга
собирается как раньше.

Отдельный запуск:
    .venv/bin/python paper.py
"""
from __future__ import annotations

from pathlib import Path

BASE = Path(__file__).parent
PAPER_DIR = BASE / "assets" / "paper"
BUILD_DIR = PAPER_DIR / ".build"

# Доля кадра, срезаемая с каждой стороны: убирает подложку и тень по периметру.
# У обложки поля уже, чем у листа, — иначе срежет латунные уголки.
CROP = {"page": 0.045, "cover": 0.03}
# Картинки приходят 3:4 (ближайшее к A4, что умеет генератор), страница — A4.
# Досаживаем до пропорций страницы здесь: WeasyPrint на @page считает
# background-size: cover как contain, и без этого по краям остаются полосы.
A4_RATIO = 210 / 297
# Ширина картинки. Книга экранная и фактура мягкая, поэтому 1000 px на A4
# (~120 dpi) визуально неотличимы от 1400, но вдвое легче: фон стоит на каждой
# странице, и его вес напрямую превращается в тормоза при листании.
TARGET_W = 1000
QUALITY = 74
# Лёгкое размытие фактуры, радиус в пикселях уже ужатой картинки. Скан снят
# резко, и на странице его волокна спорят с засечками текста; один пиксель
# убирает этот звон, а бумага остаётся бумагой. Обложке размытие не нужно —
# кожа и латунь на титуле работают как изображение, а не как подложка.
BLUR = {"page": 1.0, "cover": 0.0}


def _source(stem: str) -> Path | None:
    for ext in (".jpg", ".jpeg", ".png", ".webp"):
        path = PAPER_DIR / f"{stem}{ext}"
        if path.exists():
            return path
    return None


def prepare(verbose: bool = False) -> dict[str, str]:
    """-> {"page": путь, "cover": путь} относительно BASE; ключа нет = файла нет."""
    from PIL import Image

    out: dict[str, str] = {}
    for stem, crop in CROP.items():
        src = _source(stem)
        if src is None:
            if verbose:
                print(f"  {stem:6} — нет файла, фон остаётся плоским")
            continue
        img = Image.open(src).convert("RGB")
        w, h = img.size
        dx, dy = int(w * crop), int(h * crop)
        img = img.crop((dx, dy, w - dx, h - dy))

        # центральный кроп до пропорций A4
        w, h = img.size
        if w / h > A4_RATIO:
            side = round((w - h * A4_RATIO) / 2)
            img = img.crop((side, 0, w - side, h))
        else:
            side = round((h - w / A4_RATIO) / 2)
            img = img.crop((0, side, w, h - side))

        if img.width > TARGET_W:
            img = img.resize(
                (TARGET_W, round(img.height * TARGET_W / img.width)),
                Image.LANCZOS)
        # после ужатия: радиус задан в пикселях итоговой картинки
        radius = BLUR.get(stem, 0.0)
        if radius:
            from PIL import ImageFilter
            img = img.filter(ImageFilter.GaussianBlur(radius))

        BUILD_DIR.mkdir(parents=True, exist_ok=True)
        dst = BUILD_DIR / f"{stem}.jpg"
        img.save(dst, "JPEG", quality=QUALITY, optimize=True)
        out[stem] = str(dst.relative_to(BASE))
        if verbose:
            print(f"  {stem:6} — {src.name} -> {img.width}×{img.height}, "
                  f"{dst.stat().st_size // 1024} КБ")
    return out


if __name__ == "__main__":
    print(f"фактуры в {PAPER_DIR}:")
    prepare(verbose=True)
