#!/usr/bin/env python3
"""Подготовка нарисованных глифов стихий к вёрстке книги.

Художник кладёт в `assets/glyphs/` по файлу на стихию (см. README рядом).
Этот модуль перед рендером:
  1. находит файл стихии (`.svg` > `.png`);
  2. для растра — обрезает по краске, добивает до квадрата, перекрашивает
     в нужный цвет (глиф рисуется чёрным, цвет книге задаёт CSS-палитра);
  3. складывает готовые варианты в `assets/glyphs/.build/` и отдаёт шаблону
     карту {slug: {hex-цвет: путь}}.

Если файла стихии нет — шаблон рисует запасной инлайновый SVG-символ, так что
книга собирается и с пустой папкой.

Отдельный запуск (пересобрать .build и посмотреть, что подхватилось):
    .venv/bin/python glyphs.py
"""
from __future__ import annotations

from pathlib import Path

BASE = Path(__file__).parent
GLYPH_DIR = BASE / "assets" / "glyphs"
BUILD_DIR = GLYPH_DIR / ".build"

# wheel — не стихия, а нарисованная диаграмма на страницу «Карта пути»;
# идёт через тот же конвейер (обрезка по краске + перекраска), но цвет у неё
# один, сепийный: это не глава, а чертёж.
SLUGS = ["balance", "air", "fire", "water", "earth", "wheel"]

# Цвет стихии на шмуцтитуле (совпадает с --accent в styles.css)
ACCENTS = {
    "balance": "#7a5c34",
    "air": "#4f6379",
    "fire": "#9c3a20",
    "water": "#235a68",
    "earth": "#566438",
    "wheel": "#6a4a2b",
}
RULE = "#ab9878"   # бледная линейка
SEPIA = "#6a4a2b"  # колофон
LIGHT = "#e0d0ab"  # полоска на титуле: он лежит на тёмной коже обложки

# Поля вокруг глифа внутри квадрата, доля стороны. Рисунки приходят с разным
# воздухом по краям — обрезаем по краске и задаём поля сами, иначе символы
# на шмуцтитулах будут разного оптического размера.
PADDING = 0.06
# Ниже этой альфы пиксель считаем фоном при обрезке (сканы/JPEG-шум).
ALPHA_FLOOR = 12
# Исходники приходят по 1000–2000 px, а в книге глиф стоит 40 мм (шмуцтитул) и
# 7 мм (полоска на титуле). Держать в PDF полный размер — это мегабайт на цвет
# и заметные тормоза при листании. 600 px на 40 мм — это ~380 dpi, с запасом.
MAX_SIDE = 600
MAX_SIDE_WHEEL = 900  # диаграмма стоит 92 мм — ей нужно больше пикселей


def _hex_to_rgb(value: str) -> tuple[int, int, int]:
    value = value.lstrip("#")
    return tuple(int(value[i:i + 2], 16) for i in (0, 2, 4))  # type: ignore[return-value]


def _to_alpha_mask(img):
    """RGBA/RGB/серый рисунок -> маска краски.

    Три способа сдачи, полярность определяем сами по рамке кадра:
      * PNG с прозрачным фоном — берём альфу;
      * белый глиф на чёрном (так рисует Nano Banana) — берём яркость;
      * чёрный глиф на белом — берём инвертированную яркость.
    """
    from PIL import Image

    img = img.convert("RGBA")
    alpha = img.getchannel("A")
    if alpha.getextrema()[0] < 250:
        return alpha

    grey = img.convert("L")
    if _border_is_dark(grey):
        return grey
    return Image.eval(grey, lambda v: 255 - v)


def _border_is_dark(grey, frac: float = 0.02) -> bool:
    """Фон читаем по рамке кадра: у глифа края всегда пустые, а центр — нет."""
    w, h = grey.size
    band = max(1, int(min(w, h) * frac))
    from PIL import ImageStat

    edges = [
        grey.crop((0, 0, w, band)), grey.crop((0, h - band, w, h)),
        grey.crop((0, 0, band, h)), grey.crop((w - band, 0, w, h)),
    ]
    means = [ImageStat.Stat(e).mean[0] for e in edges]
    return sum(means) / len(means) < 128


def _normalize(mask, max_side: int = MAX_SIDE):
    """Обрезать по краске, вписать в квадрат с одинаковыми полями и ужать."""
    from PIL import Image

    bbox = mask.point(lambda v: 255 if v > ALPHA_FLOOR else 0).getbbox()
    if bbox:
        mask = mask.crop(bbox)
    side = max(mask.size)
    canvas = int(side * (1 + 2 * PADDING))
    square = Image.new("L", (canvas, canvas), 0)
    square.paste(mask, ((canvas - mask.width) // 2, (canvas - mask.height) // 2))
    if canvas > max_side:
        square = square.resize((max_side, max_side), Image.LANCZOS)
    return square


def _tint(mask, color: str, out_path: Path) -> None:
    from PIL import Image

    tinted = Image.new("RGBA", mask.size, _hex_to_rgb(color) + (0,))
    tinted.putalpha(mask)
    out_path.parent.mkdir(parents=True, exist_ok=True)
    tinted.save(out_path, optimize=True)


def _source(slug: str) -> Path | None:
    for ext in (".svg", ".png", ".webp", ".jpg", ".jpeg"):
        path = GLYPH_DIR / f"{slug}{ext}"
        if path.exists():
            return path
    return None


def prepare(verbose: bool = False) -> dict[str, dict[str, str]]:
    """-> {slug: {hex: путь относительно BASE}}. Пустой слот = запасной SVG."""
    found: dict[str, dict[str, str]] = {}
    for slug in SLUGS:
        src = _source(slug)
        if src is None:
            if verbose:
                print(f"  {slug:8} — нет файла, рисуем запасной символ")
            continue

        # Ровно те цвета, что реально просит шаблон: акцент главы (шмуцтитул),
        # сепия (диаграмма и колофон), светлый (полоска на тёмной обложке).
        # Лишний вариант — это ещё одна картинка в каждом PDF.
        colors = {ACCENTS[slug], SEPIA, LIGHT}
        if src.suffix == ".svg":
            # SVG отдаём как есть: перекрашивать чужую вёрстку вслепую опаснее,
            # чем показать авторский цвет.
            found[slug] = {color: str(src.relative_to(BASE)) for color in colors}
            if verbose:
                print(f"  {slug:8} — {src.name} (svg, авторский цвет)")
            continue

        from PIL import Image

        mask = _normalize(_to_alpha_mask(Image.open(src)),
                          MAX_SIDE_WHEEL if slug == "wheel" else MAX_SIDE)
        variants = {}
        for color in colors:
            out = BUILD_DIR / f"{slug}--{color.lstrip('#')}.png"
            _tint(mask, color, out)
            variants[color] = str(out.relative_to(BASE))
        found[slug] = variants
        if verbose:
            print(f"  {slug:8} — {src.name} ({mask.width}px, {len(colors)} цвета)")
    return found


if __name__ == "__main__":
    print(f"глифы в {GLYPH_DIR}:")
    prepare(verbose=True)
