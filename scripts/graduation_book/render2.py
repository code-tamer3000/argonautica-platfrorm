#!/usr/bin/env python3
"""Черновая вёрстка книги-артефакта для 2-го потока (intake_id=2), тарифы
Игрок/Спецотряд. НЕ финальный скрипт — обкатка на одном участнике, чтобы
посмотреть, работает ли: (а) периоды от дат заданий-замков 39/49/54/79,
(б) дневник = личная комната + Палуба (промаркированные посты, remainder
export2.py уже фильтрует), (в) фото из этих же постов, встроенные в книгу.

Текстовые утилиты (clean/paragraphs/prose и т.п.) и шаблон/глифы/бумага
переиспользуются из 1-го потока как есть — там ничего потокового нет.
Данные тянутся НЕ из локального дампа, а прямо с прода по ssh (export2.run_sql).

Фото: для черновика скачаны вручную через одноразовый mc-контейнер на сервере
в assets/photos_draft/<username>/<исходное_имя_файла>. Финальный скрипт должен
делать это сам для всех 17-18 участников — здесь только чтобы посмотреть, как
это ляжет в вёрстку.
"""
from __future__ import annotations

import argparse
import json
import os
import sys
from dataclasses import dataclass, field
from datetime import date
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent))
import glyphs as glyph_assets  # noqa: E402
import hexagrams as hexagram_data  # noqa: E402
import paper as paper_assets  # noqa: E402
from export2 import (  # noqa: E402  (ssh docker exec psql на прод)
    MANUAL_KEYS, PALUBA_ROOM_ID, run_sql,
)
from render import (  # noqa: E402  (переиспользуем текстовые утилиты 1-го потока)
    HEADING_RE, JOURNAL_LABELS, MARKER_RE, MONTHS_GEN, TASK_TYPE_LABELS,
    Day, clean, drop_key_line, first_sentence, paragraphs, ru_range,
    strip_headings,
)

BASE = Path(__file__).parent
PRIVATE_DIR = Path(os.environ.get("GRADUATION_PRIVATE_DIR", Path.home() / "private" / "byubye_artefact"))
OUT_DIR = PRIVATE_DIR / "exports2" / "pdf"
HTML_DIR = PRIVATE_DIR / "exports2" / "html"
PHOTOS_DIR = PRIVATE_DIR / "photos_draft"
NAMES_OVERRIDE = PRIVATE_DIR / "config" / "names.json"

# Периоды от дат создания заданий-замков 39/49/54/79 (подтверждено в задаче):
# начало периода = дата создания элементного задания, конец = день перед
# созданием следующего. Поток объявлен 31.08–27.09.2026.
PERIODS = [
    dict(slug="balance", title="Точка баланса", lock_task=None,
         start=date(2026, 8, 31), end=date(2026, 9, 4)),
    dict(slug="air", title="Воздух", lock_task=39,
         start=date(2026, 9, 5), end=date(2026, 9, 10)),
    dict(slug="fire", title="Огонь", lock_task=49,
         start=date(2026, 9, 11), end=date(2026, 9, 16)),
    dict(slug="water", title="Вода", lock_task=54,
         start=date(2026, 9, 17), end=date(2026, 9, 22)),
    dict(slug="earth", title="Земля", lock_task=79,
         start=date(2026, 9, 23), end=date(2026, 9, 27)),
]


# --------------------------------------------------------------------------- #
# данные (с прода по ssh, read-only)
# --------------------------------------------------------------------------- #
def fetch_user(username: str) -> dict:
    rows = run_sql(f"""
        SELECT json_agg(row_to_json(t)) FROM (
            SELECT u.id, u.username, u.display_name
            FROM users u WHERE u.username = '{username}'
        ) t;
    """)
    if not rows:
        sys.exit(f"нет такого участника: {username}")
    return rows[0]


def fetch_personal_room(user_id: int):
    rows = run_sql(f"""
        SELECT json_agg(row_to_json(t)) FROM (
            SELECT id FROM rooms WHERE is_personal = true AND created_by = {user_id}
        ) t;
    """)
    return rows[0]["id"] if rows else None


