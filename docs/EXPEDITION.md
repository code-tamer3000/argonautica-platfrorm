# Expedition Circle (Круг Экспедиции)

> Source: task plan, restructured 2026-08-30.
> Endpoints: `/api/dashboard`, `/api/expedition`, `/api/admin/intakes/{id}/stages`.
> Tables: `intake_stages`, `expedition_locks` (see [DATA_MODEL.md](DATA_MODEL.md)).

The platform's landing screen (`/`, replaces the old redirect-to-Рубка). Shows where a
participant is in the expedition — a 28-day circle of real moon phases split into six
stages — plus a compact digest of what needs attention today (journal, tasks, calendar,
notifications, news). Four of the six stages carry an **element lock**: a private slot
the participant fills once a stage's broadcast has aired, with a Gene Key hexagram (see
[GENE_KEYS.md](GENE_KEYS.md)).

> **Observers** have no dashboard: `/api/dashboard` and `/api/expedition` sit behind
> `require_participant` → 403. `/` sends an observer straight to `/kb` (client-side),
> same as before this feature existed.

## The six stages

A stage's **broadcast (эфир) opens it**; it runs until the next stage's broadcast. Order
is fixed by code (`STAGE_KINDS` in `app/models/expedition.py`), not by whatever order rows
happen to be stored in:

`balance → air → fire → water → earth → final`

A stage's length is **never stored** — it's the gap between its `air_date` and the next
stage's, computed on every read (`services/expedition.layout_stages`). Move a broadcast
in the admin panel and the circle re-lays itself out automatically; a lock already
entered under the old dates is **not** revoked.

`balance` (Точка Баланса) and `final` render in the **centre** of the circle as a small
ring of days around the yin-yang mark — not on the outer rim. The four elements
(`air`/`fire`/`water`/`earth`) sit on the rim at the cardinal points and are read
**counter-clockwise**: Воздух (right) → Огонь (top) → Вода (left) → Земля (bottom) —
this is a reading of the reference scheme's layout, not an arbitrary choice.

**No schedule configured** for an intake (fresh intake, admin hasn't opened "Круг
Экспедиции" yet): the circle falls back to four equal 7-day element stages from
`intakes.starts_on`, no `balance`/`final`, no broadcast dates shown under the element
labels (`services/expedition.fallback_stages`). The screen never breaks because of an
empty admin form.

## Element locks

Each element stage optionally carries `task_id` — a task whose **acceptance** is the
"lived" completion of that stage. Four states per lock (`services/expedition.lock_state`):

| State | Condition |
|---|---|
| `locked` | the stage's broadcast hasn't aired yet |
| `unlockable` | broadcast aired, no hexagram entered yet |
| `entered` | hexagram entered, the stage's task (if any) not yet `accepted` |
| `revealed` | the stage's task assignment is `accepted` |

A stage with `task_id = NULL` never reaches `revealed` — it stops at `entered`. `balance`
and `final` carry no lock at all (the reference scheme has exactly four).

**Entry is an upsert, not a roll.** `PUT /api/expedition/locks/{element}
{"key_number": 1..64}` (server derives `hexagram` from the King Wen table — never
accepted from the client) can be called again any time after unlock to correct a
mistake; `UNIQUE (user_id, element)` on `expedition_locks` is what makes this an upsert
rather than a growing history. This is deliberately **not** a divination roll — the
Gene Key picker (`features/genkeys/GeneKeyPicker.tsx`, reused as-is: pick by number or
by assembling the two trigrams) always lets you pick a specific number, not a random one.

Unlike Dynamics' window-closed 403, **locks stay enterable through graduation and past
`intakes.ends_on`** — `PUT /api/expedition/locks/{element}` sits behind
`require_participant` only, not `require_ongoing_participant`. The meaning of a stage
can land after the expedition's formal end; nothing about the mechanic requires cutting
it off.

A revealed/entered lock deep-links to its full reading: `/genkeys?key=N`
(`GeneKeysScreen` already opens a key from a `?key=` param — see
[GENE_KEYS.md](GENE_KEYS.md) "Book link"; no new resolution logic was needed).

## Visual layer

`ExpeditionWheel.tsx` renders the circle in the same visual language as the Gene Keys
wheel ([GENE_KEYS.md](GENE_KEYS.md) "Wheel"): the hub's Taiji is the shared
`components/YinYang.tsx` (extracted from `features/genkeys/YinYang.tsx`, both wheels use
it now, kept small — a mark in the hub, not a shape that fills it) and the element band
is drawn with `annularSectorPath` from `features/genkeys/wheel.ts` (reused, not
reimplemented).

Layers, centre outward (`CX = CY = 330`, viewBox `0 0 660 660`; radii in
`wheelGeometry.ts`):

| Radius | Layer |
|---|---|
| `R_TAIJI` = 36 | Taiji mark |
| `R_HUB_RIM` = 62 | hub rim circle |
| `R_SPOKE_IN..R_SPOKE_OUT` = 62..290 | four diagonal rays at 45°/135°/225°/315° — the cardinal gaps between element labels/locks (which sit at 0/90/180/270), so they never cross either |
| `R_CENTER` = 96 | Точка Баланса / Финал day ring |
| `R_LOCK` = 158 | element locks (hexagrams) |
| `R_BAND_IN..R_BAND_OUT` = 214..300 | element band (annular sectors) — labels at `R_LABEL`/`R_LABEL_DATE`, day discs at `R_DAY` inside it |

The Taiji's `<g>` rotates continuously (96s, linear) with `transform-origin` set
**inline in pixel coordinates** (`${CX}px ${CY}px`), not via `transform-box: fill-box` —
the mark's own path isn't centered in its bounding box, so `fill-box` would spin it
around an off-center point instead of the circle's centre (this was the pre-rewrite
bug: the Taiji visibly orbited instead of rotating in place).

