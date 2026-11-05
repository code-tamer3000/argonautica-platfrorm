#!/usr/bin/env python3
"""Гексаграммы 64 генных ключей — те же данные, что в виджете «Генные Ключи».

Единственный источник правды — `frontend/src/features/genkeys/genkeys.data.ts`
(он сам сгенерирован из markdown + таблицы Кинг Вэня, см. docs/GENE_KEYS.md).
Дублировать его в книгу руками нельзя: разойдётся с продуктом. Поэтому парсим
TS-файл регуляркой и кладём рядом кэш `hexagrams.json` — чтобы книга собралась
и в отрыве от репозитория фронтенда.

Отдельный запуск (обновить кэш):
    .venv/bin/python hexagrams.py
"""
from __future__ import annotations

import json
import re
from pathlib import Path

BASE = Path(__file__).parent
CACHE = BASE / "hexagrams.json"
SOURCE = BASE.parents[1] / "frontend" / "src" / "features" / "genkeys" / "genkeys.data.ts"

# Поля в сгенерированном TS идут фиксированным порядком, см. GeneKeyMeta.
ENTRY = re.compile(
    r'"number":\s*(\d+),\s*'
    r'"name":\s*"(.*?)",\s*'
    r'"hexagram":\s*"([01]{6})",\s*'
    r'"shadow":\s*"(.*?)",\s*'
    r'"gift":\s*"(.*?)"',
    re.S,
)


def _parse(text: str) -> dict[str, dict]:
    out = {}
    for number, name, bits, shadow, gift in ENTRY.findall(text):
        out[number] = dict(number=int(number), name=name, bits=bits,
                           shadow=shadow, gift=gift)
    return out


def load(verbose: bool = False) -> dict[str, dict]:
    """-> {"57": {number, name, bits, shadow, gift}}. Ключи строками — так их
    отдаёт json, и так же они приходят из шаблона."""
    if SOURCE.exists():
        data = _parse(SOURCE.read_text(encoding="utf-8"))
        if len(data) == 64:
            CACHE.write_text(json.dumps(data, ensure_ascii=False, indent=1),
                             encoding="utf-8")
            if verbose:
                print(f"гексаграммы: 64 из {SOURCE.name}")
            return data
        # Формат TS поехал — не гадаем, откатываемся на кэш.
        print(f"ВНИМАНИЕ: в {SOURCE.name} распознано {len(data)} ключей из 64, "
              f"беру кэш {CACHE.name}")
    if CACHE.exists():
        data = json.loads(CACHE.read_text(encoding="utf-8"))
        if verbose:
            print(f"гексаграммы: {len(data)} из кэша {CACHE.name}")
        return data
    print("ВНИМАНИЕ: гексаграмм нет — в книге останутся только номера ключей")
    return {}


if __name__ == "__main__":
    data = load(verbose=True)
    for n in ("1", "57", "64"):
        if n in data:
            k = data[n]
            print(f"  {n:>3}  {k['bits']}  {k['gift']} — {k['name']}")
