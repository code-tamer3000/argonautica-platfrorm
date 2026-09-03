# Messages, Threads & Realtime

> Source: docs/archive/{DATA_MODEL.md, PLATFORM_SPEC.md §4.3–4.8/§4.14, DECISIONS.md}, restructured 2026-07-06.
> Endpoints: `/api/rooms/...`, WS `/ws`. Tables: `messages`, `message_attachments`, `pinned_messages`, `stickers`, `message_reactions` (see [DATA_MODEL.md](DATA_MODEL.md)). Every action re-checks room access (`load_room` + `assert_room_access`).

## Send / edit / delete

- **Send** — text, sticker, and/or attachments; a message must carry at least one of them. Attachments must be the sender's own assets (see [FILES.md](FILES.md)).
- **Attachments per message — max 6** (`MAX_ATTACHMENTS`, `schemas/message.py`); more → 422. Repeated ids in `attachment_ids` are collapsed (the list is deduped in the request validator — `message_attachments` is keyed by `(message_id, media_asset_id)`, so a duplicate used to fail the insert). Order in the feed is by `media_asset_id`, i.e. upload order. The repost path copies the source message's attachments as they are and is not capped.
- **Album (client-side grouping).** Two or more visual attachments (images, and videos whose transcode did not fail) render as ONE grid inside the bubble — `features/chat/MediaGroup.tsx`, layouts for 2..6 in `chat.module.css` (`.album2`…`.album6`, `.albumMany` for legacy messages above the cap). Tiles are `thumb_url` cropped with `object-fit: cover`, so the album is a fixed rectangle whose height is reserved by `aspect-ratio` before any byte loads. A tap opens the lightbox on that item and it pages through the whole group (arrows, ←/→, horizontal swipe, `n / total` counter — `components/Overlay.tsx`). A single attachment is unchanged: own proportions, native video player, voice player. Voice/files and failed-transcode videos stay separate blocks under the album. The composer's file input is `multiple`; it accepts up to 6 in total and says so when it truncates the selection.
- **@-mentions** — `@username` in the body generates a `mention` notification to each tagged user who can see the room (see [NOTIFICATIONS.md](NOTIFICATIONS.md)); parsing/authorization is server-side (client can't pick recipients). The composer offers @-autocomplete; the feed renders text as plain text with mentions highlighted (`lib/messageText.tsx`) in DMs, groups and the news channel, and as sanitized markdown (`lib/markdown.ts`, `marked`+DOMPurify) in journal channels (`room.type === 'channel' && !is_news` — «Дневник»/«Личный дневник», where participants keep daily formatted entries) — see [FRONTEND.md](FRONTEND.md).
- **Inline formatting** — bold/italic/underline, applied **WYSIWYG** in the composer: the message field is `contentEditable` (`Composer.tsx`), not a `<textarea>`, so a selection actually turns bold/italic/underlined right there while typing (`document.execCommand`, Ctrl/Cmd+B/I/U or the selection toolbar — `useRichFormatting.tsx`); on mobile the toolbar only shows for touch browsers without native support (see below) and docks at a fixed spot at the top of the screen rather than over the composer, since the OS's own text-selection callout is a native overlay above the page that a page-positioned toolbar can't out-z-index — iOS Safari sidesteps this entirely: WebKit adds Bold/Italic/Underline to its native selection menu for free on `contentEditable`. The DOM is serialized to markers **in `content` itself** only on submit: `**bold**`, `*italic*`, `++underline++` (`++` is not standard markdown — markdown has no underline, and `__x__` collides with bold in `marked`) — see `lib/inlineMarks.ts` (`htmlToMarkerText`/`markerTextToHtml`, the two-way DOM ⇄ marker-text conversion also used to restore a draft or admin-injected pending text into the field). No schema change: same markers, both render paths for already-sent messages. Everywhere `content` is shown as a short plain-text snippet (bell feed, web-push body, pinned-message preview, dashboard news preview, repost/thread context snippet), the markers are stripped first (`stripInlineMarks` / `strip_inline_marks`) so `**`/`++` never leak as literal characters — this is separate from, and runs alongside, the `<!--journal:key-->` marker strip. Editing an already-sent message (`MessageItem.tsx`'s inline editor) is still a plain textarea — out of scope for this WYSIWYG treatment, markers show raw there.
- **Edit** (`PATCH /api/rooms/{room_id}/messages/{message_id}`) — **author only** (admin does not rewrite others' text, unlike delete); sticker/attachment-only has nothing to edit → 400; sets `edited_at`.
- **Delete** — soft (`deleted_at`), by author or admin.
- **Observers** (`users.is_observer`, see [AUTH.md](AUTH.md)) have **no message access at all** — every room (including the news channel) is 403 via `assert_room_access`, so they can neither read nor write messages. Chat is closed for them; their sections are materials-only (КБ, Генные ключи).
- **Graduates** (`users.graduated_at`, see [SURVEY.md](SURVEY.md)) keep **read access everywhere** — DMs, diary, channels, full history — but write nothing: `assert_can_write` refuses send/edit/delete/pin with `GRADUATED_MESSAGE` («Аргонавт, ты прошёл Экспедицию»), and the WS handler drops their `typing`. The frontend replaces the composer (and the diary form) with `GraduatedNotice` carrying the same sentence, and prunes the write items from the message menu.

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

## Reactions (MVP: one fixed image)

- `POST /api/rooms/{room_id}/messages/{message_id}/reaction` (idempotent, 201/200), `DELETE …/reaction` (204, 404 if the caller never reacted). One reaction per user per message (`message_reactions`, PK `(message_id, user_id)` — no emoji column, there is exactly one reaction image, hardcoded as a frontend asset; the backend never stores or serves it).
- Right to react = right to write (`assert_room_access` + `assert_can_write`) — **no extra role gate**, unlike pins: any non-observer/non-graduated member can react, even in rooms where posting itself is restricted (news channel, personal diary).
- `MessageOut.reaction_count` (total) / `reacted_by_me` (for the requesting viewer) are computed at read time from `message_reactions`, batched per page/thread (no N+1) — same style as `unread_reply_count`.
- No standalone reactions list and no cleanup on message soft-delete: a deleted message just drops out of every feed query, so orphaned reaction rows are harmless.
- Toggle UX: tap adds your reaction; tapping your own already-placed reaction removes it (like Telegram). Entry points: the reaction chip once `reaction_count > 0`, or "Поставить/убрать реакцию" in the message action menu to place the first one.

## Refs (link to a KB item / task)

- A message may carry **one** reference to a **KB item** or a **task** (`messages.ref_kind ∈ {'kb','task'}` + `ref_id`, both or neither — CHECK in [DATA_MODEL.md](DATA_MODEL.md)), **alongside** any media/text/sticker. No FK on the target: it's resolved lazily, so a deleted/unpublished target degrades to «недоступно» rather than breaking the message.
- **Send** (`SendMessageRequest.ref_kind`/`ref_id`) checks the target is **visible to the sender** (anti-IDOR): KB → `published` or admin; task → `assert_task_visible` (common→all; individual→assignee/admin; pair→member). Not visible/existent → 404 (a draft's existence isn't revealed). A ref satisfies "must carry something" on its own.
- **Read** — `MessageOut.ref` (`{kind, id, title, url, available}`) is resolved **per viewer** (`resolve_message_refs`): a viewer without access to the target gets `available=false` and a placeholder title (no leak). `url` is `/kb/{id}` or `/tasks/{id}`; the client only navigates, target screens re-check access server-side.
- **WS `message.new`/`message.edited`** carry a **conservatively-resolved** ref (`resolve_ref_for_broadcast`): the real title is exposed only for a universally-visible target (published KB / common task), else a placeholder with `available=false` — the payload is one body for all subscribers, so it must not reveal a draft/individual title. Authorized viewers get the correct title on the next feed load.
- **Repost into news** copies `ref_kind`/`ref_id` alongside media.
- Editing a message changes only text; the ref is fixed at send time (like attachments).

## Repost into news

- `POST /api/rooms/{id}/messages/{mid}/repost?target_intake_id=<id>` (admin only) — copies text/sticker/attachments into the news channel of the source room's own intake, preserving the original author via `forwarded_from_sender_id`. `target_intake_id` is only read (and required, 400 without it) when the source room is cross-intake (`intake_id` NULL); otherwise it's ignored — the source room's own intake wins. News channel details, including the ARG-104 per-intake change, in [ROOMS.md](ROOMS.md).

## Voice messages

- Recorded audio is a normal attachment with `media_assets.kind='audio'`, same presigned flow. See [FILES.md](FILES.md).

## Realtime (WebSocket + Redis)

- Delivery always via **Redis pub/sub** (room channel `room:*`), independent of worker count.
- WS endpoint `/ws`: JWT handshake via `?token=`, presence via Redis refcount, subscribe requires access check.
- Typing and presence are **ephemeral (Redis only)**, never written to Postgres — see Redis uses in [DATA_MODEL.md](DATA_MODEL.md).

**Client → server:** `{"type":"subscribe"|"unsubscribe"|"typing", "room_id":int}`, `{"type":"ping"}`.

**Server → client events** (`{"type": ...}`): `message.new`, `message.edited`, `message.deleted`, `attachment.updated`, `pin.added`, `pin.removed`, `reaction.added`, `reaction.removed`, `read`, `typing`, `presence`, `subscribed`, `unsubscribed`, `error`, `pong`, `notification.new`, `notification.removed`, plus task events (`task.created`, `task.updated`, `task.submission_new`, `task.submission_status`, `task.comment_new` — see [TASKS.md](TASKS.md)) and `room.created`.

- `message.*` carry fully-resolved attachments (presigned url/thumb_url) in the payload — see [FILES.md](FILES.md).
- **`reaction.added`/`reaction.removed`** (`{room_id, message_id, user_id, count}`) — deliberately **not** a full `MessageOut`: `count` is the same for every subscriber, but `reacted_by_me` is per-viewer and doesn't belong in one shared broadcast payload. Each client patches only the matching message's `reaction_count` and sets its own `reacted_by_me` iff `user_id` is its own id. Consequence: `message.edited` (which *does* replace the whole cached message) must not clobber a viewer's own `reacted_by_me` — the frontend cache merge preserves it across an edit.
- **`room.created`** (`{room_id}`) — the server added the user to a room it created itself (stream subgroup rooms, see [ROOMS.md](ROOMS.md)). Delivered on the per-user channel; the client just invalidates the rooms list. Without it a server-made room only shows up after a WS reconnect.
- **`attachment.updated`** (`{room_id, message_id, attachment}`) — a server video transcode finished: the payload is the fresh `AttachmentOut` (new `transcode_status` + variant url when `done`). The client finds the attachment by `asset_id` inside the message and swaps it in place (`processing` → playable, or → `failed`). Published to the room channel by the transcode worker (not the request path) once the variant is ready or the job terminally failed. Task/KB videos have no room channel, so they pick up the variant on the next fetch instead. See [FILES.md](FILES.md) "Video transcode".
- Blue-green deploy tears sockets down; the client reconnects and re-subscribes — see [FRONTEND.md](FRONTEND.md).
