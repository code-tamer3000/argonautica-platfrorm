#!/usr/bin/env python3
"""
Build the TypeScript data module for the Gene Keys wheel.

Combines:
  - parsed metadata (name, spectrum, characteristics) from the 64 md files
  - King Wen hexagram lines
  - amino-acid grouping (for the outer ring)
  - codon-ring grouping

Output: a single .ts file exporting GENE_KEYS: GeneKeyMeta[].
The full markdown body is NOT inlined here — it is loaded lazily via
import.meta.glob so the initial bundle stays small.
"""
import json
import re
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent))
from hexagrams import KING_WEN  # noqa: E402

# The markdown content lives alongside the feature (bundled into the frontend).
# frontend/scripts/ -> frontend/src/features/genkeys/content/
SRC = Path(__file__).resolve().parent.parent / "src" / "features" / "genkeys" / "content"

CHAR_KEYS = {
    "Дилемма": "dilemma",
    "Кодоновое кольцо": "codonRing",
    "Физиология": "physiology",
    "Аминокислота": "aminoAcid",
    "Программный партнер": "partner",
    "Программный партнёр": "partner",
    "Паттерн жертвы": "victim",
}
SPECTRUM_KEYS = {
    "Тень": "shadow",
    "Дар": "gift",
    "Сиддхи": "siddhi",
    "Ключ страха": "fear",
    "Ключ жизни": "life",
    "Ключ видения": "vision",
}

# Normalize amino-acid short forms to canonical Russian names.
AA_NORMALIZE = {
    "Аспарагиновая": "Аспарагиновая кислота",
    "Глутаминовая": "Глутаминовая кислота",
    "Стоп-кодон": "Стоп-кодон",
}


def strip_md(s: str) -> str:
    return s.replace("**", "").strip()


def parse(num: int) -> dict:
    text = (SRC / f"{num:02d}.md").read_text(encoding="utf-8")
    lines = text.splitlines()
    title_line = next((l for l in lines if l.startswith("# ")), "")
    m = re.match(r"#\s*(\d+)\s*Генный Ключ[:：]?\s*(.*)", title_line)
    name = m.group(2).strip() if m else title_line.lstrip("# ").strip()

    sections: dict[str, list[str]] = {}
    cur = None
    for l in lines:
        if l.startswith("## ") and not l.startswith("###"):
            cur = l[3:].strip()
            sections[cur] = []
        elif cur is not None:
            sections[cur].append(l)

    def bullets(body, mapping):
        out = {}
        for l in body:
            b = re.match(r"\s*-\s*(.*)", l)
            if not b:
                continue
            content = strip_md(b.group(1))
            if ":" in content:
                k, _, v = content.partition(":")
                if k.strip() in mapping:
                    out[mapping[k.strip()]] = v.strip()
        return out

    spectrum = bullets(sections.get("Спектр", []), SPECTRUM_KEYS)
    chars = bullets(sections.get("Характеристики", []), CHAR_KEYS)
    aa = chars.get("aminoAcid", "")
    chars["aminoAcid"] = AA_NORMALIZE.get(aa, aa)

    # Extract the codon-ring name and its member list from e.g.
    # "Кольцо Огня (1, 14)" or "Кольцо Тайн (Кольцо Испытаний-12,33,56)"
    ring_raw = chars.get("codonRing", "")
    ring_members = [int(x) for x in re.findall(r"\d+", ring_raw)]
    ring_name = re.sub(r"\s*\([^)]*\)\s*$", "", ring_raw).strip()

    return {
        "number": num,
        "name": name,
        "hexagram": KING_WEN[num],
        "shadow": spectrum.get("shadow", ""),
        "gift": spectrum.get("gift", ""),
        "siddhi": spectrum.get("siddhi", ""),
        "fear": spectrum.get("fear", ""),
        "life": spectrum.get("life", ""),
        "vision": spectrum.get("vision", ""),
        "dilemma": chars.get("dilemma", ""),
        "physiology": chars.get("physiology", ""),
        "aminoAcid": chars.get("aminoAcid", ""),
        "partner": chars.get("partner", ""),
        "victim": chars.get("victim", ""),
        "codonRing": ring_name,
        "codonRingMembers": sorted(set(ring_members)),
    }


