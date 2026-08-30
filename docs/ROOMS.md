# Rooms

> Source: docs/archive/{DATA_MODEL.md, DECISIONS.md, PLATFORM_SPEC.md §4.6/§4.14}, restructured 2026-07-06.
> Endpoints: `/api/rooms`. Tables: `rooms`, `room_members` (see [DATA_MODEL.md](DATA_MODEL.md)).

## Space types

| Type | Created by | Visibility |
|---|---|---|
| `dm` | any participant | the two participants only |
| `group` | any participant with `can_create_groups` (owner = creator) | invited members only |
| `channel` | admin only | all participants (implicit) |

Differences are behavior in code, not schema. Group/channel have their own `avatar_url`; a dm shows the peer's avatar.

## Membership & access checks

- `services/rooms.py` centralizes access: `load_room` + `assert_room_access`.
- "Is the user in the room?" depends on type:
  - `dm` / `group` → a `room_members` row exists.
  - `channel` → the user is a platform participant (rule in code).
- Member management (add/remove, owner/admin rights, idempotent, protects the last owner) for groups.
- `GET`/`DELETE /api/rooms/{id}` — room delete exists (see archived PROGRESS for history).
- **Observers** (`users.is_observer`, see [AUTH.md](AUTH.md)): **no room access at all** — `assert_room_access` returns 403 for every room type, including channels and the news channel. `GET /api/rooms` returns them an **empty list**; `GET /api/rooms/personal` → 403. Chat is entirely closed for them (materials-only). `assert_can_write` stays as a redundant write-path barrier.
- **Graduates** (`users.graduated_at`, see [SURVEY.md](SURVEY.md)): rooms stay fully readable (list, history, personal diary), but every write path is closed by `assert_can_write` → 403. The «Новый чат»/«Группа» buttons are hidden for them — a room they cannot write in is a dead end.
- **Cohort not started yet** (`today < intake.starts_on`, ARG-106): the whole Рубка (`/chats`, `/diaries` — `ChatLayout`) is replaced client-side with a "N days until start" placeholder, **except the news channel** (`rooms.is_news`) — reachable via the «Новости» nav item (`/news` → `NewsRedirect`), since the welcome popup content is itself a news post and must stay readable during the wait. Opening it this way still hides the room list/Чаты·Дневники switcher around it (`ChatLayout.hideRoomList`, set by `routes.tsx`'s `withCohortGate` when the open room is news) — it would only dead-end back into the same placeholder for every other room. Frontend-only — no backend gate, since it's the participant's own not-yet-relevant content, not another user's (unlike the Observer 403 above). See [DATA_MODEL.md](DATA_MODEL.md) "Cohort-pending gate".

## Channels — implicit access (variant А)

- No `room_members` rows are created for all users on a channel.
- Channel visibility is the rule "a platform participant sees all channels" — in code, not data.
- A `room_members` row for a channel appears **lazily**, only when a user first opens it, solely to store `last_read_message_id`. Avoids mass inserts and desync.

### Isolation by intake and plan (ARG-96)

"All channels" narrows for a regular (non-personal, non-news) channel: `rooms.intake_id`
(NULL = every intake) and `room_plans` (empty = every plan of the user's intake) both have to
pass — see [DATA_MODEL.md](DATA_MODEL.md) "Content isolation by intake and plan". Checked in
`assert_room_access` (channel branch) and mirrored in `list_rooms`' query filter so a
foreign-intake/plan channel doesn't even show up in the list. Admin bypasses both. Direct
`GET /api/rooms/{id}` on a channel outside the caller's intake/plan → 403 (same message as
"not a member" — existence isn't specially revealed beyond that). The news channel
(`is_news`) is exempt by construction — it stays cross-intake. `POST /api/rooms`
(`type='channel'`) and `PATCH /api/rooms/{id}` (channel edit, admin-only, rejects
personal/news) accept `intake_id`/`plan_ids`.

## DM dedup

- `rooms.dm_key` = canonical `"minUserId:maxUserId"`, `UNIQUE`. Creating a dm is deduplicated; races resolved via `IntegrityError`.

## Personal diary rooms

- `rooms.is_personal = true` marks a participant's personal homework-diary room. Homework entries are ordinary `messages` there. See [DYNAMICS.md](DYNAMICS.md).
- **Not owner-only.** The frontend's «Дневники» tab is a real "browse everyone's diary" feature (`RoomList.tsx`: own diary pinned, everyone else's under «Все дневники») — this is deliberate community/accountability UX, not an oversight.
- **Cohort-gated (ARG-96).** A diary room's own `intake_id` stays NULL on purpose (it's tied to a user, and the user already carries `intake_id`/`plan_id`) — so visibility of an *other* user's diary is computed by comparing the diary owner's and the viewer's `intake_id` **and** `plan_id` directly (`same_cohort` in `app/services/visibility.py`), not through the room's own columns or `room_plans`. Both fields must match (`NULL` matches `NULL` — no-intake/no-plan users share a bucket). The owner always sees their own diary regardless; admin sees every diary. Checked in `assert_room_access` (personal branch) and mirrored in `list_rooms`' query filter (`others_personal_same_cohort`), so a foreign-cohort diary is both invisible in the list and 403 on direct `GET /api/rooms/{id}`.
- **Grouped by tariff on the client.** `RoomOut.owner_plan_id`/`owner_plan_name` denormalize the diary owner's plan (batch-joined in `list_rooms`/`get_room`, `app/api/rooms.py`) so the frontend can subdivide «Все дневники» by tariff (`groupDiariesByPlan` in `features/chat/util.ts`) without a participant needing admin-only `/api/admin/users`. Group order follows `GET /api/plans` (active plans, price-ascending — the same order as `/api/admin/plans`); a participant with no `plan_id` falls into a trailing «Без тарифа» bucket. `GET /api/plans` (`app/api/plans.py`) is the public counterpart of `/api/admin/plans`: any authenticated user, id+name only (no price/description).

## News channel & repost

- **News channel** — one `rooms.is_news = true` room **per intake** (ARG-104; was a
  platform-wide singleton before — see docs/DECISIONS.md if resurrecting that). Gated by
  the same intake+plan double filter as a regular channel (ARG-96, `assert_room_access`) —
  a participant sees only their own intake's news, not other intakes'. `ensure_news_channel(session, intake_id)`
  gets-or-creates the channel for one intake; called from app lifespan (bootstraps a
  channel for every existing intake), from `repost_to_news`, and from
  `scripts/provision_second_intake.py`. `uq_rooms_news_per_intake` (partial unique on
  `intake_id` `WHERE is_news`) enforces one per intake. Top-level posts are admin-only;
  everyone in that intake reads.
- **Repost into news** — admin forwards a message from any room into the news channel of
  the **source room's own intake**. If the source room is cross-intake (`intake_id` NULL —
  group/dm/personal), the endpoint requires an explicit `target_intake_id` query param
  (400 without it) since there's nothing on the room to infer a target from. It is a
  **copy** (text/sticker/attachments) with `messages.forwarded_from_sender_id` set to the
  original author ("переслано от X" / forwarded from X), so the post lives independently
  of the original. Endpoint and mechanics in [MESSAGES.md](MESSAGES.md).
