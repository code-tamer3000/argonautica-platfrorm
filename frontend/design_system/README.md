# АРГОНАВТИКА — Design System

## Overview

**Аргонавтика** is an Order of Navigation through Darkness ("Орден навигации по тьме") — not a school, not a course, but a named rank and initiation structure for people whose interior life has outgrown conventional psychology, esotericism, and human-design frameworks. The founder is **Аргат**, a stonemason and mythologist who acts as captain-founder. The brand does not belong to him personally — it belongs to the Order.

**Core promise:** not enlightenment — "выйти налегке" (to exit light). The darkness, shadow, and resistance are *building material*, not enemy.

**Mechanism of entry:** magnet on the outside, blade within. Beauty of the dark sea draws the right people in and filters out the wrong ones. The brand does not sell or persuade — it **filters** and **initiates**.

### Products / Surfaces
- **Сайт-манифест** — primary public surface: scroll-narrative website where visitors encounter the Manifesto, then apply to the Expedition
- **Карта миров** — a cosmological map system, systemic content (in development)
- **Экспедиция посылания на хер** — the flagship program; applications taken via landing form

### Sources Provided
- `design_system/argonautika_design_brief.md` — master design brief (colors, typography, copy, structure, registers, do/don't)
- `design_system/lexicon_argonautica.md` — brand lexicon and anti-lexicon
- `design_system/argonautika_site_skeleton.html` — HTML site skeleton with component styles
- `design_system/аргонавтика лого белый.svg` — primary white logo SVG (monogram)
- `design_system/арго лого море.jpg` — monogram over dark sea hero image
- `design_system/вертикал заставка.jpg` — illustrated Argo ship (white on black), vertical format
- `design_system/Img/` — moodboard images (mythological references, atmosphere)
- `design_system/Map/` — cosmological maps and system diagrams

---

## CONTENT FUNDAMENTALS

### Voice
**Суровый, точный, дерзкий, благородный. Выжженный опытом. Режет, а не утешает.**

- Language: Russian. Mythological register (Greek, Slavic, Nordic)
- Tone: cinematic, severe, precise. Not warm, not comforting
- Verbs lead sentences. Short. Direct
- Not 1st or 2nd person — more declarative, impersonal authority
- No emoji. No softening qualifiers. No exclamation marks unless it's a manifesto line

### Casing
- Section labels: ONEST UPPERCASE with letter-spacing (e.g. `ЯВЬ`, `НАВЬ`, `ПРАВЬ`)
- Chapter headings: Sentence case (first word capitalized only) in Prata
- CTA buttons: `Onest`, title-case or caps-with-tracking

### Key phrases (use these, not synonyms)
> Налегке · Оживление · Живое · Из света

### Anti-lexicon (never use)
`духовный рост` · `исцеление` · `прими и отпусти` · `высокие вибрации` · `твоя лучшая версия` · `осознанность` · `марафон желаний` · `энергия изобилия` — these are pop-esotericism. The brand "names, it does not console."

### Profanity
No profanity in headlines **except** "хер" — which in this context means balance/axis/center (Х = balance). "Экспедиция посылания на хер" is a valid headline.

### Specific examples from the brand
- `«Это пиратская экспедиция.»` — threshold headline
- `«Орден тех, кто различает живое от неживого.»` — definition
- `«Ты не идёшь к свету — ты из него исходишь.»` — core message reversal
- `«Аргонавтика называет, а не утешает. Режет, а не смягчает.»` — brand manifesto

---

## VISUAL FOUNDATIONS

### Colors
Dark grounds are non-negotiable. Gold-on-black is the primary ceremonial device.
- **Фон:** `#0B100E` Бездна (main), `#000000` Тишина (pure black, negative space)
- **Стихия:** `#134E45` Море (deep teal/petrol), `#0E342E` Море·глубь
- **Текст:** `#E9E2D4` Пена/Кость (all body copy), `#F4F1E9` Кость·ярь (max light)
- **Акцент:** `#C29A48` Золото (CTA, lines, star, ceremony), `#D9B45A` Золото·ярь, `#9C7A33` Латунь
- **Глубина:** `#8E2018` Кровь (Navь, harshness, red-wound), `#B23A2E` Кровь·ярь
- **Структура:** `#6E6A5E` Камень, `#8A8478` Камень·тепл

### Typography — Four Tiers
| Tier | Font | Role |
|---|---|---|
| T1 Ceremonial | Custom Cyrillic ligature (viaz) — **Prata as placeholder** | Brand wordmark, ONE hero word, world names |
| T2 Display | **Prata** (Google Fonts) | Section headings, pull-quotes, chapter titles |
| T3 Text | **Lora** (Google Fonts) | Manifesto body, long reading, italic asides |
| T4 Interface | **Onest** (Google Fonts) | Labels, nav, buttons, metadata — always uppercase + tracking |

Type logic: viaz (Spirit/ceremony) → Prata (stone carving) → Lora (book labor) → Onest (structure)

### Sizes
- Hero T1: `clamp(48px, 8vw, 88px)` 
- H1 Prata: ~40px
- H2 Prata: ~28px
- Body Lora: 18px / line-height 1.75 / measure ~62ch
- Labels Onest: 11–13px, letter-spacing 2–4px, uppercase

### Backgrounds & Imagery
- **Always dark grounds.** Full-bleed cinematic photography: dark seas, alone ship, storm, gold-lit
- **Hand-drawn / engraved layer:** the illustrated Argo ship (white line on black) is used as an illustration motif — living, not sterile
- **AI imagery: atmosphere only** (dark seas, stone textures, clouds, fire). Never use AI for diagrams, maps, crests
- **Silence as element:** generous pure-black space is intentional negative space, not emptiness
- **Grain/texture:** all atmospheric images carry visible grain/texture — this is the "living" proof

### Spacing & Layout
- Wide margins, generous silence
- Manifesto mode: narrow measure (~62ch), large line-height (1.75), rhythm of pauses
- Full-screen dark hero sections
- No dashboard density. No grid-heavy layouts

### Corner Radii
- Buttons: `6px`
- Video/media containers: `8px`
- Card frames (skeleton): `14px`
- Sharp edges dominate — no rounded "spiritual" shapes

### Shadows & Elevation
- No drop-shadows on text elements
- Subtle inner glow: `inset 0 0 40px rgba(194,154,72,0.06)` for gold-lit surfaces
- No generic box-shadow cards

### Animation
**Slow, weighty, cinematic.** 
- Entrance: `fade + slight translateY` (upward drift, 0.8–1.2s ease-out)
- Parallax on scroll: subtle, slow (not snap)
- Gold thread: "draws" on scroll via SVG stroke-dashoffset animation
- Sea: slow looping subtle movement (if video)
- NEVER: bounce, spring, startup-style ease-in-out punch

### Hover / Press States
- Links + labels: opacity `0.6 → 1.0`, transition 200ms
- CTA buttons: slight luminance increase on gold (`#D9B45A`), no scale
- No shadow or lift effects on hover

### Borders & Dividers
- Gold hairline dividers: `1px solid #C29A48` at ~20% opacity
- Meander ornament: used at section transitions (Register A)
- Internal frames: `1px solid #2C322E` (dark stone-green border)

### Three Visual Registers
**Do not mix within a single section.**

| Register | Palette | Texture | Use |
|---|---|---|---|
| **A · Эллинский герб** | Gold + Black + Blood | Meander, ouroboros, star, helmet, vase-painting | Order signs, seals, identity, ceremony (Expedition, initiation), footer crest |
| **B · Резьба по камню** | Stone-gray + Blood + Gold inlay | Carved relief, runes, hand-cut — **keep roughness, do not sanitize** | Textural backgrounds, Аrgat's craft, tactile dividers, "burned by experience" feeling |
| **C · Тёмный океан** | Abyss/Silence + Teal + Bone-foam + Gold-thread | Lonely ship, dark sea, silence, gold thread, crystal-warrior in code | Threshold/hero, transitions, the path, Navь-depth, atmospheric full-bleed photos |

### Iconography
See full ICONOGRAPHY section below.

---

## ICONOGRAPHY

### Primary Mark
**Монограмма** — stylized Cyrillic "А" letterform with an ornate wave base and 4-pointed star sparkle at top right. White on dark; gold for ceremony. Source: `assets/logo_white.svg`

### Star-Spark Glyph ✦
**The primary brand icon.** Four-pointed concave spark (navigation star / sacred wound / source). Used as:
- Bullet point / divider
- Favicon
- CTA accent
- Section marker

SVG path (center 0,0):
```
M0,-10 C1.5,-3 3,-1.5 10,0 C3,1.5 1.5,3 0,10 C-1.5,3 -3,1.5 -10,0 C-3,-1.5 -1.5,-3 0,-10 Z
```
Colors: `#C29A48` gold (ceremony) or `#E9E2D4` bone (neutral)

### Three Movement Glyphs
- **Явь** (inward, Яв): crosshair/cross in circle — "в точку" (into the point). Color: Кость
- **Навь** (deep, Нав): dark sphere with inner spark and descending nodes — "внутри точки" (inside the point). Color: Кровь  
- **Правь** (upward, Пра): radiant burst/spiral from star — "из точки" (from the point). Color: Золото

### Icon System
No third-party icon library is in use. The brand uses:
1. Custom SVG glyphs (star-spark, monogram, three movements)
2. Unicode geometric characters as structural markers (·, —, →)
3. Roman numerals for chapter numbering (I–XXIV)
4. No emoji

### Motif Library (for decorative use)
- Greek meander border (golden frames/dividers) — Register A
- Ouroboros around star (cycle/year wheel) — Register A
- Concentric gold rings (Карта/Wheel structure) — Register A
- Gold thread of Ariadne (navigation line) — Register C
- Carved stone relief with gold inlay — Register B
- Argo ship (illustrated, white line on black) — Register C

### Illustrations
Provided in `assets/`:
- `vertical_splash.jpg` — white illustrated Argo ship on pure black (key brand illustration)
- `argo_logo_sea.jpg` — monogram over dark teal sea (hero/threshold)
- `img/CORE1.jpg` — concentric gold rings with Greek vase figures (cosmological map motif)
- `img/sword.jpg` — gold sword with stipple-engraving hand (Register A ceremony)
- `img/argonaut.jpg` — crystal warrior in matrix code (Register C/digital-mythological)
- `img/runo.jpg` — Jason with golden fleece (mythological reference)
- `img/argo_boat.jpg` — classical painting of the Argo at sea
- `map/worlds_map.jpg` — dramatic painted cosmological map (red + gold + teal)

---

## FILE INDEX

```
README.md                      ← This file (master reference)
SKILL.md                       ← Agent skill definition
colors_and_type.css            ← All CSS tokens: color, type, spacing
assets/
  logo_white.svg               ← Primary monogram (white)
  argo_logo_sea.jpg            ← Monogram over hero sea (threshold hero)
  vertical_splash.jpg          ← Illustrated Argo ship (white on black)
  img/                         ← Moodboard / atmospheric imagery
  map/                         ← Cosmological maps & diagrams
preview/                       ← Design system card previews
  colors_base.html
  colors_semantic.html
  colors_registers.html
  type_scale.html
  type_display.html
  type_body.html
  type_interface.html
  spacing_tokens.html
  spacing_shadows.html
  components_buttons.html
  components_form.html
  components_chapter_nav.html
  components_labels.html
  components_pullquote.html
  brand_logo.html
  brand_star_glyphs.html
  brand_registers.html
  brand_lexicon.html
ui_kits/
  argonautika_web/
    README.md
    index.html
    Header.jsx
    HeroSection.jsx
    ManifestSection.jsx
    ExpeditionForm.jsx
    Footer.jsx
```
