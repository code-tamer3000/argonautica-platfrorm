"""Инлайновые начертания (жирный/курсив/подчёркнутый) прямо в тексте сообщения.

Формат — маркеры в самом `messages.content` (ADR: см. docs/DECISIONS.md), тот же
для чата и записей Динамики (записи — обычные `messages`, см. ADR-008):
`**жирный**`, `*курсив*`, `++подчёркнутый++`. Рендерят их фронтовые парсеры
(lib/messageText.tsx — plain-режим, lib/markdown.ts — markdown-режим каналов-
дневников). Здесь — только снятие маркеров для текстовых превью на бэкенде
(колокольчик уведомлений, тело web-push, превью новости на дашборде), где
разметка не рендерится и сырые `**`/`++` не должны быть видны как есть.
"""
import re

# Служебный маркер категорий дневника в начале content — ни в одном превью не нужен
# (колокольчик, push, дашборд, цитата в чате).
JOURNAL_MARKER = re.compile(r"^<!--journal:[a-z0-9_]+-->")

# Те же правила, что и в BOLD_RE/UNDERLINE_RE/ITALIC_RE из frontend/src/lib/messageText.tsx:
# маркер не переносится через перевод строки, сразу внутри маркера — не пробел, у курсива
# дополнительно запрещены соседние словесные символы и `*` (не путать с жирным/"2*2*2").
_BOLD_RE = re.compile(r"\*\*(?!\s)([^\n]+?)(?<!\s)\*\*")
_UNDERLINE_RE = re.compile(r"\+\+(?!\s)([^\n]+?)(?<!\s)\+\+")
_ITALIC_RE = re.compile(r"(?<![\w*])\*(?!\s)([^*\n]+?)(?<!\s)\*(?![\w*])")


def strip_inline_marks(text: str) -> str:
    """Снимает маркеры начертаний, оставляя обычный текст — для превью."""
    result = text
    for _ in range(3):
        next_ = _BOLD_RE.sub(r"\1", result)
        next_ = _UNDERLINE_RE.sub(r"\1", next_)
        next_ = _ITALIC_RE.sub(r"\1", next_)
        if next_ == result:
            break
        result = next_
    return result


def preview_text(content: str | None, limit: int) -> str | None:
    """Текстовый сниппет content для превью (колокольчик, push, цитата в чате):
    снимает journal-маркер и inline-разметку, обрезает до limit. None, если текста
    после очистки не осталось (стикер/вложение-only сообщение)."""
    if not content:
        return None
    text = JOURNAL_MARKER.sub("", content).strip()
    text = strip_inline_marks(text)
    if not text:
        return None
    return text[:limit]
