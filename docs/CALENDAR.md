# Calendar

> Source: docs/archive/{PLATFORM_SPEC.md §4.10, DATA_MODEL.md, PROGRESS.md st.9}, restructured 2026-07-06.
> Endpoints: `/api/calendar`. Table: `calendar_events` (see [DATA_MODEL.md](DATA_MODEL.md)).

Project events (dates, titles, descriptions). An event is either **project-wide** (`room_id = NULL`) or **room/channel-scoped** (`room_id` set).

## Endpoints

- CRUD **admin only**: `POST/PATCH/DELETE /api/calendar/events` (validates `ends_at >= starts_at`).
- Read (participants): `GET /api/calendar/events` — project-wide events visible to all; a room event only when the caller has room access (same visibility as the room list). Filters: `from` / `to` / `room_id`.
- `GET /api/calendar/events/{id}` — for a room event, `assert_room_access` (see [ROOMS.md](ROOMS.md)).

## Related

Task deadlines are synced into `calendar_events` — see [TASKS.md](TASKS.md).
