#!/usr/bin/env python3
"""Черновой экспорт «пути через экспедицию» для 2-го потока (intake_id=2),
только тарифы Игрок и Спецотряд. НЕ финальный прогон — часть замков Земли ещё
не сдана (дедлайн 27.09), делать финальную выгрузку не раньше 28.09.

В отличие от export.py (1-й поток): не работает с локальным восстановленным
дампом, а ходит на прод НАПРЯМУЮ по ssh (алиас platform-new), read-only,
через `docker exec -i docker-postgres-1 psql`. Ничего не пишет в БД, ничего
не выгружает на диск, кроме markdown в exports2/.

Дневник теперь собирается из ДВУХ комнат: личной (rooms.created_by) и общей
«Палуба» (id=173, room type=group). В личной комнате берутся все сообщения
автора как раньше; в Палубе — ТОЛЬКО с маркером <!--journal:...--> (иначе
туда попадёт обычная болтовня/благодарности, которых там полно).

Замки стихий теперь структурные — expedition_locks(user_id, element,
key_number, hexagram), вводятся на карте экспедиции, не парсятся из прозы.
Для горстки участников, у кого записи в expedition_locks нет, номер (если
однозначно назван) взят руками из текста сдачи и сложен в MANUAL_KEYS ниже
(тот же принцип, что keys.json в 1-м потоке: то, что не удалось разобрать
однозначно, остаётся пустым, а не гадается).
"""
import json
import os
import re
import subprocess
import tempfile
import time
from pathlib import Path

SSH_HOST = os.environ.get("GRADUATION_SSH_HOST", "platform-new")
DB_CONTAINER = os.environ.get("GRADUATION_DB_CONTAINER", "docker-postgres-1")
DB_USER = os.environ.get("GRADUATION_DB_USER", "app")
DB_NAME = os.environ.get("GRADUATION_DB_NAME", "platform")
INTAKE_ID = int(os.environ.get("GRADUATION_INTAKE_ID", "2"))
PRIVATE_DIR = Path(os.environ.get("GRADUATION_PRIVATE_DIR", Path.home() / "private" / "byubye_artefact"))
OUT_DIR = PRIVATE_DIR / "exports2"

PALUBA_ROOM_ID = 173

ELEMENT_TASKS = [
    ("air", 39, "🌬️ Воздух"),
    ("fire", 49, "🔥 Огонь"),
    ("water", 54, "💧 Вода"),
    ("earth", 79, "🌍 Земля"),
]

TASK_TYPE_LABELS = {
    "common": "общее",
    "individual": "личное",
    "pair": "парное",
}

# Номера, однозначно названные в тексте сдачи, но не введённые в
# expedition_locks, найденные руками. Это персональные данные участников —
# хранятся ВНЕ репозитория: $GRADUATION_PRIVATE_DIR/config/manual_keys.json,
# формат {"<username>|<element>": <номер ключа>}. Нет файла — пусто.
def _load_manual_keys():
    f = PRIVATE_DIR / "config" / "manual_keys.json"
    if not f.exists():
        return {}
    return {tuple(k.split("|", 1)): v
            for k, v in json.loads(f.read_text(encoding="utf-8")).items()}


MANUAL_KEYS = _load_manual_keys()

# Один долгоживущий SSH-коннект на весь прогон, а не по новому TCP-хендшейку
# на каждый SQL-запрос: скрипт делает ~5 запросов на человека x 18 человек,
# и с отдельным соединением на каждый запрос прод-sshd в прошлый раз оборвал
# сессию на полпути ("kex_exchange_identification: Connection closed").
SSH_CONTROL_PATH = "/tmp/export2_ssh_control.sock"
SSH_OPTS = [
    "-o", "ControlMaster=auto",
    "-o", f"ControlPath={SSH_CONTROL_PATH}",
    "-o", "ControlPersist=120",
]


