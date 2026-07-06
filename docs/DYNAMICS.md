# Dynamics (журнал ежедневных ДЗ)

> Source: docs/archive/{PLATFORM_SPEC.md §4.13, DATA_MODEL.md, DECISIONS.md, PROGRESS.md st.18}, restructured 2026-07-06.
> Endpoints: `/api/dynamics` + admin under `/api/admin/dynamics`. Tables: `journal_pardons`, `journal_credits` (see [DATA_MODEL.md](DATA_MODEL.md)).

Tracks daily-homework completion over a **28-day** program. Day categories: `focus` / `notes` / `film`; a day is **closed** when all three are submitted.

## Key model decision

Homework entries are ordinary **`messages` in the participant's personal diary room** (`rooms.is_personal`) — there is **no entry table**. Progress (closed days, streak, misses) is computed on the fly from those messages plus the two exception tables. See [ROOMS.md](ROOMS.md).

## Exceptions

- **journal_pardons** — a participant forgives their own missed day (`MAX_PARDONS = 3`).
- **journal_credits** — admin manually credits a day as closed (no limit; e.g. submitted outside the form, timing glitch).
- Both `UNIQUE (user_id, date)`.

## Endpoints

- `GET /api/dynamics/my-stats` — closed days / streak / misses / a ±day window, computed from personal-room messages + pardons/credits.
- `POST /api/dynamics/pardon` — pardon a missed day (limit 3).
- `GET /api/rooms/{id}/journal-days` — `{date: [categories]}` map for a month (calendar of closed days).
- Admin: `GET /api/admin/dynamics` (summary across all participants), `POST /api/admin/dynamics/credit` (grant/revoke a day).

## Related

A missed day generates a `journal_missed` notification — see [NOTIFICATIONS.md](NOTIFICATIONS.md).
