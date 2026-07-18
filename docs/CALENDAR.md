# Calendar

> Source: docs/archive/{PLATFORM_SPEC.md §4.10, DATA_MODEL.md, PROGRESS.md st.9}, restructured 2026-07-06.
> Endpoints: `/api/calendar`. Table: `calendar_events` (see [DATA_MODEL.md](DATA_MODEL.md)).

Project events (dates, titles, descriptions). An event is either **project-wide** (`room_id = NULL`) or **room/channel-scoped** (`room_id` set).

> **Observers** (`users.is_observer`, see [AUTH.md](AUTH.md)) have no calendar access: the whole `/api/calendar` router is behind `require_participant` → 403.

## Endpoints

- CRUD **admin only**: `POST/PATCH/DELETE /api/calendar/events` (validates `ends_at >= starts_at`).
- Read (participants): `GET /api/calendar/events` — project-wide events visible to all; a room event only when the caller has room access (same visibility as the room list). Filters: `from` / `to` / `room_id`.
- `GET /api/calendar/events/{id}` — for a room event, `assert_room_access` (see [ROOMS.md](ROOMS.md)).

## Task deadline events

Task deadlines are synced into `calendar_events` (`task_id` set) — see [TASKS.md](TASKS.md). On `GET /events` these rows are **enriched per viewer** (`_enrich_task_events` in `api/calendar.py`), so the UI can render them as a soft, task-flavoured entry (task icon + title, link to `/tasks/{id}`) distinct from plain announcements:

- `task_done` — participant only: whether the caller's own assignment is `accepted` (mirrors the "done" look in the Tasks section). Always `false` for admins.
- `task_submitted_count` / `task_total_count` — **admin only** ("сдали X из Y"); `null` for participants (never leak others' progress — anti-IDOR). Denominator = assignee count for individual tasks, participant count for common (lazy assignments).

Enrichment is batched (one aggregate query for the whole list). `GET /events/{id}` returns the raw event (no enrichment); the calendar UI reads from the list.

## Related

Task deadlines are synced into `calendar_events` — see [TASKS.md](TASKS.md).
