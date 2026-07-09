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
| `admin` | admin broadcast to everyone | room/message/actor NULL; `title`/`body` set (heading + text) |

## Generation & delivery

- Message-driven kinds are generated in the send transaction (`on_new_message`): recipients = thread-root author (reply) / the other dm participant / everyone (news).
- `journal_missed` — `ensure_journal_notifications` / `clear_journal_missed_notification`. `cabin_granted` — `notify_cabin_granted` on the `can_access_cabin` false→true transition (see [CABIN.md](CABIN.md)).
- `admin` — `broadcast_admin` (one row per user, `title`/`body` set). Endpoint: `POST /api/admin/notifications/broadcast` (admin-only, body `{title, body}`, returns `{recipients}`).
- Realtime delivery over the personal Redis pub/sub channel `user:{id}` → WS events `notification.new` / `notification.removed` (see [MESSAGES.md](MESSAGES.md)).

## Endpoints

- `GET /api/notifications` — feed. `POST /api/notifications/read` — mark read.
- Indexes: `(user_id, id)` feed; partial `WHERE read_at IS NULL` unread count.

## Native push (Web Push / VAPID)

Delivery while the app is closed, via the standard W3C Web Push protocol (self-hosted, no third party — `pywebpush` with a VAPID keypair from env). Layered **on top of** the same generation points as the in-app feed: wherever we write a `notifications` row + publish the `user:{id}` WS event, we also `enqueue_push` (best-effort, fire-and-forget background task with its own session — never inside the request transaction, never blocking the response).

- Pushed kinds: `dm`, `reply`, `news`, `admin`, `cabin_granted`. `journal_missed` is **not** pushed (lazily generated on feed load — no event point). Deadlines are **not** pushed yet (no scheduler exists; deferred).
- Per-user prefs live in `User.settings["notifications"]`: master `push_enabled` + per-kind toggles (`dm`/`reply`/`news`/`admin`), all default on (opt-out). In-app feed is **not** gated by these — toggles only mute native delivery. See `services/notify_prefs.py` (`push_allowed`).
- Subscriptions: `push_subscriptions` table (one row per browser/device, unique `endpoint`). Endpoints returning 404/410 are pruned on send. Endpoints: `GET /api/push/vapid-key`, `POST /api/push/subscribe`, `POST /api/push/unsubscribe`. Without VAPID keys configured, `vapid-key`/`subscribe` return 503 and `enqueue_push` is a no-op (dev/test).
- Config: `VAPID_PUBLIC_KEY` / `VAPID_PRIVATE_KEY` / `VAPID_SUBJECT` env vars (generate the keypair once — see below). Frontend service worker (`frontend/src/sw.ts`, injectManifest) handles `push` → `showNotification` and `notificationclick` → focus/navigate. iOS delivers push **only** for an installed PWA (Add to Home Screen, iOS 16.4+) — surfaced in the profile UI.

Generate a VAPID keypair (once): `python -c "from py_vapid import Vapid01 as V; v=V(); v.generate_keys(); print(v.public_key, v.private_key)"` (or any Web Push VAPID generator) and set the env vars on each stand.