# --- Outer-ring amino ordering --------------------------------------------
# Within each ring-2 bigram group (keys sharing hexagram lines 1-4), reorder the
# 4 keys by amino acid so equal aminos are adjacent — applying the SAME slot to
# each key's program partner in the opposite group, so partners stay 180° apart.
# See scripts/final_order.py for the verification (partners-opposite: 0 bad).

def _reflected_center(bits: str) -> float:
    lo, hi, flip = 0.0, 1.0, False
    for b in bits:
        mid = (lo + hi) / 2
        eff = b if not flip else ("1" if b == "0" else "0")
        if eff == "1":
            hi = mid
        else:
            lo = mid
            flip = not flip
    return (lo + hi) / 2


def _inv(bits: str) -> str:
    return "".join("1" if c == "0" else "0" for c in bits)


def compute_sub_slots(amino_by_num: dict[int, str]) -> dict[int, int]:
    by_hex = {KING_WEN[n]: n for n in range(1, 65)}
    groups: dict[str, list[int]] = {}
    for n in range(1, 65):
        groups.setdefault(KING_WEN[n][:4], []).append(n)

    sub: dict[int, int] = {}
    done: set[str] = set()
    for pfx, ns in groups.items():
        if pfx in done:
            continue
        # amino order within the group (tie-break by geometric angle for stability)
        ns_amino = sorted(ns, key=lambda n: (amino_by_num[n], _reflected_center(KING_WEN[n])))
        for i, n in enumerate(ns_amino):
            sub[n] = i
        # opposite group: partner takes the same sub index -> stays opposite
        opp = _inv(pfx)
        for n in groups[opp]:
            partner = by_hex[_inv(KING_WEN[n])]
            sub[n] = sub[partner]
        done.add(pfx)
        done.add(opp)
    return sub


def main():
    data = [parse(n) for n in range(1, 65)]
    amino_by_num = {d["number"]: d["aminoAcid"] for d in data}
    sub_slots = compute_sub_slots(amino_by_num)
    for d in data:
        d["subSlot"] = sub_slots[d["number"]]
    default_out = Path(__file__).resolve().parent.parent / "src" / "features" / "genkeys" / "genkeys.data.ts"
    out = Path(sys.argv[1]) if len(sys.argv) > 1 else default_out
    ts = (
        "// AUTO-GENERATED by scripts/build_genkeys_data.py — do not edit by hand.\n"
        "// Source: genkeys/*.md + King Wen hexagram table.\n"
        "// Regenerate after editing the markdown source.\n\n"
        "export interface GeneKeyMeta {\n"
        "  number: number\n"
        "  name: string\n"
        "  /** 6 chars, line1(bottom)..line6(top); '1'=yang solid, '0'=yin broken */\n"
        "  hexagram: string\n"
        "  shadow: string\n"
        "  gift: string\n"
        "  siddhi: string\n"
        "  fear: string\n"
        "  life: string\n"
        "  vision: string\n"
        "  dilemma: string\n"
        "  physiology: string\n"
        "  aminoAcid: string\n"
        "  partner: string\n"
        "  victim: string\n"
        "  codonRing: string\n"
        "  codonRingMembers: number[]\n"
        "  /** 0..3 angular slot within the key's ring-2 bigram group (amino-sorted) */\n"
        "  subSlot: number\n"
        "}\n\n"
        "export const GENE_KEYS: GeneKeyMeta[] = "
        + json.dumps(data, ensure_ascii=False, indent=2)
        + "\n"
    )
    out.write_text(ts, encoding="utf-8")
    print(f"wrote {out} ({len(data)} keys)")
    # sanity summary
    aas = {}
    for d in data:
        aas.setdefault(d["aminoAcid"], []).append(d["number"])
    print(f"{len(aas)} amino-acid groups")


if __name__ == "__main__":
    main()