def run_sql(sql: str):
    with tempfile.NamedTemporaryFile("w", suffix=".sql", delete=False) as f:
        f.write(sql)
        sql_path = f.name
    try:
        last_err = None
        for attempt in range(3):
            with open(sql_path, "r") as stdin_f:
                try:
                    result = subprocess.run(
                        ["ssh", *SSH_OPTS, SSH_HOST,
                         f"docker exec -i {DB_CONTAINER} psql -U {DB_USER} -d {DB_NAME} -t -A"],
                        stdin=stdin_f, capture_output=True, text=True, timeout=90,
                    )
                    break
                except subprocess.TimeoutExpired as e:
                    last_err = e
        else:
            raise last_err
    finally:
        Path(sql_path).unlink(missing_ok=True)
    if result.returncode != 0:
        raise RuntimeError(f"psql failed: {result.stderr}")
    out = result.stdout.strip()
    if not out:
        return []
    return json.loads(out)


def fetch_participants():
    return run_sql(f"""
        SELECT json_agg(row_to_json(t)) FROM (
            SELECT u.id, u.username, u.display_name, p.name AS plan
            FROM users u
            JOIN plans p ON p.id = u.plan_id
            WHERE u.intake_id = {INTAKE_ID} AND u.role = 'participant'
              AND p.name IN ('Игрок', 'Спецотряд')
            ORDER BY p.id, u.id
        ) t;
    """)


def fetch_locks(user_id: int):
    rows = run_sql(f"""
        SELECT json_agg(row_to_json(t)) FROM (
            SELECT element, key_number, hexagram
            FROM expedition_locks WHERE user_id = {user_id}
        ) t;
    """)
    return {r["element"]: r for r in (rows or [])}


def fetch_element_submissions(user_id: int):
    task_ids = ",".join(str(tid) for _, tid, _ in ELEMENT_TASKS)
    rows = run_sql(f"""
        SELECT json_agg(row_to_json(t)) FROM (
            SELECT ta.task_id, ta.status, sub.body
            FROM task_assignments ta
            LEFT JOIN LATERAL (
                SELECT body FROM task_submissions s
                WHERE s.assignment_id = ta.id
                ORDER BY (length(coalesce(s.body, '')) > 0) DESC, s.created_at DESC LIMIT 1
            ) sub ON true
            WHERE ta.user_id = {user_id} AND ta.task_id IN ({task_ids})
        ) t;
    """)
    return {r["task_id"]: r for r in (rows or [])}


def fetch_other_submissions(user_id: int):
    task_ids = ",".join(str(tid) for _, tid, _ in ELEMENT_TASKS)
    rows = run_sql(f"""
        SELECT json_agg(row_to_json(t)) FROM (
            SELECT t.id AS task_id, t.type, t.title, ta.status, sub.body, sub.created_at AS submitted_at
            FROM task_assignments ta
            JOIN tasks t ON t.id = ta.task_id AND t.deleted_at IS NULL
            JOIN LATERAL (
                SELECT body, created_at FROM task_submissions s
                WHERE s.assignment_id = ta.id
                ORDER BY (length(coalesce(s.body, '')) > 0) DESC, s.created_at DESC LIMIT 1
            ) sub ON true
            WHERE ta.user_id = {user_id} AND t.id NOT IN ({task_ids})
            ORDER BY t.created_at
        ) t;
    """)
    return rows or []


def fetch_personal_room(user_id: int):
    rows = run_sql(f"""
        SELECT json_agg(row_to_json(t)) FROM (
            SELECT id FROM rooms WHERE is_personal = true AND created_by = {user_id}
        ) t;
    """)
    return rows[0]["id"] if rows else None


MARKER_RE = re.compile(r"^<!--journal:([a-z0-9_]+)-->\s*(.*)$", re.DOTALL)


def fetch_diary_messages(user_id: int, personal_room_id):
    room_filter = f"room_id = {personal_room_id}" if personal_room_id else "false"
    rows = run_sql(f"""
        SELECT json_agg(row_to_json(t)) FROM (
            SELECT id, room_id, content, created_at
            FROM messages
            WHERE sender_id = {user_id} AND deleted_at IS NULL
              AND ({room_filter} OR room_id = {PALUBA_ROOM_ID})
            ORDER BY created_at
        ) t;
    """)
    rows = rows or []

    diary = []
    for m in rows:
        content = m["content"] or ""
        match = MARKER_RE.match(content)
        if m["room_id"] == PALUBA_ROOM_ID:
            if not match:
                continue  # обычная болтовня в общей комнате — не дневник
            key, body = match.group(1), match.group(2).strip()
        elif match:
            key, body = match.group(1), match.group(2).strip()
        else:
            key, body = None, content.strip()
        diary.append({
            "message_id": m["id"],
            "date": m["created_at"][:10],
            "key": key,
            "body": body,
            "source": "paluba" if m["room_id"] == PALUBA_ROOM_ID else "personal",
        })
    return diary


