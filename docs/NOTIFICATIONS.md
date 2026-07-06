# Notifications (bell)

> Source: docs/archive/{PLATFORM_SPEC.md §4.15, DATA_MODEL.md, DECISIONS.md, PROGRESS.md st.20/26}, restructured 2026-07-06.
> Endpoints: `/api/notifications`. Table: `notifications` (see [DATA_MODEL.md](DATA_MODEL.md)). Service: `services/notifications.py`.

In-app notification feed (header bell). Stored in **Postgres** (needs history, survives reload, future web-push) — this is domain data, unlike ephemeral typing/presence.

## Kinds

| kind | Trigger | room_id / message_id / actor_id |
|---|---|---|
| `dm` | direct message to you | set |
| `reply` | reply in a thread on your message | set |
| `news` | post in the news channel | set |
| `journal_missed` | yesterday's homework day not closed (system) | room_id = personal diary; message/actor NULL; `ref_date` = the day (dedup) |
| `cabin_granted` | admin opened Cabin access to you (system) | all of room/message/actor NULL |

## Generation & delivery

- Message-driven kinds are generated in the send transaction (`on_new_message`): recipients = thread-root author (reply) / the other dm participant / everyone (news).
- `journal_missed` — `ensure_journal_notifications` / `clear_journal_missed_notification`. `cabin_granted` — `notify_cabin_granted` on the `can_access_cabin` false→true transition (see [CABIN.md](CABIN.md)).
- Realtime delivery over the personal Redis pub/sub channel `user:{id}` → WS events `notification.new` / `notification.removed` (see [MESSAGES.md](MESSAGES.md)).

## Endpoints

- `GET /api/notifications` — feed. `POST /api/notifications/read` — mark read.
- Indexes: `(user_id, id)` feed; partial `WHERE read_at IS NULL` unread count.

## Out of MVP

Web Push (delivery while the app is closed; iOS restrictions) — the open WS only delivers while active. See [FRONTEND.md](FRONTEND.md).
