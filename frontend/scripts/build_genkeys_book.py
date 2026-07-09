#!/usr/bin/env python3
"""
Split the bundled book "Ричард Радд — 64 пути" into per-chapter HTML fragments.

Source: 64_ways.html at the repo root (FictionBook export, already converted to
UTF-8). It is one <h1>-delimited stream: cover title, author intro, 64 chapters
("N-й генный ключ ПУТЬ …"), then a ДИЛЕММЫ appendix.

Output (bundled into the frontend, lazy-loaded per chapter like content/*.md):
  frontend/src/features/genkeys/book/intro.html
  frontend/src/features/genkeys/book/01.html … 64.html   (chapter N == gene key N)
  frontend/src/features/genkeys/book/dilemmas.html
  frontend/src/features/genkeys/book/manifest.json        (chapter titles)

Each chapter fragment is the cleaned body only (no <h1>, no per-key hexagram
<img> — the reader draws our golden <Hexagram> from the chapter number instead).
Regenerate after replacing the source: python3 frontend/scripts/build_genkeys_book.py
"""
import json
import re
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent.parent  # repo root
SRC = ROOT / "64_ways.html"
OUT = Path(__file__).resolve().parent.parent / "src" / "features" / "genkeys" / "book"

# Tags we keep in a chapter fragment. Everything else is unwrapped or dropped.
KEEP = {"i", "b", "em", "strong", "br", "div", "p", "h5", "h6"}


def strip_tag(text: str) -> str:
    return re.sub(r"\s+", " ", re.sub(r"<[^>]+>", " ", text)).strip()


def clean_body(html: str) -> str:
    # Drop the broken per-key hexagram images (the reader renders our own).
    html = re.sub(r"<img[^>]*>", "", html, flags=re.I)
    # Drop FictionBook TOC anchors (`<a name="TOC_…">`) but keep real links.
    html = re.sub(r'<a\s+name="[^"]*"\s*>\s*</a>', "", html, flags=re.I)
    html = re.sub(r'<a\s+name="[^"]*"\s*>', "", html, flags=re.I)
    # Normalise <h5>/<h6> band headings to <h4> so the reader styles them uniformly.
    html = re.sub(r"<(/?)h[56]([^>]*)>", r"<\1h4\2>", html, flags=re.I)
    # Drop now-empty <div> wrappers left by the removed hexagram image.
    html = re.sub(r"<div[^>]*>\s*</div>", "", html, flags=re.I)
    # Collapse redundant whitespace-only runs and stray leading/trailing breaks.
    html = re.sub(r"[ \t]+", " ", html)
    html = re.sub(r"(<br\s*/?>\s*){3,}", "<br><br>", html, flags=re.I)
    html = re.sub(r"^\s*(<br\s*/?>\s*)+", "", html, flags=re.I)
    html = re.sub(r"(<br\s*/?>\s*)+\s*$", "", html, flags=re.I)
    return html.strip()


def main() -> None:
    txt = SRC.read_text(encoding="utf-8")
    heads = list(re.finditer(r"<h1[^>]*>(.*?)</h1>", txt, re.S | re.I))
    # Body of section i spans from end of its <h1> to the start of the next.
    bounds = [(m, heads[i + 1].start() if i + 1 < len(heads) else len(txt))
              for i, m in enumerate(heads)]

    OUT.mkdir(parents=True, exist_ok=True)
    manifest: dict[str, object] = {"chapters": {}}
    key_re = re.compile(r"(\d+)-й\s+генный\s+ключ\s+(.*)", re.I)

    intro_written = False
    for m, end in bounds:
        title = strip_tag(m.group(1))
        body = clean_body(txt[m.end():end])
        km = key_re.match(title)
        if km:
            num = int(km.group(1))
            path = f"{num:02d}.html"
            manifest["chapters"][str(num)] = title
            (OUT / path).write_text(body + "\n", encoding="utf-8")
        elif title.upper().startswith("ДИЛЕММЫ"):
            (OUT / "dilemmas.html").write_text(body + "\n", encoding="utf-8")
            manifest["dilemmas"] = title
        elif "созерцательное путешествие" in title.lower() and not intro_written:
            (OUT / "intro.html").write_text(body + "\n", encoding="utf-8")
            manifest["intro"] = title
            intro_written = True
        # else: cover "64 пути" — skipped.

    (OUT / "manifest.json").write_text(
        json.dumps(manifest, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")

    n = len(manifest["chapters"])
    print(f"wrote {n} chapters + intro + dilemmas to {OUT}")
    missing = [i for i in range(1, 65) if str(i) not in manifest["chapters"]]
    if missing:
        raise SystemExit(f"MISSING chapters: {missing}")


if __name__ == "__main__":
    main()