def fetch_attachments(message_ids):
    if not message_ids:
        return {}
    ids = ",".join(str(i) for i in message_ids)
    rows = run_sql(f"""
        SELECT json_agg(row_to_json(t)) FROM (
            SELECT ma.message_id, med.bucket, med.storage_key, med.kind, med.mime_type
            FROM message_attachments ma
            JOIN media_assets med ON med.id = ma.media_asset_id
            WHERE ma.message_id IN ({ids})
        ) t;
    """)
    out = {}
    for r in rows or []:
        out.setdefault(r["message_id"], []).append(r)
    return out


def export_user(user, room_by_user=None):
    uid, username, display_name, plan = user["id"], user["username"], user["display_name"], user["plan"]

    locks = fetch_locks(uid)
    elem_subs = fetch_element_submissions(uid)
    personal_room_id = fetch_personal_room(uid)
    diary = fetch_diary_messages(uid, personal_room_id)
    attachments_by_msg = fetch_attachments([d["message_id"] for d in diary])
    other_subs = fetch_other_submissions(uid)

    parts = [f"# {display_name} (@{username}) — {plan}\n", "## Путь через экспедицию (поток 2, черновик)\n"]

    parts.append("## Генные замки по стихиям\n")
    for element, tid, label in ELEMENT_TASKS:
        parts.append(f"### {label}\n")
        lock = locks.get(element)
        manual = MANUAL_KEYS.get((username, element))
        if lock:
            parts.append(f"_Замок №{lock['key_number']} (гексаграмма {lock['hexagram']})_\n")
        elif manual:
            parts.append(f"_Замок №{manual} (номер из текста сдачи, гексаграмма неизвестна — уточнить)_\n")
        else:
            parts.append("_Номер замка не введён на карте и не назван однозначно в тексте — уточнить._\n")
        sub = elem_subs.get(tid)
        if sub and sub.get("body"):
            parts.append(sub["body"].strip() + "\n")
        else:
            parts.append("_Задание не сдано (на момент черновой выгрузки)._\n")

    parts.append("## Дневник по дням (личный + Палуба)\n")
    if not diary:
        parts.append("_Дневник пуст._\n")
    else:
        by_date = {}
        for d in diary:
            by_date.setdefault(d["date"], []).append(d)
        for date in sorted(by_date):
            parts.append(f"### {date}\n")
            for d in by_date[date]:
                tag = " [Палуба]" if d["source"] == "paluba" else ""
                parts.append(d["body"] + tag + "\n")
                atts = attachments_by_msg.get(d["message_id"])
                if atts:
                    for a in atts:
                        parts.append(f"> 📎 {a['kind']} — `{a['bucket']}/{a['storage_key']}`\n")
            parts.append("")

    parts.append("## Ответы на остальные задания\n")
    if not other_subs:
        parts.append("_Нет сданных заданий вне разделов выше._\n")
    for s in other_subs:
        type_label = TASK_TYPE_LABELS.get(s["type"], s["type"])
        parts.append(f"### {s['title']} _({type_label}, {s['status']})_\n")
        parts.append((s.get("body") or "").strip() + "\n")

    return "\n".join(parts)


def main():
    OUT_DIR.mkdir(exist_ok=True)
    users = fetch_participants()
    print(f"{len(users)} участников (Игрок/Спецотряд)")
    for user in users:
        md = export_user(user)
        path = OUT_DIR / f"{user['username']}.md"
        path.write_text(md, encoding="utf-8")
        print(f"written {path}", flush=True)
        time.sleep(1)  # не долбить прод очередью запросов без пауз


if __name__ == "__main__":
    main()