def fetch_diary_messages(user_id: int) -> list[dict]:
    """Личная комната (все сообщения автора) + Палуба (только промаркированные —
    остальное там чат/благодарности, не дневник). Схема та же, что в export2.py."""
    personal_room_id = fetch_personal_room(user_id)
    room_filter = f"room_id = {personal_room_id}" if personal_room_id else "false"
    rows = run_sql(f"""
        SELECT json_agg(row_to_json(t)) FROM (
            SELECT id, room_id, content, created_at
            FROM messages
            WHERE sender_id = {user_id} AND deleted_at IS NULL
              AND ({room_filter} OR room_id = {PALUBA_ROOM_ID})
            ORDER BY created_at
        ) t;
    """) or []
    out = []
    for m in rows:
        if m["room_id"] == PALUBA_ROOM_ID and not MARKER_RE.match(m["content"] or ""):
            continue
        out.append(m)
    return out


def fetch_attachments(message_ids: list[int]) -> dict[int, list[dict]]:
    if not message_ids:
        return {}
    ids = ",".join(str(i) for i in message_ids)
    rows = run_sql(f"""
        SELECT json_agg(row_to_json(t)) FROM (
            SELECT ma.message_id, med.bucket, med.storage_key, med.kind
            FROM message_attachments ma
            JOIN media_assets med ON med.id = ma.media_asset_id
            WHERE ma.message_id IN ({ids})
        ) t;
    """) or []
    out: dict[int, list[dict]] = {}
    for r in rows:
        out.setdefault(r["message_id"], []).append(r)
    return out


def fetch_locks(user_id: int) -> dict[str, dict]:
    rows = run_sql(f"""
        SELECT json_agg(row_to_json(t)) FROM (
            SELECT element, key_number, hexagram
            FROM expedition_locks WHERE user_id = {user_id}
        ) t;
    """) or []
    return {r["element"]: r for r in rows}


def fetch_submissions(user_id: int) -> list[dict]:
    rows = run_sql(f"""
        SELECT json_agg(row_to_json(t)) FROM (
            SELECT t.id AS task_id, t.type, t.title,
                   t.created_at AS task_created_at, ta.status, sub.body
            FROM task_assignments ta
            JOIN tasks t ON t.id = ta.task_id AND t.deleted_at IS NULL
            LEFT JOIN LATERAL (
                SELECT body, created_at FROM task_submissions s
                WHERE s.assignment_id = ta.id
                ORDER BY (length(coalesce(s.body, '')) > 0) DESC, s.created_at DESC LIMIT 1
            ) sub ON true
            WHERE ta.user_id = {user_id}
            ORDER BY t.created_at, t.id
        ) t;
    """) or []
    return rows


def local_photo(username: str, storage_key: str) -> str | None:
    """Черновик: фото уже лежат локально в assets/photos_draft/<user>/<basename>,
    скачаны вручную одноразовым mc-контейнером на сервере (см. докстринг файла).
    Финальный скрипт должен качать их сам для всех участников."""
    name = storage_key.rsplit("/", 1)[-1]
    p = PHOTOS_DIR / username / name
    return str(p.relative_to(BASE)) if p.exists() else None


# --------------------------------------------------------------------------- #
# сборка дней/секций (тот же принцип, что build_days в render.py, +фото)
# --------------------------------------------------------------------------- #
def build_days(messages: list[dict], attachments: dict[int, list[dict]],
               username: str) -> list[Day]:
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

        label = heading or JOURNAL_LABELS.get(key or "", "Запись")
        body = clean(strip_headings(body))

        images = []
        for a in attachments.get(m["id"], []):
            if a["kind"] != "image":
                continue
            path = local_photo(username, a["storage_key"])
            if path:
                images.append(path)

        if not body and not images:
            continue

        d = date.fromisoformat(m["created_at"][:10])
        day = by_date.setdefault(d, Day(day=d))
        day.sections.append(dict(
            kind=key or "free", label=label, title=None,
            paragraphs=paragraphs(body), images=images,
        ))
    return [by_date[d] for d in sorted(by_date)]


