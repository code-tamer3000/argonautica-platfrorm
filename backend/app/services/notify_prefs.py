"""Настройки уведомлений пользователя (пер-категорийные тумблеры).

Живут в `User.settings["notifications"]` (JSONB) — без миграций под новые ключи,
как и остальные настройки кабинета. Значения по умолчанию — всё включено: новый
пользователь получает push, пока сам не отключит.

`push_enabled` — мастер-тумблер (согласие на нативные push вообще). Пер-видовые
ключи (`dm`/`reply`/`news`/`admin`) фильтруют, что именно пушить. In-app лента
(колокольчик) этими тумблерами НЕ управляется — она есть всегда; тумблеры гасят
только нативную доставку.
"""
from typing import Any

# Виды уведомлений, которые доставляются нативным push и управляются тумблерами.
# journal_missed/cabin_granted — системные, отдельного тумблера не имеют
# (cabin_granted пушим по мастер-флагу; journal_missed нативно не пушится — он
# досоздаётся лениво при открытии ленты, событийной точки для push нет).
PUSHABLE_KINDS = ("dm", "reply", "news", "admin")

_DEFAULTS: dict[str, bool] = {
    "push_enabled": True,
    "dm": True,
    "reply": True,
    "news": True,
    "admin": True,
}


def _prefs(settings: dict[str, Any] | None) -> dict[str, Any]:
    node = (settings or {}).get("notifications")
    return node if isinstance(node, dict) else {}


def push_allowed(settings: dict[str, Any] | None, kind: str) -> bool:
    """Разрешён ли нативный push этого вида для пользователя с такими настройками.

    Мастер-флаг `push_enabled` перекрывает всё. Дальше — пер-видовой тумблер
    (по умолчанию включён). Неизвестный вид (напр. cabin_granted) — по мастер-флагу.
    """
    prefs = _prefs(settings)
    if not prefs.get("push_enabled", _DEFAULTS["push_enabled"]):
        return False
    return bool(prefs.get(kind, _DEFAULTS.get(kind, True)))
