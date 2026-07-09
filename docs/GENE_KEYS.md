# Gene Keys (Генные замки)

> Frontend-only feature. Static content (64 keys), no backend/DB. Route `/genkeys`,
> visible to all logged-in users (sidenav item). Added 2026-07.
>
> UI label is **«Генные замки»** (nav item, wheel caption). The route, code
> identifiers, and content filenames stay `genkeys`/`GeneKeys` — the rename is
> user-facing text only.

## What it is

An interactive I-Ching mandala for browsing the 64 Gene Keys. Each key has a
Shadow / Gift / Siddhi spectrum plus characteristics (amino acid, codon ring,
physiology, program partner, dilemma, victim pattern) and long-form prose for the
three frequency bands. Each spectrum band also carries a **totem animal**
(`fear`/`life`/`vision` on `GeneKeyMeta` = Тень/Дар/Сиддхи animal), rendered under
the band value in the reading's spectrum triad. Hovering a key assembles its hexagram from the wheel;
clicking opens the full reading beside the wheel.

## Content pipeline (build-time, bundled)

- Source of truth: `frontend/src/features/genkeys/content/01.md … 64.md` — one
  markdown file per key, fixed structure (`# title`, `## Спектр`, `## Характеристики`,
  `## Тень/Дар/Сиддхи`).
- `frontend/scripts/build_genkeys_data.py` parses the 64 files + the King Wen
  hexagram table (`frontend/scripts/hexagrams.py`) and generates
  `frontend/src/features/genkeys/genkeys.data.ts` (`GENE_KEYS: GeneKeyMeta[]`).
  It also computes each key's `subSlot` (amino-sorted position within its bigram
  group). **Regenerate after editing any markdown**:
  `python3 frontend/scripts/build_genkeys_data.py`.
- The full markdown bodies are **not** inlined — `useGeneKeyBody.ts` lazy-loads a
  key's `.md` via `import.meta.glob(..., { query: '?raw' })`, so each key is its
  own chunk and the initial wheel render stays light. `GeneKeysScreen` itself is
  `React.lazy`-split out of the app shell.

## Book link — «64 пути»

The contemplation book **Ричард Радд «64 пути»** lives in the Knowledge Base as an
ordinary article with a **`.md` file attached**; the KB markdown reader splits it
into chapters on the `##` headings (see "Markdown reader" in [KB.md](KB.md)).
Chapter N contemplates gene key N, so a key's reading deep-links into that chapter.

- `useGenkeysBook.ts` (`useGenkeysBookLink('64 пути')`) resolves the link **by
  naming convention**: it finds a published article whose title contains «64 пути»
  and that has a markdown attachment, returning `{ itemId, assetId }`. It resolves
  the candidate's attachment URLs (bounded fan-out via `useQueries`) to pick the
  `.md`. No dedicated "book" entity — the link simply disappears if no such article
  is published.
- If found, `GeneKeyReading.tsx` renders a «📖 Читать главу…» link near the **top**
  of the reading (`styles.bookLink`) to `/kb/read/{itemId}/{assetId}?ch={number}`;
  the reader resolves `?ch=N` to the matching chapter and scrolls to it.

## Wheel geometry (`wheel.ts`)

A binary I-Ching tree, three concentric rings around a Taiji (yin-yang) hub:

- ring 1 (inner): 4 sectors = lower bigram (hexagram lines 1-2)
- ring 2 (middle): 16 sectors = lines 1-4
- ring 3 (outer): 64 sectors = full hexagram = the Gene Keys (numbers + added bigram)

Sector angles use a **reflected-binary split** (`sectorSpan`): the yang half keeps
natural order, the yin half mirrors it. Consequences (all verified in
`scripts/*.py`):

- rings are **nested** — ring N's sectors are ring N-1's split in four, sharing
  radial boundaries (a big ¼ sector exactly caps its 4 mid + 16 leaf sectors);
- a key and its **program partner** (full 6-line inversion) sit **exactly 180°
  apart** on every ring;
- outer leaves are additionally **amino-sorted** within each ring-2 group of 4
  (via `subSlot`) so a key's neighbours tend to share its amino acid.

Spectrum/amino families map to the design-system palette (fire/water/gold/stone).

## Interaction (`useRings.ts`, `GeneKeysScreen.tsx`)

- **Idle**: the three rings drift slowly at different speeds/directions (one rAF
  loop; respects `prefers-reduced-motion`). The hub Taiji spins with ring 1.
- **Hover a key**: idle stops; inner rings ease so the whole nested block aligns
  (boundaries coincide); the key's chain lights up gold on all three rings; the
  focused key's hexagram materialises in the hub; four golden ÷4/÷16/÷64 grid
  lines grow outward. The partner is shown as text in the caption only (not
  highlighted on the wheel).
- **Click a key** (`locked`): the three rings rotate so the key's three bigrams
  stack into one radial column (assembled hexagram), then the wheel slides left
  and the reading panel opens on the right. Esc / close button dismisses.

## Mobile picker (`GeneKeyPicker.tsx`)

On mobile (`max-width: 900px`) the 64 wheel sectors are too small to tap
reliably, so a picker appears **below the wheel** (hidden on desktop via CSS;
also hidden once a reading is open). The stage stacks title → wheel → picker in
a scrollable, top-aligned column (nothing overlaps); the wheel is trimmed a
little (not shrunk hard); the hover hint under the title is dropped (no hover on
touch); and the two-tab body has a fixed min-height so switching «по номеру» ↔
«по гексаграмме» doesn't jump. Two tabs, both resolving to a key number:

- **По номеру** — a number field (1–64) + «Открыть»; the matched key's name
  previews live below.
- **По гексаграмме** — pick the **lower** trigram then the **upper** (eight
  I-Ching trigrams each, drawn as stacked yang/yin lines); `keyByTrigrams(lower,
  upper)` in `wheel.ts` concatenates them (`lower+upper` = full hexagram) and
  looks up the number. All 64 lower×upper combinations resolve, so it never
  dead-ends. `TRIGRAMS` (bits + Russian names) also lives in `wheel.ts`.

Unlike a wheel click (which opens instantly — the cursor is already on the
key), a picker selection has no cursor, so `GeneKeysScreen.handlePick` runs a
**two-phase** open: it focuses the key with `anchorTop`, which makes `useRings`
spring the OUTER ring so the chosen lock scrolls to 12 o'clock and its hexagram
assembles; after `PICK_ASSEMBLE_MS` (~1.1 s) the reading slides open. A real
hover, a new pick, or closing cancels the pending open and clears `anchorTop`.
`useRings(focusKey, frozen, anchorTop)`: without `anchorTop` the outer ring
HOLDS (hover — key stays under the cursor); with it, the outer ring rotates to
`-leaf.angle`.

## Files

- `wheel.ts` — geometry, palette, lookups, `PLACED`/`LEAVES`, `partnerOf`.
- `useRings.ts` — rotation state (idle drift + focus easing, hover vs locked).
- `GeneKeysWheel.tsx` — the SVG (rings, keys, ticks, golden edges, hub).
- `YinYang.tsx` — Taiji hub mark. `Hexagram.tsx` — hexagram for the reading panel.
- `GeneKeyReading.tsx` — spectrum triad + characteristics + lazy markdown body + KB book link.
- `GeneKeyPicker.tsx` — mobile-only by-number / by-hexagram key selection.
- `GeneKeysScreen.tsx` — composition + hover/select/partner state.
- `genkeys.module.css` — all styling (wheel + reading).
- `content/*.md` — the 64 source files. `genkeys.data.ts` — generated metadata.
