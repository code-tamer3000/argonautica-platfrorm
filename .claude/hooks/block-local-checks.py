#!/usr/bin/env python3
"""PreToolUse(Bash): запрет локальных прогонов тестов/линта/стендов.

Проверки в этом проекте идут ТОЛЬКО в CI. Хук ловит варианты, которые обходят
prefix-матчинг в permissions.deny (CI=true make test, FORCE_LOCAL=1, sh -c "...",
цепочки через &&). Выход 2 = блок, stderr уходит агенту.
"""
import json
import re
import sys

BLOCKED = re.compile(
    r"""(?x)
    \bmake\s+(?:-\S+\s+)*(?:test\S*|lint|up-test|down-test|migrate-test|local-\w+)\b
    | (?<![/\w.-])(?:pytest|ruff|mypy|alembic|vite|tsc|vitest|playwright)(?![/\w.-])
    | \bnpm\s+(?:run|test|ci|exec)\b | (?<![/\w.-])npx(?![/\w.-])
    | \bdocker-compose(?![.\w-]) | \bdocker\s+compose\b | \bdocker\s+run\b
    | \bFORCE_LOCAL\b
    """
)
# Читать результаты CI можно и нужно.
# Read-only утилиты и git/gh: упоминание `make test` в аргументах — не запуск.
# `ssh platform-new …` — команда выполняется на сервере (прод/стенд), а не локально:
# docker/compose там — штатная эксплуатация (рестарт бота, логи), хук её не трогает.
ALLOWED = re.compile(
    r"^\s*(?:(?:gh|git|grep|rg|cat|ls|head|tail|wc|echo|printf)\s|ssh\s+(?:-\S+\s+)*platform-new\s)"
)
# Тело heredoc — это данные (например, текст правки CLAUDE.md), а не команды.
HEREDOC = re.compile(r"<<-?\s*['\"]?(\w+)['\"]?[^\n]*\n.*?\n\s*\1\b", re.S)

try:
    cmd = json.load(sys.stdin).get("tool_input", {}).get("command", "")
except Exception:
    sys.exit(0)
cmd = HEREDOC.sub("", cmd)


def split_segments(text: str) -> list[str]:
    """Режет по && || ; | \\n только ВНЕ кавычек (`grep "a\\|b"` — один сегмент)."""
    segs, cur, quote, i = [], [], None, 0
    while i < len(text):
        ch = text[i]
        if quote:
            cur.append(ch)
            if ch == "\\" and quote == '"' and i + 1 < len(text):
                cur.append(text[i + 1])
                i += 1
            elif ch == quote:
                quote = None
        elif ch in "'\"":
            quote = ch
            cur.append(ch)
        elif ch in ";|&\n":
            segs.append("".join(cur))
            cur = []
            while i + 1 < len(text) and text[i + 1] in ";|&":
                i += 1
        else:
            cur.append(ch)
        i += 1
    segs.append("".join(cur))
    return segs


# Разбираем цепочки: блокируем, если ЛЮБОЙ сегмент попадает под запрет.
for seg in split_segments(cmd):
    if ALLOWED.match(seg):
        continue
    if BLOCKED.search(seg):
        print(
            "ЗАПРЕЩЕНО: в этом проекте тесты, линт, typecheck и стенды запускаются "
            "ТОЛЬКО в CI. Не запускай их локально и не ищи обходов (raw npm/tsc/"
            "docker run, CI=true, второй worktree). Сделай commit + push (+ PR) и "
            "читай результат: `gh pr checks --watch`, `gh run view --log-failed`.",
            file=sys.stderr,
        )
        sys.exit(2)
sys.exit(0)
