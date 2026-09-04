"""Юнит-тесты redact_zoom_links (ARG-115) — чистая функция, без БД."""
from app.services.redaction import ZOOM_LINK_PLACEHOLDER, redact_zoom_links


def test_redact_zoom_links_replaces_link_with_placeholder() -> None:
    text = "Время: 20:00 Москва\nПрисоединиться:\nhttps://us06web.zoom.us/j/868129?pwd=abc"
    result = redact_zoom_links(text)
    assert "zoom.us" not in result
    assert ZOOM_LINK_PLACEHOLDER in result
    assert "Время: 20:00 Москва" in result


def test_redact_zoom_links_replaces_multiple_links() -> None:
    text = "https://zoom.us/j/1 запасная https://us02web.zoom.us/j/2"
    result = redact_zoom_links(text)
    assert result.count(ZOOM_LINK_PLACEHOLDER) == 2
    assert "zoom.us" not in result


def test_redact_zoom_links_ignores_link_without_scheme() -> None:
    """Ссылка без https:// — regex осознанно не ловит (см. Границы ARG-115)."""
    text = "Zoom: us06web.zoom.us/j/868129"
    assert redact_zoom_links(text) == text


def test_redact_zoom_links_leaves_plain_text_unchanged() -> None:
    text = "Обычный текст без ссылок на эфир."
    assert redact_zoom_links(text) == text
