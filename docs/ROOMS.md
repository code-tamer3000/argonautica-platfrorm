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

## Calendar link

Events may be room-scoped (`calendar_events.room_id`); their visibility follows room access. See [CALENDAR.md](CALENDAR.md).
