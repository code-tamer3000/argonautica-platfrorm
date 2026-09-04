"""Скрыть Zoom-ссылки на эфиры от держателей самого дешёвого тарифа (ARG-115).

Текстовая маскировка «лучшим усилием», не сущностная видимость (см. docs/ROOMS.md
и is_cheap_tariff в app/services/visibility.py): нестандартный формат ссылки
(сокращённый URL, без `https://`) под regex не попадёт — осознанно, см. Linear ARG-115
«Границы».
"""
import re

ZOOM_LINK_RE = re.compile(r"https?://[\w.-]*zoom\.us/\S+", re.IGNORECASE)
ZOOM_LINK_PLACEHOLDER = "[ссылка на эфир скрыта]"


def redact_zoom_links(text: str) -> str:
    return ZOOM_LINK_RE.sub(ZOOM_LINK_PLACEHOLDER, text)