- **Admin "current intake" selector** — a session-only (not persisted) UI context set in
  `AdminLayout`, shared across the Задачи/КБ/Чаты admin screens (`stores/ui.ts`
  `adminCurrentIntakeId`). It only changes what the admin sees by default in those lists
  (a client-side filter, with a "filtered, not the full list" banner) and which intake a
  repost from a cross-intake room defaults to being asked about — it does **not** change
  server-side authorization; admin still bypasses the intake/plan gate entirely
  (`user.role == "admin"` in `assert_room_access`/`list_rooms`).
  - **Auto-defaults to the latest intake.** `AppShell` sets `adminCurrentIntakeId` to
    `GET /api/admin/intakes`' first row (newest `starts_on`) the first time it loads for
    an admin whose selector is still untouched (`null`) — otherwise every fresh session
    opened onto "all intakes at once", which read as noise once there are several. Fires
    **once per session** (a ref guard): after that, an admin picking «Все экспедиции»
    (back to `null`) in `/admin/expeditions` sticks — the auto-pick doesn't fight it.

## Stream subgroup rooms

- A `stream`-type task auto-creates one **group** room per bracket node at the moment
  that node becomes *ready* — i.e. every member has submitted the text of its round
  (`open_ready_node` → `ensure_node_room` in `services/stream.py`, modelled on
  `ensure_news_channel`). There is no global stage flip: a pair that finishes early gets
  its room immediately, while its neighbours are still writing. Name: `Поток «<задача>» · <Пара N|Четвёрка N|…|Финал>`;
  `created_by` = the task's admin. The link lives on `task_stream_nodes.room_id` — there is
  no column on `rooms`.
- Group rooms have **no lazy membership** (`assert_room_access` rejects a group without a
  `room_members` row), so rows are inserted for every node member at creation. A
  participant of a 16-person stream ends up in 4 such rooms — one per round.
- `RoomOut` carries `stream_node_id` / `stream_task_id` (resolved by a batch join in
  `list_rooms`) so the client can hang the phrase-voting widget on those rooms.
- Because the server creates them, members are told via the **`room.created`** WS event
  (fired `after_commit`, per member); without it the room would only appear after a
  reconnect. See [TASKS.md](TASKS.md) "Поток".
- **The room closes when the node's phrase is approved** (`close_node_room`, called from
  both approval paths — unanimity and an admin force). The stage is over; there is nothing
  left to agree on, and leaving it open would keep a per-round chat around forever.
  Closing = deleting the room's `room_members` rows: since group rooms have no lazy
  membership, the room then disappears from every list and returns 403 to everyone,
  admins included. The `rooms` row and its messages stay in the DB (there is no
  `rooms.deleted_at`, and `messages` FK it) — history survives, it is just unreachable;
  `task_stream_nodes.room_id` stays too, so `ensure_node_room` will not recreate it.
  Members are told via the **`room.closed`** WS event; `StreamNodeOut.room_id` goes `null`
  once the node is approved, so the UI stops linking to a room that would 403.

## Calendar link

Events may be room-scoped (`calendar_events.room_id`); their visibility follows room access. See [CALENDAR.md](CALENDAR.md).
