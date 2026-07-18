# Dynamics (журнал ежедневных ДЗ)

> Source: docs/archive/{PLATFORM_SPEC.md §4.13, DATA_MODEL.md, DECISIONS.md, PROGRESS.md st.18}, restructured 2026-07-06; editable structure (задания) added 2026-07-06.
> Endpoints: `/api/dynamics` + admin under `/api/admin/dynamics` and `/api/admin/journal`. Tables: `journal_pardons`, `journal_credits`, `journal_programs`, `journal_sections` (see [DATA_MODEL.md](DATA_MODEL.md)).

Tracks daily-homework completion over a **28-day** program. The diary **structure**
(which sections a day has) is admin-editable and **versioned by date** — see below. A day
is **closed** when every section of the задание active on that day is submitted.

> **Observers** (`users.is_observer`, see [AUTH.md](AUTH.md)) have no Dynamics access: the whole `/api/dynamics` router is behind `require_participant` → 403 (the admin overview reuses the module's functions directly, not over HTTP, so it is unaffected).

## Structure: задания (versioned diary structure)

- A **задание** (`journal_programs`) is a version of the diary structure effective from a
  `starts_on` date, with its own ordered **sections** (`journal_sections`), title and description.
- The задание **active on day D** is the one with the greatest `starts_on <= D`
  (`dynamics.active_version_for` / `required_keys_for`). So each day is scored against the
  structure that was in effect **that** day — editing/adding a задание effective from a future
  date **never re-scores past days**.
- **Progress is continuous** across задания: streak / overdue run over the whole timeline;
  only the section set changes at a boundary. `program_start` = earliest задание `starts_on`
  (falls back to `settings.journal_program_start`).
- A **section** has: `key` (stable slug `[a-z0-9_]+`, used in the message marker), `emoji`,
  `label`, `heading`, `placeholder`, `input_type` (`text` = multiline body under a fixed
  heading; `title` = single-line where the entered text becomes the heading, e.g. `film`).
- Seeded задание #1 (`starts_on = 2026-07-03`) reproduces the original hardcoded
  `focus`/`notes`/`film` structure, so historical scoring is unchanged.
- **Editing** an already-active задание's section *set* re-scores its days; cosmetic edits
  (text/emoji) are safe. To change structure going forward, create a new задание with a future
  `starts_on`. The admin UI (`AdminJournal`, route `/admin/journal`) warns about this.

## Key model decision

Homework entries are ordinary **`messages` in the participant's personal diary room** (`rooms.is_personal`) — there is **no entry table**. Each entry carries an invisible marker `<!--journal:{key}-->` at the start of `content` (`dynamics._journal_category` regex-parses **any** key). Progress (closed days, streak, misses) is computed on the fly from those messages, the задания timeline, plus the two exception tables. See [ROOMS.md](ROOMS.md).

## Exceptions

- **journal_pardons** — a participant forgives their own missed day (`MAX_PARDONS = 3`).
- **journal_credits** — admin manually credits a day as closed (no limit; e.g. submitted outside the form, timing glitch).
- Both `UNIQUE (user_id, date)`.

## Endpoints

- `GET /api/dynamics/my-stats` — closed days / streak / misses / a ±day window, computed from personal-room messages + pardons/credits.
- `POST /api/dynamics/pardon` — pardon a missed day (limit 3).
- `GET /api/dynamics/structure` — the задание active today (sections for the widget/composer).
- `GET /api/rooms/{id}/journal-days` — `{date: [section keys]}` map for a month (keys ordered by the задание active that day).
- Admin dynamics: `GET /api/admin/dynamics` (summary across all participants), `POST /api/admin/dynamics/credit` (grant/revoke a day).
- Admin structure: `GET/POST /api/admin/journal/programs`, `PATCH/DELETE /api/admin/journal/programs/{id}` (create/edit/delete задания; can't delete the earliest; `starts_on` unique).

## Related

A missed day generates a `journal_missed` notification — see [NOTIFICATIONS.md](NOTIFICATIONS.md).
