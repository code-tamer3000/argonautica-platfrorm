#!/usr/bin/env python3
"""Вёрстка выпускной книги-артефакта на каждого участника 1-го потока.

Читает те же данные, что и export.py (временный контейнер с прод-дампом),
раскладывает путь участника по главам-периодам экспедиции и рендерит
HTML → PDF (Jinja2 + WeasyPrint).

Запуск (venv рядом, см. README):
    .venv/bin/python render.py                 # все участники
    .venv/bin/python render.py --user <username>  # один
    .venv/bin/python render.py --html-only     # без PDF, для быстрой отладки
"""
from __future__ import annotations

import argparse
import json
import os
import re
import sys
from dataclasses import dataclass, field
from datetime import date
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent))
import glyphs as glyph_assets  # noqa: E402
import hexagrams as hexagram_data  # noqa: E402
import paper as paper_assets  # noqa: E402
from export import run_sql  # noqa: E402  (тот же docker exec psql)

BASE = Path(__file__).parent
PRIVATE_DIR = Path(os.environ.get("GRADUATION_PRIVATE_DIR", Path.home() / "private" / "byubye_artefact"))
OUT_DIR = PRIVATE_DIR / "exports" / "pdf"
HTML_DIR = PRIVATE_DIR / "exports" / "html"
KEYS_OVERRIDE = PRIVATE_DIR / "config" / "keys.json"
NAMES_OVERRIDE = PRIVATE_DIR / "config" / "names.json"

STREAM_TASK_ID = 27

# Границы периодов экспедиции. Период стихии открывается датой создания её
# элементного задания (task 1/8/25/29), всё до первого задания — «Точка баланса».
#
# start/end — что собираем, show_* — что печатаем. Экспедиция объявлена со 2 по
# 29 июля, но одна запись сделана 1-го, а крайние главы захватывают хвосты:
# сбор держим шире объявленных дат, чтобы ничего не потерять.
PERIODS = [
    dict(slug="balance", title="Точка баланса", lock_task=None,
         start=date(2026, 7, 1), end=date(2026, 7, 6),
         show_start=date(2026, 7, 2)),
    dict(slug="air", title="Воздух", lock_task=1,
         start=date(2026, 7, 7), end=date(2026, 7, 12)),
    dict(slug="fire", title="Огонь", lock_task=8,
         start=date(2026, 7, 13), end=date(2026, 7, 17)),
    dict(slug="water", title="Вода", lock_task=25,
         start=date(2026, 7, 18), end=date(2026, 7, 24)),
    dict(slug="earth", title="Земля", lock_task=29,
         start=date(2026, 7, 25), end=date(2026, 7, 31),
         show_end=date(2026, 7, 29)),
]

TASK_TYPE_LABELS = {
    "common": "общее задание",
    "individual": "личное задание",
    "pair": "парное задание",
    "stream": "поток",
}

JOURNAL_LABELS = {
    "focus": "Фокус на день",
    "notes": "Заметки",
    "film": "Фильм дня",
    "nowday": "О чём сегодняшний день",
    "deal": "Чем я занимаюсь",
    "air": "День через стихию Воздуха",
}

MONTHS_GEN = {
    1: "января", 2: "февраля", 3: "марта", 4: "апреля", 5: "мая", 6: "июня",
    7: "июля", 8: "августа", 9: "сентября", 10: "октября", 11: "ноября",
    12: "декабря",
}

EMOJI_RE = re.compile(
    "[\U0001F000-\U0001FAFF←-⇿⌀-➿⬀-⯿"
    "️‍⃣™☀-⛿]+"
)
MARKER_RE = re.compile(r"^<!--journal:([a-z0-9_]+)-->\s*", re.DOTALL)
HEADING_RE = re.compile(r"^##+\s*(.*?)\s*$", re.MULTILINE)

# «57 генный замок», «Замок номер 23», «выпал 21 ключ», «13-й генный ключ»
KEY_PATTERNS = [
    re.compile(r"(?:ген\w*\s+)?(?:замо?к|ключ)\w*\s*(?:номер|№)?\s*[-–—:]?\s*(\d{1,2})\b", re.I),
    re.compile(r"\b(\d{1,2})\s*[-–—]?\s*(?:й|ый|ой)?\s*(?:ген\w+\s+)?(?:замо?к|ключ)", re.I),
]


# --------------------------------------------------------------------------- #
# текст
# --------------------------------------------------------------------------- #
def clean(text: str | None) -> str:
    """Убирает эмодзи (в системе нет emoji-шрифта), правит типографику."""
    if not text:
        return ""
    text = EMOJI_RE.sub("", text)
    text = re.sub(r"[ \t]+", " ", text)
    text = re.sub(r"\n{3,}", "\n\n", text)
    # прямые кавычки -> ёлочки, дефис между слов -> тире, многоточие
    text = re.sub(r'"([^"\n]+)"', "«\\1»", text)
    text = re.sub(r"(?<=[\s(])-(?=\s)", "—", text)
    text = text.replace("...", "…")
    text = re.sub(r"\s+([,.;:!?])", "\\1", text)
    return text.strip()