The four diagonal rays breathe gold on a shared 6.5s cycle (`wavePulse` in
`dashboard.module.css`) — the wheel's earlier concentric pulse rings read as a
distracting bullseye and were replaced with these rays, closer to the plain quadrant
dividers the very first version had. The "today" halo and an unlockable lock's pulse
keep their own `pulseDelay(r)` offset (radius-proportional, still in
`ExpeditionWheel.tsx`) so the two don't flash in lockstep with the rays.

Every day disc shows its real moon phase (`moon.ts`, filled via `moonLitPath`)
regardless of state, and additionally gets one of four visual weights — `dayDone`
(closed/credited/today_closed/pardoned, opacity 0.75), `dayMissed` (opacity 0.35),
`dayFuture` (opacity 0.28), `dayToday` (full opacity, larger, golden halo) — so a
completed day, a missed one, and one still ahead read as three distinct states, not
two conflated ones.

The current stage's sector (when it's one of the four elements, not
balance/final) gets a closed golden outline (`sectorFramePath`, one contour: two
radial sides + inner/outer arcs) — the same device as `GrowthFrames` in the Gene
Keys wheel.

Outside the circle (`expedition.today == null` — before start or after the window
closes) the hub simply omits its second line rather than showing placeholder text; the
tagline above the wheel (`DashboardScreen.tsx`) already carries that state ("До старта
осталось N дней" / "Экспедиция пройдена"). The element/colour legend that used to sit
below the wheel is gone too — the band itself (colour) plus the on-wheel labels
already carry that information, so a separate legend repeated it.

## `GET /api/dashboard`

One aggregate for the landing screen — assembled from existing per-domain functions
(`dynamics.get_my_day_statuses`/`get_structure`, `tasks.list_tasks`,
`calendar.list_events`, `notifications.list_notifications`, plus a small news-preview
query), not new business logic. Behind `require_participant`.

```
{
  expedition: { total_days, today, stages[], days[], locks{}, lock_states{} } | null,
  journal: JournalStructureOut | null,      // null for admin (no personal Dynamics)
  journal_today_done: bool,
  journal_locked: bool,                     // graduate / closed intake window — hide the CTA
  upcoming_events: CalendarEventOut[],
  active_tasks: TaskWithStatusOut[],        // my_status in (null, assigned, returned); [] for admin
  notifications: NotificationOut[],
  unread_notifications: int,
  news_preview: { room_id, author_name, preview, created_at } | null,
}
```

`expedition` is `null` when the caller has no `intake_id` or that intake has no
`starts_on` — practically, admins without an assigned intake. An admin **with** one sees
the circle (so the schedule can be sanity-checked) but no personal layer: `journal` is
always `null` and `active_tasks` always `[]` for `role == 'admin'` — admins don't do
Dynamics or take tasks.

`expedition.days` is the **whole circle's** day-status list (`closed`/`missed`/
`pardoned`/`today_*`/`before_start`/`upcoming` — same `DayStatus` enum as Dynamics'
`RecentDay`), not the ±window `GET /api/dynamics/my-stats` uses. `dynamics._recent_days`
grew optional `window_start`/`window_end` params for this (default unchanged) rather than
gaining a second near-duplicate function.