def build_book(user: dict, days: list[Day], subs: list[dict], names) -> dict:
    username = user["username"]
    locks = fetch_locks(user["id"])
    subs_by_task = {s["task_id"]: s for s in subs}

    chapters = []
    keys: dict[str, dict | None] = {}
    hexes = hexagram_data.load()
    for period in PERIODS:
        lock = subs_by_task.get(period["lock_task"]) if period["lock_task"] else None
        lock_raw = clean(strip_headings(lock["body"])) if lock and lock.get("body") else ""

        element = period["slug"]
        loc = locks.get(element)
        manual = MANUAL_KEYS.get((username, element))
        key = loc["key_number"] if loc else manual
        lock_body = drop_key_line(lock_raw) if key else lock_raw
        key_card = hexes.get(str(key)) if key else None
        keys[element] = key_card

        ch_days = [d for d in days if period["start"] <= d.day <= period["end"]]

        ch_tasks = []
        for s in subs:
            if not s.get("task_created_at"):
                continue
            t_date = date.fromisoformat(s["task_created_at"][:10])
            if not (period["start"] <= t_date <= period["end"]):
                continue
            if s["task_id"] == period["lock_task"]:
                continue
            body = clean(strip_headings(s.get("body")))
            if not body:
                continue
            ch_tasks.append(dict(
                title=clean(s["title"]),
                type_label=TASK_TYPE_LABELS.get(s["type"], s["type"]),
                paragraphs=paragraphs(body),
            ))

        source = lock_body
        if not source and ch_days:
            source = "\n".join(
                " ".join(" ".join(p) for p in sec["paragraphs"])
                for sec in ch_days[0].sections)
        quote = first_sentence(source or "")

        chapters.append(dict(
            slug=period["slug"], title=period["title"],
            dates=ru_range(period["start"], period["end"]),
            key=key, key_card=key_card, quote=quote,
            lock=dict(
                title=clean(lock["title"]) if lock else "",
                paragraphs=paragraphs(lock_body),
            ) if lock_body else None,
            days=[dict(
                day_num=d.day.day, month=MONTHS_GEN[d.day.month],
                iso=d.day.isoformat(), sections=d.sections,
            ) for d in ch_days],
            tasks=ch_tasks,
            stream_versions=[],
        ))

    total_tasks = sum(len(c["tasks"]) + (1 if c["lock"] else 0) for c in chapters)
    words = sum(
        len(" ".join(" ".join(p) for p in sec["paragraphs"]).split())
        for d in days for sec in d.sections)
    return dict(
        username=username,
        display_name=(names.get(username) or "").strip()
                     or clean(user["display_name"]) or username,
        chapters=chapters, gene_keys=keys,
        stats=dict(days=len(days), tasks=total_tasks, words=words, stream=False),
        stream_label="авторитетный поток",
        stream_dates="31 августа — 27 сентября 2026",
        stream_completed="с 31 августа по 27 сентября 2026 года",
    )


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
    textures = paper_assets.prepare(verbose=True)

    HTML_DIR.mkdir(parents=True, exist_ok=True)
    if not html_only:
        OUT_DIR.mkdir(parents=True, exist_ok=True)
        from weasyprint import HTML

    for book in books:
        html = template.render(book=book, css=css_text, glyphs=drawn, paper=textures)
        html_path = HTML_DIR / f"{book['username']}.html"
        html_path.write_text(html, encoding="utf-8")
        if html_only:
            print(f"html  {html_path}")
            continue
        pdf_path = OUT_DIR / f"{book['username']}.pdf"
        HTML(string=html, base_url=str(BASE)).write_pdf(pdf_path)
        print(f"pdf   {pdf_path}  ({book['stats']['days']} дней, "
              f"{book['stats']['tasks']} заданий)")


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--user", required=True)
    ap.add_argument("--html-only", action="store_true")
    args = ap.parse_args()

    names = json.loads(NAMES_OVERRIDE.read_text(encoding="utf-8")) \
        if NAMES_OVERRIDE.exists() else {}

    user = fetch_user(args.user)
    messages = fetch_diary_messages(user["id"])
    attachments = fetch_attachments([m["id"] for m in messages])
    days = build_days(messages, attachments, user["username"])
    subs = fetch_submissions(user["id"])
    book = build_book(user, days, subs, names)
    render([book], args.html_only)


if __name__ == "__main__":
    main()
