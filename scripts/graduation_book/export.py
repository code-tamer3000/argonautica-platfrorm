#!/usr/bin/env python3
"""Экспорт «пути через экспедицию» каждого участника: дневник, ответы на задания,
генные замки по стихиям. Читает из временного docker-контейнера с восстановленным
дампом прода (см. byubye_artefact/, README рядом). Пишет .md + .pdf на участника
в byubye_artefact/exports/.
"""
import json
import os
import re
import subprocess
from pathlib import Path

CONTAINER = "argo_prod_copy"
OUT_DIR = Path(os.environ.get("GRADUATION_PRIVATE_DIR", Path.home() / "private" / "byubye_artefact")) / "exports"

ELEMENT_TASKS = [
    (1, "🌬️ Воздух"),
    (8, "🔥 Огонь"),
    (25, "💧 Вода"),
    (29, "🌍 Земля"),
]
STREAM_TASK_ID = 27

SECTION_LABELS = {
    "focus": "🎯 Фокус на день",
    "notes": "📝 Заметки",
    "film": "🎬 Фильм дня",
}

TASK_TYPE_LABELS = {
    "common": "общее",
    "individual": "личное",
    "pair": "парное",
    "stream": "поток",
}


def run_sql(sql: str):
    result = subprocess.run(
        ["docker", "exec", "-i", CONTAINER, "psql", "-U", "postgres", "-d", "argonautica",
         "-t", "-A", "-c", sql],
        capture_output=True, text=True, check=True,
    )
    out = result.stdout.strip()
    if not out:
        return []
    return json.loads(out)


def md_escape(text: str) -> str:
    return text or ""


def build_diary_section(room_id: int) -> str:
    if room_id is None:
        return "_Личный дневник не найден._\n"
    messages = run_sql(f"""
        SELECT json_agg(row_to_json(t)) FROM (
            SELECT id, content, created_at
            FROM messages
            WHERE room_id = {room_id} AND deleted_at IS NULL
            ORDER BY created_at
        ) t;
    """)
    if not messages:
        return "_Дневник пуст._\n"

    days = {}  # date -> list of (key, body)
    marker_re = re.compile(r"^<!--journal:([a-z0-9_]+)-->\s*(.*)$", re.DOTALL)
    for m in messages:
        content = m["content"] or ""
        match = marker_re.match(content)
        date = m["created_at"][:10]
        if match:
            key, body = match.group(1), match.group(2).strip()
        else:
            key, body = None, content.strip()
        days.setdefault(date, []).append((key, body))

    lines = []
    for date in sorted(days.keys()):
        lines.append(f"### {date}\n")
        for key, body in days[date]:
            if key:
                # body already carries its own "## emoji Heading" markdown line
                lines.append(body + "\n")
            else:
                lines.append(body + "\n")
        lines.append("")
    return "\n".join(lines)


def build_submissions(user_id: int):
    subs = run_sql(f"""
        SELECT json_agg(row_to_json(t)) FROM (
            SELECT t.id AS task_id, t.type, t.title, ta.status, sub.body, sub.created_at AS submitted_at
            FROM task_assignments ta
            JOIN tasks t ON t.id = ta.task_id AND t.deleted_at IS NULL
            JOIN LATERAL (
                SELECT body, created_at FROM task_submissions s
                WHERE s.assignment_id = ta.id ORDER BY s.created_at DESC LIMIT 1
            ) sub ON true
            WHERE ta.user_id = {user_id}
            ORDER BY t.created_at
        ) t;
    """)
    return subs or []


def build_stream_texts(user_id: int):
    texts = run_sql(f"""
        SELECT json_agg(row_to_json(t)) FROM (
            SELECT version, body, created_at
            FROM task_stream_texts
            WHERE user_id = {user_id} AND task_id = {STREAM_TASK_ID}
            ORDER BY version
        ) t;
    """)
    return texts or []


def export_user(user, room_by_user):
    uid = user["id"]
    username = user["username"]
    display_name = user["display_name"]

    submissions = build_submissions(uid)
    subs_by_task = {s["task_id"]: s for s in submissions}
    element_task_ids = {tid for tid, _ in ELEMENT_TASKS}

    parts = [f"# {display_name} (@{username})\n", "## Путь через экспедицию\n"]

    # 1. Генные замки по стихиям
    parts.append("## Генные замки по стихиям\n")
    for tid, label in ELEMENT_TASKS:
        sub = subs_by_task.get(tid)
        parts.append(f"### {label}\n")
        if sub and sub.get("body"):
            parts.append(sub["body"].strip() + "\n")
        else:
            parts.append("_Задание не сдано._\n")

    # 2. Дневник по дням
    parts.append("## Дневник по дням\n")
    parts.append(build_diary_section(room_by_user.get(uid)))

    # 3. Ответы на остальные задания
    parts.append("## Ответы на остальные задания\n")
    other_subs = [s for s in submissions if s["task_id"] not in element_task_ids and s["type"] != "stream"]
    if not other_subs:
        parts.append("_Нет сданных заданий вне разделов выше._\n")
    for s in other_subs:
        type_label = TASK_TYPE_LABELS.get(s["type"], s["type"])
        parts.append(f"### {s['title']} _({type_label}, {s['status']})_\n")
        parts.append((s.get("body") or "").strip() + "\n")

    # 4. Поток
    stream_texts = build_stream_texts(uid)
    if stream_texts:
        parts.append("## Турнир «Кольцо Воды» (поток)\n")
        for t in stream_texts:
            parts.append(f"### Версия {t['version']}\n")
            parts.append(t["body"].strip() + "\n")

    return "\n".join(parts)


def main():
    OUT_DIR.mkdir(exist_ok=True)

    extra = ", ".join("'" + u.strip().replace("'", "") + "'"
                      for u in os.environ.get("GRADUATION_EXTRA_USERNAMES", "").split(",")
                      if u.strip()) or "''"
    users = run_sql(f"""
        SELECT json_agg(row_to_json(t)) FROM (
            SELECT id, username, display_name FROM users
            WHERE (role = 'participant' AND is_observer = false)
               OR username IN ({extra})
            ORDER BY id
        ) t;
    """)

    # NB: personal rooms are shared/visible across the cohort (many room_members
    # rows per room), so room_members can't tell whose diary a room is. The
    # room's owner is its creator.
    room_map = run_sql("""
        SELECT json_agg(row_to_json(t)) FROM (
            SELECT created_by AS user_id, id AS room_id
            FROM rooms
            WHERE is_personal
        ) t;
    """)
    room_by_user = {row["user_id"]: row["room_id"] for row in room_map}

    for user in users:
        md = export_user(user, room_by_user)
        md_path = OUT_DIR / f"{user['username']}.md"
        md_path.write_text(md, encoding="utf-8")
        print(f"written {md_path}")


if __name__ == "__main__":
    main()