def paragraphs(text: str) -> list[list[str]]:
    """Абзацы -> строки внутри абзаца (одиночный перенос сохраняем как <br>)."""
    out = []
    for block in re.split(r"\n\s*\n", clean(text)):
        lines = [ln.strip() for ln in block.split("\n") if ln.strip()]
        if lines:
            out.append(lines)
    return out


def strip_headings(text: str) -> str:
    return HEADING_RE.sub("", text or "")


def first_sentence(text: str, lo: int = 55, hi: int = 190) -> str:
    """Цитата для шмуцтитула: первое «плотное» предложение.

    Пропускаем служебное начало вида «57 генный замок» — номер ключа и так
    стоит в подписи шмуцтитула.
    """
    flat = clean(strip_headings(text))
    flat = re.sub(r"\s+", " ", flat)
    for raw in re.split(r"(?<=[.!?…])\s+|\n+", flat):
        s = raw.strip(" -—«»\"'")
        if not (lo <= len(s) <= hi) or re.fullmatch(r"[\d\s\W]*", s):
            continue
        if any(p.match(s) for p in KEY_PATTERNS):
            continue
        return s
    if flat:
        cut = flat[:hi].rsplit(" ", 1)[0]
        return cut + ("…" if len(flat) > len(cut) else "")
    return ""


def drop_key_line(text: str) -> str:
    """Служебная первая строка вида «57 генный замок» уходит из тела: номер
    ключа и так стоит в подписи шмуцтитула, а на её месте начинается буквица."""
    lines = text.split("\n")
    for i, line in enumerate(lines):
        if not line.strip():
            continue
        if len(line.strip()) <= 45 and parse_gene_key(line) is not None:
            return "\n".join(lines[i + 1:]).strip()
        break
    return text


def parse_gene_key(text: str) -> int | None:
    flat = clean(text)
    for pattern in KEY_PATTERNS:
        for m in pattern.finditer(flat):
            n = int(m.group(1))
            if 1 <= n <= 64:
                return n
    return None


def ru_date(d: date) -> str:
    return f"{d.day} {MONTHS_GEN[d.month]}"


def ru_range(a: date, b: date) -> str:
    if a.month == b.month:
        return f"{a.day}–{b.day} {MONTHS_GEN[a.month]}"
    return f"{ru_date(a)} — {ru_date(b)}"


# --------------------------------------------------------------------------- #
# данные
# --------------------------------------------------------------------------- #
@dataclass
class Day:
    day: date
    sections: list[dict] = field(default_factory=list)


EXTRA_USERNAMES = [u for u in os.environ.get("GRADUATION_EXTRA_USERNAMES", "").split(",") if u.strip()]


def fetch_users() -> list[dict]:
    extra = ", ".join("'" + u.strip().replace("'", "") + "'" for u in EXTRA_USERNAMES) or "''"
    return run_sql(f"""
        SELECT json_agg(row_to_json(t)) FROM (
            SELECT id, username, display_name FROM users
            WHERE (role = 'participant' AND is_observer = false)
               OR username IN ({extra})
            ORDER BY id
        ) t;
    """) or []


def fetch_diary() -> dict[int, list[dict]]:
    """Записи личных дневников, ТОЛЬКО авторства хозяина комнаты.

    Личная комната видна всей когорте и в ней есть ответы других участников
    (37 штук на весь поток) — в личную книгу они не идут.
    """
    rows = run_sql("""
        SELECT json_agg(row_to_json(t)) FROM (
            SELECT r.created_by AS user_id, m.content, m.created_at
            FROM messages m
            JOIN rooms r ON r.id = m.room_id
            WHERE r.is_personal
              AND m.deleted_at IS NULL
              AND m.sender_id = r.created_by
            ORDER BY m.created_at
        ) t;
    """) or []
    by_user: dict[int, list[dict]] = {}
    for row in rows:
        by_user.setdefault(row["user_id"], []).append(row)
    return by_user


def fetch_submissions() -> dict[int, list[dict]]:
    rows = run_sql("""
        SELECT json_agg(row_to_json(t)) FROM (
            SELECT ta.user_id, t.id AS task_id, t.type, t.title,
                   t.created_at AS task_created_at, ta.status, sub.body
            FROM task_assignments ta
            JOIN tasks t ON t.id = ta.task_id AND t.deleted_at IS NULL
            JOIN LATERAL (
                SELECT body, created_at FROM task_submissions s
                WHERE s.assignment_id = ta.id ORDER BY s.created_at DESC LIMIT 1
            ) sub ON true
            ORDER BY t.created_at, t.id
        ) t;
    """) or []
    by_user: dict[int, list[dict]] = {}
    for row in rows:
        by_user.setdefault(row["user_id"], []).append(row)
    return by_user


