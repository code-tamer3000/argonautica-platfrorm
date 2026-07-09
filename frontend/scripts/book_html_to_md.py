#!/usr/bin/env python3
"""
Convert a FictionBook-exported book HTML into a single Markdown file suitable for
a KB "book" material (`kb_items.kind = 'book'`). The reader (KbBookReader) splits
it back into chapters on the `##` headings at render time.

Input:  a book .html (repo root), UTF-8. `<h1>`-delimited: cover, intro, chapters,
        optional appendix. Per-chapter hexagram <img> tags are dropped.
Output: one .md — `# <book title>`, then `## <chapter>` per section, prose as
        paragraphs (source <br> soup collapsed into real paragraphs), `*italic*`
        and `**bold**` preserved.

Usage:
  python3 frontend/scripts/book_html_to_md.py 64_ways.html [out.md]

The output is *seed content* to paste into the KB admin "book" editor — it is NOT
imported by the app, so it lives under scripts/out/, not src/.

Default out: frontend/scripts/out/64-puti.md
"""
import html
import re
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent.parent
DEFAULT_OUT = Path(__file__).resolve().parent / "out" / "64-puti.md"


def strip_tags(s: str) -> str:
    return re.sub(r"\s+", " ", re.sub(r"<[^>]+>", " ", s)).strip()


def _emphasis(s: str, tag: str, marker: str) -> str:
    """Replace <tag>…</tag> with `marker…marker`, moving any leading/trailing
    whitespace that sits *inside* the tag to the outside so the markers hug the
    text (CommonMark won't emphasise `* text *`)."""
    pat = re.compile(rf"<\s*{tag}\s*>(.*?)<\s*/\s*{tag}\s*>", re.S | re.I)

    def repl(m: re.Match[str]) -> str:
        inner = m.group(1)
        if not inner.strip():
            return inner  # empty/whitespace-only emphasis → drop the markers
        lead = inner[: len(inner) - len(inner.lstrip())]
        trail = inner[len(inner.rstrip()):]
        return f"{lead}{marker}{inner.strip()}{marker}{trail}"

    prev = None
    while prev != s:  # nested/adjacent tags: repeat until stable
        prev = s
        s = pat.sub(repl, s)
    return s


def inline_md(s: str) -> str:
    """Convert inline <i>/<em>→*, <b>/<strong>→**, drop other tags, unescape."""
    for tag in ("b", "strong"):
        s = _emphasis(s, tag, "**")
    for tag in ("i", "em"):
        s = _emphasis(s, tag, "*")
    s = re.sub(r"<[^>]+>", "", s)  # drop anything else (a, span, …)
    return html.unescape(s)


def body_to_md(html_body: str) -> str:
    """A chapter's inner HTML (br/i/b/div soup) → markdown paragraphs."""
    b = re.sub(r"<img[^>]*>", "", html_body, flags=re.I)
    b = re.sub(r'<a\s+name="[^"]*"\s*>\s*</a>', "", b, flags=re.I)
    # Drop the FictionBook table-of-contents list wholesale (pure navigation),
    # plus <hr>/<small>/<h2> chrome that isn't part of the prose.
    b = re.sub(r"<ul[^>]*>.*?</ul>", "", b, flags=re.S | re.I)
    b = re.sub(r"</?(hr|small|blockquote|h2|h3)[^>]*>", "", b, flags=re.I)
    # Sub-band headings (<h5>/<h6>/<h4>) become bold lines on their own paragraph.
    b = re.sub(r"<h[456][^>]*>(.*?)</h[456]>", r"\n\n@@H@@\1@@/H@@\n\n", b, flags=re.S | re.I)
    # Paragraph boundaries: the source uses <br> to end visual lines.
    b = re.sub(r"<br\s*/?>", "\n", b, flags=re.I)
    b = re.sub(r"</?div[^>]*>", "\n", b, flags=re.I)
    b = re.sub(r"</?p[^>]*>", "\n", b, flags=re.I)

    out_lines: list[str] = []
    for raw_line in b.split("\n"):
        line = raw_line.strip()
        if not line:
            out_lines.append("")
            continue
        hm = re.match(r"@@H@@(.*)@@/H@@", line, flags=re.S)
        if hm:
            text = inline_md(hm.group(1)).strip().strip("*").strip()
            out_lines.append(f"**{text}**")
        else:
            out_lines.append(inline_md(line).strip())

    # Collapse runs of blank lines to a single blank; a non-heading text line is
    # its own paragraph (the source already broke visual paragraphs with <br>).
    md: list[str] = []
    for line in out_lines:
        if line == "" and (not md or md[-1] == ""):
            continue
        md.append(line)
    text = "\n\n".join(p for p in md if p.strip())
    return text.strip()


def main() -> None:
    src = Path(sys.argv[1]) if len(sys.argv) > 1 else ROOT / "64_ways.html"
    out = Path(sys.argv[2]) if len(sys.argv) > 2 else DEFAULT_OUT
    text = src.read_text(encoding="utf-8")

    title_m = re.search(r"<title>(.*?)</title>", text, re.S | re.I)
    book_title = strip_tags(title_m.group(1)) if title_m else src.stem

    heads = list(re.finditer(r"<h1[^>]*>(.*?)</h1>", text, re.S | re.I))
    parts: list[str] = [f"# {book_title}", ""]
    for i, m in enumerate(heads):
        title = strip_tags(m.group(1))
        # Section 0 is the cover + table-of-contents list — pure navigation, skip.
        if i == 0:
            continue
        end = heads[i + 1].start() if i + 1 < len(heads) else len(text)
        body = body_to_md(text[m.end():end])
        parts.append(f"## {title}")
        parts.append("")
        if body:
            parts.append(body)
            parts.append("")

    out.parent.mkdir(parents=True, exist_ok=True)
    out.write_text("\n".join(parts).rstrip() + "\n", encoding="utf-8")
    print(f"wrote {out} — {len(heads)} sections, {out.stat().st_size} bytes")


if __name__ == "__main__":
    main()
