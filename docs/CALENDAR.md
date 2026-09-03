# Calendar

> Source: docs/archive/{PLATFORM_SPEC.md §4.10, DATA_MODEL.md, PROGRESS.md st.9}, restructured 2026-07-06.
> Endpoints: `/api/calendar`. Tables: `calendar_events`, `calendar_event_plans` (see [DATA_MODEL.md](DATA_MODEL.md)).

Project events (dates, titles, descriptions), isolated by intake and plan — the same
double filter (`intake_visible`/`plan_visible`, see [DATA_MODEL.md](DATA_MODEL.md)
"Content isolation by intake and plan") used for channels/common tasks/KB items
(ARG-96/ARG-111). `intake_id` NULL = visible to every intake; empty `plan_ids` =
visible to every plan of the intake.

> Historical note (ARG-111): events used to also carry a `room_id` (event scoped to a
> channel's membership) — a coarser, effectively unused mechanism, replaced by
> intake/plan isolation. The column still exists in the DB (expand/contract) but the
> code no longer reads or writes it.

> **Observers** (`users.is_observer`, see [AUTH.md](AUTH.md)) have no calendar access: the whole `/api/calendar` router is behind `require_participant` → 403.

> **Cohort not started yet** (`today < intake.starts_on`, ARG-106): the Calendar screen is replaced client-side with a "N days until start" placeholder — same frontend-only gate as Рубка, see [ROOMS.md](ROOMS.md) and [DATA_MODEL.md](DATA_MODEL.md) "Cohort-pending gate". No API-level block.

## Endpoints

- CRUD **admin only**: `POST/PATCH/DELETE /api/calendar/events` (validates `ends_at >= starts_at`). `intake_id`/`plan_ids` are whitelisted create/patch fields, same convention as KB items/tasks.
- Read (participants): `GET /api/calendar/events` — double filter (intake + plan) on the event's own `intake_id`/`plan_ids`; admin sees everything. Individual-task deadline events stay addressed to their assignee (own filter, unrelated to intake/plan). Filters: `from` / `to`.
- `GET /api/calendar/events/{id}` — `assert_calendar_event_visible` (403 for a foreign-intake/plan event, not 404 — calendar events aren't drafts, nothing to hide).

Frontend: the admin console (`/admin/calendar`) has the full flat list + form. Admins additionally get the same CRUD inline on the regular `/calendar` screen (`CalendarView.tsx`) — no separate endpoint: a "+ Событие" button in the selected day's panel opens the create form pre-filled with that day (`EventForm`, shared with `/admin/calendar` from `features/admin/EventForm.tsx`), and each plain announcement card gets "Редактировать"/"Удалить". Task-deadline cards (see below) are never editable from the calendar — they're generated from the task and are edited on the task itself.

## Task deadline events

Task deadlines are synced into `calendar_events` (`task_id` set) — see [TASKS.md](TASKS.md). On `GET /events` these rows are **enriched per viewer** (`_enrich_task_events` in `api/calendar.py`), so the UI can render them as a soft, task-flavoured entry (task icon + title, link to `/tasks/{id}`) distinct from plain announcements:

- `task_done` — participant only: whether the caller's own assignment is `accepted` (mirrors the "done" look in the Tasks section). Always `false` for admins.
- `task_submitted_count` / `task_total_count` — **admin only** ("сдали X из Y"); `null` for participants (never leak others' progress — anti-IDOR). Denominator = assignee count for individual tasks, participant count for common (lazy assignments).

Enrichment is batched (one aggregate query for the whole list). `GET /events/{id}` returns the raw event (no enrichment); the calendar UI reads from the list.

## Related

Task deadlines are synced into `calendar_events` — see [TASKS.md](TASKS.md).
