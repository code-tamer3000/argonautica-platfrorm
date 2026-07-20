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

## Channels — implicit access (variant А)

- No `room_members` rows are created for all users on a channel.
- Channel visibility is the rule "a platform participant sees all channels" — in code, not data.
- A `room_members` row for a channel appears **lazily**, only when a user first opens it, solely to store `last_read_message_id`. Avoids mass inserts and desync.

## DM dedup

- `rooms.dm_key` = canonical `"minUserId:maxUserId"`, `UNIQUE`. Creating a dm is deduplicated; races resolved via `IntegrityError`.

## Personal diary rooms

- `rooms.is_personal = true` marks a participant's personal homework-diary room. Homework entries are ordinary `messages` there. See [DYNAMICS.md](DYNAMICS.md).

## News channel & repost

- **News channel** — a singleton room with `rooms.is_news = true`, created in app lifespan (`ensure_news_channel`). Top-level posts are admin-only; everyone reads.
- **Repost into news** — admin forwards a message from any room into the news channel. It is a **copy** (text/sticker/attachments) with `messages.forwarded_from_sender_id` set to the original author ("переслано от X" / forwarded from X), so the post lives independently of the original. Endpoint and mechanics in [MESSAGES.md](MESSAGES.md).

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

## Calendar link

Events may be room-scoped (`calendar_events.room_id`); their visibility follows room access. See [CALENDAR.md](CALENDAR.md).