def fetch_stream() -> dict[int, list[dict]]:
    rows = run_sql(f"""
        SELECT json_agg(row_to_json(t)) FROM (
            SELECT user_id, version, body
            FROM task_stream_texts
            WHERE task_id = {STREAM_TASK_ID}
            ORDER BY user_id, version
        ) t;
    """) or []
    by_user: dict[int, list[dict]] = {}
    for row in rows:
        by_user.setdefault(row["user_id"], []).append(row)
    return by_user


def build_days(messages: list[dict]) -> list[Day]:
    """Сообщение дневника -> секция дня. Заголовок берём из самого тела
    (`## Фокус на день`), ключ маркера — только как запасной вариант."""
    by_date: dict[date, Day] = {}
    for m in messages:
        raw = m["content"] or ""
        match = MARKER_RE.match(raw)
        key = match.group(1) if match else None
        body = raw[match.end():] if match else raw

        heading = None
        hm = HEADING_RE.search(body)
        if hm and hm.start() < 40:
            heading = clean(hm.group(1))
            body = body[:hm.start()] + body[hm.end():]

        if key == "film":
            label = JOURNAL_LABELS["film"]
            candidate = heading or clean(body)
            # обычно это название фильма одной строкой, но иногда человек
            # писал сюда целый абзац — такой текст верстаем как прозу
            if len(candidate) <= 90:
                title, body = candidate, ""
            else:
                title, body = None, candidate
        else:
            label = heading or JOURNAL_LABELS.get(key or "", "Запись")
            title = None

        body = clean(strip_headings(body))
        if not body and not title:
            continue

        d = date.fromisoformat(m["created_at"][:10])
        day = by_date.setdefault(d, Day(day=d))
        # человек мог дописать «Заметки» второй раз за день — не повторяем ярлык
        if day.sections and title is None:
            prev = day.sections[-1]
            if prev["label"] == label and prev["title"] is None:
                prev["paragraphs"].extend(paragraphs(body))
                continue
        day.sections.append(dict(
            kind=key or "free",
            label=label,
            title=title,
            paragraphs=paragraphs(body),
        ))
    return [by_date[d] for d in sorted(by_date)]


def build_book(user: dict, diary, submissions, stream, overrides, hexes,
               names) -> dict:
    username = user["username"]
    over = overrides.get(username, {})
    days = build_days(diary.get(user["id"], []))
    subs = submissions.get(user["id"], [])
    subs_by_task = {s["task_id"]: s for s in subs}

    chapters = []
    # slug -> None или карточка ключа с гексаграммой (см. hexagrams.py)
    keys: dict[str, dict | None] = {}
    for period in PERIODS:
        lock = subs_by_task.get(period["lock_task"]) if period["lock_task"] else None
        lock_raw = clean(strip_headings(lock["body"])) if lock and lock.get("body") else ""

        # Есть запись в keys.json — она и есть истина: таблица собрана сплошным
        # поиском по всей БД (ЛС, дневники, комментарии), а регулярка видит
        # только сдачу задания и ловит ложные числа. Прочерк в таблице значит
        # «человек нигде номер не назвал», а не «поищи сам».
        key = over.get("keys", {}).get(period["slug"])
        if key is None and lock_raw and username not in overrides:
            key = parse_gene_key(lock_raw)
        lock_body = drop_key_line(lock_raw) if key else lock_raw
        # Номер сам по себе — просто цифра; гексаграмма и имя ключа берутся из
        # тех же данных, что рисует виджет «Генные Ключи» на платформе.
        key_card = hexes.get(str(key)) if key else None
        keys[period["slug"]] = key_card

        ch_days = [d for d in days if period["start"] <= d.day <= period["end"]]

        ch_tasks = []
        for s in subs:
            t_date = date.fromisoformat(s["task_created_at"][:10])
            if not (period["start"] <= t_date <= period["end"]):
                continue
            if s["task_id"] in (period["lock_task"], STREAM_TASK_ID):
                continue
            body = clean(strip_headings(s.get("body")))
            if not body:
                continue
            ch_tasks.append(dict(
                title=clean(s["title"]),
                type_label=TASK_TYPE_LABELS.get(s["type"], s["type"]),
                paragraphs=paragraphs(body),
            ))

        stream_versions = []
        if period["slug"] == "water":
            for t in stream.get(user["id"], []):
                body = clean(strip_headings(t["body"]))
                if body:
                    stream_versions.append(dict(
                        version=t["version"], paragraphs=paragraphs(body)))

        quote = over.get("quotes", {}).get(period["slug"])
        if not quote:
            source = lock_body
            if not source and ch_days:
                source = "\n".join(
                    " ".join(" ".join(p) for p in sec["paragraphs"])
                    for sec in ch_days[0].sections)
            quote = first_sentence(source)

        chapters.append(dict(
            slug=period["slug"],
            title=period["title"],
            dates=ru_range(period.get("show_start", period["start"]),
                           period.get("show_end", period["end"])),
            key=key,
            key_card=key_card,
            quote=quote,
            lock=dict(
                title=clean(lock["title"]) if lock else "",
                paragraphs=paragraphs(lock_body),
            ) if lock_body else None,
            days=[dict(
                day_num=d.day.day,
                month=MONTHS_GEN[d.day.month],
                iso=d.day.isoformat(),
                sections=d.sections,
            ) for d in ch_days],
            tasks=ch_tasks,
            stream_versions=stream_versions,
        ))

    total_tasks = sum(len(c["tasks"]) + (1 if c["lock"] else 0) for c in chapters)
    words = sum(
        len(" ".join(" ".join(p) for p in sec["paragraphs"]).split())
        for d in days for sec in d.sections)
    return dict(
        username=username,
        # В БД display_name почти у всех = логин; книга подписывается человеческим
        # именем из names.json, БД остаётся запасным вариантом.
        display_name=(names.get(username) or "").strip()
                     or clean(user["display_name"]) or username,
        chapters=chapters,
        gene_keys=keys,
        stats=dict(days=len(days), tasks=total_tasks, words=words,
                   stream=bool(stream.get(user["id"]))),
    )


