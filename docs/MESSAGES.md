# Messages, Threads & Realtime

> Source: docs/archive/{DATA_MODEL.md, PLATFORM_SPEC.md §4.3–4.8/§4.14, DECISIONS.md}, restructured 2026-07-06.
> Endpoints: `/api/rooms/...`, WS `/ws`. Tables: `messages`, `message_attachments`, `pinned_messages`, `stickers` (see [DATA_MODEL.md](DATA_MODEL.md)). Every action re-checks room access (`load_room` + `assert_room_access`).

## Send / edit / delete

- **Send** — text, sticker, and/or attachments; a message must carry at least one of them. Attachments must be the sender's own assets (see [FILES.md](FILES.md)).
- **@-mentions** — `@username` in the body generates a `mention` notification to each tagged user who can see the room (see [NOTIFICATIONS.md](NOTIFICATIONS.md)); parsing/authorization is server-side (client can't pick recipients). The composer offers @-autocomplete; the feed renders text as plain text with mentions highlighted (`lib/messageText.tsx`) in DMs, groups and the news channel, and as sanitized markdown (`lib/markdown.ts`, `marked`+DOMPurify) in journal channels (`room.type === 'channel' && !is_news` — «Дневник»/«Личный дневник», where participants keep daily formatted entries) — see [FRONTEND.md](FRONTEND.md).
- **Edit** (`PATCH /api/rooms/{room_id}/messages/{message_id}`) — **author only** (admin does not rewrite others' text, unlike delete); sticker/attachment-only has nothing to edit → 400; sets `edited_at`.
- **Delete** — soft (`deleted_at`), by author or admin.

## Room feed & pagination

- Feed query: `room_id = X AND thread_root_id IS NULL AND deleted_at IS NULL`.
- Cursor by id: query params `before` / `after` (message id), `limit` (1–100, default 50). See [API_CONVENTIONS.md](API_CONVENTIONS.md).

## Threads (flat, Slack-style)

- `thread_root_id IS NULL` → top-level message in the room feed.
- `thread_root_id = X` → a reply under root X.
- **Flatness rule:** a reply never points at another reply. When replying to a message that is itself a reply, use its `thread_root_id`, not its `id`. No nesting by construction.
- **Denormalization:** `reply_count` and `last_reply_at` on the root, updated when a reply is added (show "N replies" without recount).
- **`unread_reply_count`** on each feed root — replies with `id > viewer.last_read_message_id` (computed at read time in `list_messages`, one grouped query per page; 0 elsewhere). Drives the "N новых" badge on the thread button.
- Open thread query: `thread_root_id = <root id>` (plus the root itself).
- **UI:** threads expand inline in the feed (accordion under the root), not in a side drawer. The "Тред · N · M новых" button toggles it; a long branch shows the last few replies with a "показать ещё" control. There is **no separate thread composer** — replying in a thread reuses the room's **main composer** in thread mode: a context bar above it holds **«Свернуть тред · N»** (collapses the branch + exits reply mode — always reachable without scrolling up) and the root snippet. Opening a thread scrolls the feed so the branch end + composer are in view. Attachments/stickers/voice all work; it sends with `reply_to_message_id = root id` (keeps the branch flat) via the direct mutate path (not the outbox — thread replies don't live in the room's optimistic feed). Thread replies are allowed even where top-level posting is not (comments in a news/read-only channel). Live via the same `message.new` → thread-query invalidation.

## Read receipts (no per-message table)

- Derived from one number, `room_members.last_read_message_id`, using monotonic `messages.id`:
  - unread for a user in a room = messages with `id > last_read_message_id`.
  - who read message M = members with `last_read_message_id >= M.id`.
- Reading a room moves the cursor forward (only forward). For channels the row is created lazily. Closes both the unread counter and the "seen" ticks with one mechanism. `unread_count` appears in the room list.

## Pins

- `POST /api/rooms/{room_id}/messages/{message_id}/pin` (idempotent), `DELETE …/pin`, `GET /api/rooms/{room_id}/pins`.
- Right to pin (`assert_can_pin`): group owner / platform admin; for dm either participant; for channel admin only.
- A deleted message is removed from pins; pins list skips deleted (no N+1).

## Stickers (sending)

- Sticker message: `content = NULL`, `sticker_id` set. Packs are admin-managed; participants read `GET /api/stickerpacks` (images presigned). See sticker tables in [DATA_MODEL.md](DATA_MODEL.md). Stickers are never deleted (FK from `messages.sticker_id`).

## Repost into news

- `POST /api/rooms/{id}/messages/{mid}/repost` (admin only) — copies text/sticker/attachments into the news channel, preserving the original author via `forwarded_from_sender_id`. News channel details in [ROOMS.md](ROOMS.md).

## Voice messages

- Recorded audio is a normal attachment with `media_assets.kind='audio'`, same presigned flow. See [FILES.md](FILES.md).

## Realtime (WebSocket + Redis)

- Delivery always via **Redis pub/sub** (room channel `room:*`), independent of worker count.
- WS endpoint `/ws`: JWT handshake via `?token=`, presence via Redis refcount, subscribe requires access check.
- Typing and presence are **ephemeral (Redis only)**, never written to Postgres — see Redis uses in [DATA_MODEL.md](DATA_MODEL.md).

**Client → server:** `{"type":"subscribe"|"unsubscribe"|"typing", "room_id":int}`, `{"type":"ping"}`.

**Server → client events** (`{"type": ...}`): `message.new`, `message.edited`, `message.deleted`, `pin.added`, `pin.removed`, `read`, `typing`, `presence`, `subscribed`, `unsubscribed`, `error`, `pong`, `notification.new`, `notification.removed`, plus task events (`task.created`, `task.updated`, `task.submission_new`, `task.submission_status`, `task.comment_new` — see [TASKS.md](TASKS.md)).

- `message.*` carry fully-resolved attachments (presigned url/thumb_url) in the payload — see [FILES.md](FILES.md).
- Blue-green deploy tears sockets down; the client reconnects and re-subscribes — see [FRONTEND.md](FRONTEND.md).
