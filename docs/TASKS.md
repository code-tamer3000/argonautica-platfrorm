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

## Attention badge

- `attention_count` (in `list_tasks`, feeds the «Задачи» nav badge) = user's assignments not yet `accepted` (`assigned`/`submitted`/`returned`, common & individual) **plus** untouched common tasks (no assignment row yet). Accepting a task decrements it; when everything is accepted it is 0. A freshly assigned individual task increments it immediately. See `attention_count` in `services/tasks.py`.

## Progress counts (per task row)

`list_tasks` / `get_task` return per-task aggregates so the admin sees progress on the «Задачи» section itself (no need to open the management panel):

- `submitted_count` — assignments in `submitted`/`returned`/`accepted` (i.e. "сдали"); `accepted_count` — `accepted`; `unreviewed_count` — `submitted` only (awaiting review).
- `total_recipients` — the "из скольки" denominator: **individual** → assignee count; **common** → active participant count (`participant_count` in `services/tasks.py`), since common assignment rows are created lazily.
- `assignee_count` stays `individual`-only (null for common).

## Deadlines

- `tasks.deadline_at` is synced into `calendar_events` (`services/tasks.py`) so deadlines show on the calendar. Deadline events are **enriched** per viewer — see [CALENDAR.md](CALENDAR.md).

## Realtime

WS events: `task.created`, `task.updated`, `task.submission_new`, `task.submission_status`, `task.comment_new` (see the event list in [MESSAGES.md](MESSAGES.md)).

## Frontend note

Task create/edit (admin) and participant submission share `components/MediaComposer.tsx` (markdown textarea + upload-with-progress + pending chips). See [FRONTEND.md](FRONTEND.md).
