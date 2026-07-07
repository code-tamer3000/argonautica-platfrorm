# Cabin (каюта)

> Source: docs/archive/{PLATFORM_SPEC.md §4.16, DATA_MODEL.md, DECISIONS.md, PROGRESS.md st.22/24/25/26}, restructured 2026-07-06.
> Endpoints: `/api/cabin`. Table: `cabin_entries` (see [DATA_MODEL.md](DATA_MODEL.md)). Schemas: `schemas/cabin.py`.

Private psychological journaling. Three subkinds (`kind`): `diary` (emotion diary), `decatastrophize` (decatastrophizing protocol), `trigger` (hypothesis building). All share one card-form, but fields differ — so form fields live in **JSONB `data`** (one `kind` discriminator, no twin tables; add/change a field without a migration). `data` is validated per `kind` on input (discriminated union `DiaryData`/`TriggerData`/`DecatastrophizeData`).

## Access — granted, not default-on

- Personal endpoints `/api/cabin/{kind}` sit behind `require_cabin_access`. The section is closed while `users.can_access_cabin = false` (admin has access always).
- Admin grants via `PATCH /api/admin/users/{id}` (`can_access_cabin=true`); the false→true transition sends a `cabin_granted` notification (click → `/cabin`). See [AUTH.md](AUTH.md), [NOTIFICATIONS.md](NOTIFICATIONS.md).
- Frontend hides the nav item and the `/cabin` route without access.

## Privacy & CRUD

- List/create/replace/delete own entries; `user_id` comes from the token (a foreign entry → 404).
- **Hard delete** — the one exception to soft delete (a personal note is not worth restoring).
- Admin read-only review: `/api/cabin/admin/users` (participants who have entries, with `total`, for the admin picker) and `/api/cabin/admin/{kind}?user_id=` (a participant's entries), under `require_admin`.

## Frontend note

Compact cards (collapsed, expand on click) via shared `CabinEntryCard`. Emotion diary groups entries by date (`groupBy: 'date'`); the new-entry Date field defaults to today. See [FRONTEND.md](FRONTEND.md).
