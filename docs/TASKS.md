# Tasks (раздел «Задачи»)

> Source: backend/app/{models/task.py, api/tasks.py, services/tasks.py} + docs/archive/PROGRESS.md st.22, restructured 2026-07-06.
> Endpoints: `/api/tasks`. Tables: `tasks`, `task_media`, `task_assignments`, `task_submissions`, `task_submission_media`, `task_comments` (see [DATA_MODEL.md](DATA_MODEL.md)).

Author assigns work; participants submit; admin reviews. A task is either **common** (`type='common'` — visible to every active participant, anyone may submit) or **individual** (`type='individual'` — addressed to specific users via `task_assignments`).

## Assignments & lifecycle

- Individual tasks → `task_assignments` rows created at task creation. Common tasks → rows created **lazily on first submission** (implicit access, like channels).
- `task_assignments.status`: `assigned → submitted → returned → accepted`. `late` is set on the first submission after `deadline_at`.
- Submission history is kept (a return produces a new `task_submissions` row; the latest is the current one).

## Media

- **Prompt media** (`task_media`) — attached by admin to the task itself; mirror of `task_submission_media` (submission attachments). Both go through the shared `media_assets` / presigned flow (see [FILES.md](FILES.md)).
- `create_task` / `update_task` accept `media_asset_ids` → saved into `task_media`. `get_task` / `list_tasks` return `attachments` batch-signed via `resolve_task_attachments`.
- **Media access**: `assert_media_access` gates task media by task visibility — `common` → any participant; `individual` → assignee / admin.

## Review

- Admin review changes assignment status; a return writes a `task_comments` row (feedback) on the latest submission. Comments are soft-deleted.

## Deadlines

- `tasks.deadline_at` is synced into `calendar_events` (`services/tasks.py`) so deadlines show on the calendar. See [CALENDAR.md](CALENDAR.md).

## Realtime

WS events: `task.created`, `task.updated`, `task.submission_new`, `task.submission_status`, `task.comment_new` (see the event list in [MESSAGES.md](MESSAGES.md)).

## Frontend note

Task create/edit (admin) and participant submission share `components/MediaComposer.tsx` (markdown textarea + upload-with-progress + pending chips). See [FRONTEND.md](FRONTEND.md).
