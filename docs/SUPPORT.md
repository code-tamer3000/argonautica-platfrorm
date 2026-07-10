# Support

> Source: docs/archive/{PLATFORM_SPEC.md §4.17, DATA_MODEL.md, PROGRESS.md st.21}, restructured 2026-07-06.
> Endpoints: `/api/feedback`, `/api/faq` (+ admin under `/api/admin/feedback`). Tables: `feedback`, `faq_items` (see [DATA_MODEL.md](DATA_MODEL.md)).

## Feedback

Participant submissions: "suggest an improvement" / "report a bug".

- `POST /api/feedback` — any participant; `kind` = `improvement` | `bug`; author from the token.
- Admin triage in "Управление": `GET /api/admin/feedback` (feed, newest first), `PATCH /api/admin/feedback/{id}` (mark resolved → sets `resolved_at`).
- Triage UI splits into tabs **Активные** (unresolved) / **Завершённые** (resolved). Marking «Разобрано» drops the action buttons and shows a status label — «Решено» for `bug`, «Реализовано» for `improvement` — with a «Вернуть в работу» breadcrumb link that clears `resolved_at`.

## FAQ

Common questions/instructions — admin-authored, read by all.

- `GET /api/faq` — read (everyone). `POST/PATCH/DELETE /api/faq` — admin only; `sort_order` controls order (smaller = higher; ties by id).