# --------------------------------------------------------------------------- #
# рендер
# --------------------------------------------------------------------------- #
def pdf_name(book: dict) -> str:
    """Имя файла — это подпись на подарке, а не техническая метка.

    Берём то же имя, что стоит на титуле (`names.json`, иначе ник). Символы,
    запрещённые в именах файлов Windows/macOS, заменяем на пробел: книги уедут
    людям в мессенджеры, и имя должно пережить любую систему.
    """
    label = re.sub(r'[\\/:*?"<>|]+', " ", book["display_name"])
    label = re.sub(r"\s+", " ", label).strip(" .")
    return f"Артефакт из Экспедиции — {label or book['username']}.pdf"


def render(books: list[dict], html_only: bool) -> None:
    from jinja2 import Environment, FileSystemLoader, select_autoescape

    env = Environment(
        loader=FileSystemLoader(BASE / "templates"),
        autoescape=select_autoescape(["html"]),
        trim_blocks=True, lstrip_blocks=True,
    )
    template = env.get_template("book.html.j2")
    css_text = (BASE / "assets" / "styles.css").read_text(encoding="utf-8")
    drawn = glyph_assets.prepare(verbose=True)
    print(f"глифы: {', '.join(drawn) if drawn else 'нет — запасные символы'}")
    textures = paper_assets.prepare(verbose=True)

    HTML_DIR.mkdir(parents=True, exist_ok=True)
    if not html_only:
        OUT_DIR.mkdir(parents=True, exist_ok=True)
        from weasyprint import HTML

    for book in books:
        html = template.render(book=book, css=css_text, glyphs=drawn,
                               paper=textures)
        html_path = HTML_DIR / f"{book['username']}.html"
        html_path.write_text(html, encoding="utf-8")
        if html_only:
            print(f"html  {html_path}")
            continue
        pdf_path = OUT_DIR / pdf_name(book)
        HTML(string=html, base_url=str(BASE)).write_pdf(pdf_path)
        print(f"pdf   {pdf_path}  ({book['stats']['days']} дней, "
              f"{book['stats']['tasks']} заданий)")


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--user", action="append", help="username (можно несколько раз)")
    ap.add_argument("--html-only", action="store_true")
    args = ap.parse_args()

    overrides = json.loads(KEYS_OVERRIDE.read_text(encoding="utf-8")) \
        if KEYS_OVERRIDE.exists() else {}

    users = fetch_users()
    if args.user:
        wanted = set(args.user)
        users = [u for u in users if u["username"] in wanted]
        missing = wanted - {u["username"] for u in users}
        if missing:
            sys.exit(f"нет таких участников: {', '.join(sorted(missing))}")

    names = json.loads(NAMES_OVERRIDE.read_text(encoding="utf-8")) \
        if NAMES_OVERRIDE.exists() else {}
    nameless = sorted(u["username"] for u in users
                      if not (names.get(u["username"]) or "").strip())
    if nameless:
        print(f"без имени (подпишутся логином): {', '.join(nameless)}")

    hexes = hexagram_data.load(verbose=True)
    diary, submissions, stream = fetch_diary(), fetch_submissions(), fetch_stream()
    books = [build_book(u, diary, submissions, stream, overrides, hexes, names)
             for u in users]
    render(books, args.html_only)


if __name__ == "__main__":
    main()