`expedition.today` is `null` both **before** the circle starts and **after** it ends —
the frontend tells the two apart by comparing today's real date against
`expedition.stages[0].air_date`, not from a second backend field.

## Realtime invalidation

No new WS event kinds. `useRealtime` invalidates the dashboard query on the same events
that already touch its constituent cards: `notification.new`, `task.created`/`updated`,
`submission.new`/`status`, and `message.new` when the message lands in the caller's own
news room (checked against the already-loaded `rooms` list — see
[MESSAGES.md](MESSAGES.md) for the event contract itself).

## Admin API

`GET/PUT /api/admin/intakes/{id}/stages` — `require_admin`. `GET` returns the six
configured rows (or `[]` if unconfigured — see fallback above); `PUT` **replaces all
six at once** (`StagesUpdate`, `min_length=max_length=6`) — a partial PATCH would only
let an admin leave the schedule half-consistent (a missing stage mid-circle). Validates:
all six kinds present exactly once, and `air_date` strictly increasing in `STAGE_KINDS`
order (400 otherwise — a schedule where a later stage airs before an earlier one would
silently clamp to a 1-day stage in `layout_stages`, which is confusing, not enforced).
`task_id`, if given, must reference an existing task (integrity error → 400).

Edited from **Экспедиции → Круг Экспедиции** (`AdminExpeditions.tsx`), next to the
existing intake window editor and `AdminPlans`.

## Files

- `app/models/expedition.py`, `app/schemas/expedition.py` — `IntakeStage`/`ExpeditionLock`
  models, request/response schemas.
- `app/services/expedition.py` — pure logic: King Wen table, `layout_stages`,
  `fallback_stages`, `lock_state`, `unlock_moment`. No DB session — reused by the API
  layer, the admin CRUD, and tests without spinning up a request.
- `app/api/expedition.py` — participant lock endpoints + `get_stage_spans`/
  `lock_states_for`, reused by `app/api/dashboard.py`.
- `app/api/dashboard.py` — the aggregate endpoint.
- `frontend/src/features/dashboard/` — `moon.ts` (real lunar phase, pure), `wheelGeometry.ts`
  (stage/day → SVG angle, pure, including `sectorFramePath`/`elementSectorSpan`),
  `ExpeditionWheel.tsx`, `LockDialog.tsx`, `DashboardScreen.tsx`.
- `frontend/src/components/YinYang.tsx` — the Taiji mark, shared with
  `features/genkeys/GeneKeysWheel.tsx` (extracted from that feature during the visual
  rewrite; both wheels render the same mark).
- `frontend/src/styles/tokens.css` — `--el-air/fire/water/earth`, aliased to the existing
  palette (`--color-krov-yar`/`--color-more-yar`/`--color-latun`/`--color-kamen-tepl`,
  the same device as `--gk-*` in `genkeys.module.css`), both theme blocks.
