# Data Model

> Source: docs/archive/DATA_MODEL.md (+ verified against backend/app/models/), restructured 2026-07-06.
> Single source of truth for the DB schema. Every table's columns live here and nowhere else;
> feature docs reference tables but never re-list columns. Behavior lives in the feature docs.

## Conventions

- **id** — `BIGSERIAL` PK. Sequential (not UUID) on purpose: read receipts rely on monotonic ids.
- **Timestamps** — `TIMESTAMPTZ`; `created_at` defaults to `now()`.
- **Strings** — `TEXT` (no length caps without reason).
- **Enums** — `TEXT` + `CHECK` on the allowed set.
- **Soft delete** — `deleted_at` (`NULL` = alive) where applicable; rows not physically removed. Exception: `cabin_entries` are hard-deleted.
- **FKs** — all with explicit referential constraints.

---

## users
Login is **`username`** (the Telegram handle; closed platform, no self-signup — admin provisions). `email` is optional.

| Field | Type | Constraints | Notes |
|---|---|---|---|
| id | BIGSERIAL | PK | |
| username | TEXT | NOT NULL, UNIQUE | login = TG handle (без `@`) |
| email | TEXT | UNIQUE, NULL | optional |
| password_hash | TEXT | NOT NULL | argon2, never plaintext |
| display_name | TEXT | NOT NULL | |
| avatar_url | TEXT | NULL | legacy/external URL (media_id takes priority) |
| avatar_media_id | BIGINT | FK media_assets, NULL | avatar as media asset; presigned-GET on read |
| bio | TEXT | NULL | |
| role | TEXT | NOT NULL, default `'participant'`, CHECK | `'participant'` \| `'admin'` |
| must_change_password | BOOLEAN | NOT NULL, default false | one-time password issued → must change on login |
| can_create_groups | BOOLEAN | NOT NULL, default true | admin can revoke |
| can_access_cabin | BOOLEAN | NOT NULL, default false | grants Cabin; admin has it implicitly. See [CABIN.md](CABIN.md) |
| settings | JSONB | NOT NULL, default `'{}'` | UI prefs; no migration per key |
| created_at | TIMESTAMPTZ | NOT NULL | |
| updated_at | TIMESTAMPTZ | NOT NULL | |

## rooms
One entity for three space types; differences are behavior in code, not structure. See [ROOMS.md](ROOMS.md).

| Field | Type | Constraints | Notes |
|---|---|---|---|
| id | BIGSERIAL | PK | |
| type | TEXT | NOT NULL | `'dm'` \| `'group'` \| `'channel'` |
| name | TEXT | NULL | NULL for dm |
| avatar_url | TEXT | NULL | group/channel avatar; dm uses peer's avatar |
| dm_key | TEXT | UNIQUE, NULL | dm only: canonical `"minUserId:maxUserId"`, dedup guard |
| created_by | BIGINT | FK users, NOT NULL | |
| created_at | TIMESTAMPTZ | NOT NULL | |
| is_personal | BOOLEAN | NOT NULL, default false | personal diary room (Dynamics). See [DYNAMICS.md](DYNAMICS.md) |
| is_news | BOOLEAN | NOT NULL, default false | news channel singleton; top posts admin-only |

## room_members
Carries **membership** and **read state**. For channels, rows are created lazily (only to store read state) — see [ROOMS.md](ROOMS.md).

| Field | Type | Constraints | Notes |
|---|---|---|---|
| room_id | BIGINT | FK rooms, PK | |
| user_id | BIGINT | FK users, PK | |
| role_in_room | TEXT | NOT NULL, default `'member'` | `'owner'` \| `'member'` |
| joined_at | TIMESTAMPTZ | NOT NULL | |
| last_read_message_id | BIGINT | FK messages, NULL | read-receipt cursor. See [MESSAGES.md](MESSAGES.md) |
| is_muted | BOOLEAN | NOT NULL, default false | |

**PK:** (`room_id`, `user_id`).

## messages
Central table; threads live here too. See [MESSAGES.md](MESSAGES.md).

| Field | Type | Constraints | Notes |
|---|---|---|---|
| id | BIGSERIAL | PK | monotonic — required for read receipts |
| room_id | BIGINT | FK rooms, NOT NULL | |
| sender_id | BIGINT | FK users, NOT NULL | |
| content | TEXT | NULL | NULL if sticker/attachment-only |
| thread_root_id | BIGINT | FK messages, NULL | NULL = top level; set = reply, points at root |
| sticker_id | BIGINT | FK stickers, NULL | if message is a sticker |
| forwarded_from_sender_id | BIGINT | FK users, NULL | repost into news: original author. See [MESSAGES.md](MESSAGES.md) |
| reply_count | INT | NOT NULL, default 0 | denormalized on root |
| last_reply_at | TIMESTAMPTZ | NULL | denormalized on root |
| created_at | TIMESTAMPTZ | NOT NULL | |
| edited_at | TIMESTAMPTZ | NULL | |
| deleted_at | TIMESTAMPTZ | NULL | soft delete |

**Index:** (`room_id`, `thread_root_id`, `created_at`).

## message_attachments
| Field | Type | Constraints | Notes |
|---|---|---|---|
| message_id | BIGINT | FK messages, PK | |
| media_asset_id | BIGINT | FK media_assets, PK | |

**PK:** (`message_id`, `media_asset_id`).

## pinned_messages
Separate table (not a flag) to keep several pins, order, and who pinned. See [MESSAGES.md](MESSAGES.md).

| Field | Type | Constraints | Notes |
|---|---|---|---|
| room_id | BIGINT | FK rooms, PK | |
| message_id | BIGINT | FK messages, PK | |
| pinned_by | BIGINT | FK users | |
| pinned_at | TIMESTAMPTZ | NOT NULL | |

**PK:** (`room_id`, `message_id`).

## media_assets
Metadata for all files; bytes live in MinIO. See [FILES.md](FILES.md).

| Field | Type | Constraints | Notes |
|---|---|---|---|
| id | BIGSERIAL | PK | |
| bucket | TEXT | NOT NULL | e.g. `chat-media`, `kb-media` |
| storage_key | TEXT | NOT NULL | object key, e.g. `2026/06/<uuid>.mp4` |
| thumb_key | TEXT | NULL | preview key; NULL = no preview |
| kind | TEXT | NOT NULL | `'image'` \| `'video'` \| `'file'` \| `'audio'` (voice) |
| mime_type | TEXT | NOT NULL | |
| size | BIGINT | NOT NULL | bytes |
| width | INT | NULL | image/video |
| height | INT | NULL | image/video |
| duration | INT | NULL | seconds, video |
| created_by | BIGINT | FK users, NOT NULL | |
| created_at | TIMESTAMPTZ | NOT NULL | |

Public URL is not stored: access is via presigned URL after an auth check (see [FILES.md](FILES.md)).

## stickerpacks / stickers
Admin adds packs. Sticker message: `content = NULL`, `sticker_id` set.

**stickerpacks**

| Field | Type | Constraints | Notes |
|---|---|---|---|
| id | BIGSERIAL | PK | |
| name | TEXT | NOT NULL | |
| created_by | BIGINT | FK users | admin |
| created_at | TIMESTAMPTZ | NOT NULL | |

**stickers**

| Field | Type | Constraints | Notes |
|---|---|---|---|
| id | BIGSERIAL | PK | |
| pack_id | BIGINT | FK stickerpacks | |
| image_url | TEXT | NULL | legacy/external URL (nullable; media_id takes priority) |
| image_media_id | BIGINT | FK media_assets, NULL | sticker image as media asset |
| keyword | TEXT | NULL | search/substitution |
| sort_order | INT | NOT NULL, default 0 | |

## Knowledge base
See [KB.md](KB.md). **kb_categories** is out-of-MVP (structure only).

**kb_categories**

| Field | Type | Constraints | Notes |
|---|---|---|---|
| id | BIGSERIAL | PK | |
| title | TEXT | NOT NULL | |
| sort_order | INT | NOT NULL, default 0 | |

**kb_items**

| Field | Type | Constraints | Notes |
|---|---|---|---|
| id | BIGSERIAL | PK | |
| category_id | BIGINT | FK kb_categories, NULL | NULL = flat list (MVP) |
| title | TEXT | NOT NULL | |
| body | TEXT | NULL | markdown |
| published | BOOLEAN | NOT NULL, default false | draft / published |
| created_by | BIGINT | FK users | admin |
| sort_order | INT | NOT NULL, default 0 | |
| created_at | TIMESTAMPTZ | NOT NULL | |
| updated_at | TIMESTAMPTZ | NOT NULL | |

**kb_item_media** — PK (`kb_item_id`, `media_asset_id`); FKs to kb_items, media_assets.

**kb_comments**

| Field | Type | Constraints | Notes |
|---|---|---|---|
| id | BIGSERIAL | PK | |
| kb_item_id | BIGINT | FK kb_items, NOT NULL | |
| author_id | BIGINT | FK users, NOT NULL | |
| body | TEXT | NOT NULL | |
| created_at | TIMESTAMPTZ | NOT NULL | index (`kb_item_id`, `created_at`) |
| deleted_at | TIMESTAMPTZ | NULL | soft delete (author/admin) |

## calendar_events
See [CALENDAR.md](CALENDAR.md).

| Field | Type | Constraints | Notes |
|---|---|---|---|
| id | BIGSERIAL | PK | |
| title | TEXT | NOT NULL | |
| description | TEXT | NULL | |
| starts_at | TIMESTAMPTZ | NOT NULL | |
| ends_at | TIMESTAMPTZ | NULL | |
| all_day | BOOLEAN | NOT NULL, default false | |
| room_id | BIGINT | FK rooms, NULL | NULL = project-wide; set = room/channel event |
| created_by | BIGINT | FK users | usually admin |
| created_at | TIMESTAMPTZ | NOT NULL | |

## Dynamics (journal_programs / journal_sections / journal_pardons / journal_credits)
Homework entries are `messages` in the personal room — no entry table. The diary
**structure** is versioned by date (задания). See [DYNAMICS.md](DYNAMICS.md).

**journal_programs** — a diary-structure version (задание) effective from `starts_on`.

| Field | Type | Constraints | Notes |
|---|---|---|---|
| id | BIGSERIAL | PK | |
| starts_on | DATE | NOT NULL, UNIQUE | active on day D = greatest `starts_on <= D` |
| title | TEXT | NULL | |
| description | TEXT | NULL | |
| created_by | BIGINT | FK users, NULL | NULL = system/seed program |
| created_at | TIMESTAMPTZ | NOT NULL | |

**journal_sections** — one section of a задание (order via `position`).

| Field | Type | Constraints | Notes |
|---|---|---|---|
| id | BIGSERIAL | PK | |
| program_id | BIGINT | FK journal_programs ON DELETE CASCADE, NOT NULL | |
| key | TEXT | NOT NULL | slug `[a-z0-9_]+`, used in `<!--journal:{key}-->` marker |
| position | INT | NOT NULL | display/order |
| emoji | TEXT | NOT NULL, default '' | |
| label | TEXT | NOT NULL | chip caption |
| heading | TEXT | NOT NULL, default '' | markdown heading of the entry (empty for `title`) |
| placeholder | TEXT | NOT NULL, default '' | composer hint |
| input_type | TEXT | NOT NULL, default 'text' | `'text'` \| `'title'` |

**UNIQUE:** (`program_id`, `key`), (`program_id`, `position`). **INDEX:** (`program_id`).


**journal_pardons** — self-forgiven missed day (limit 3).

| Field | Type | Constraints | Notes |
|---|---|---|---|
| id | BIGSERIAL | PK | |
| user_id | BIGINT | FK users, NOT NULL | |
| date | DATE | NOT NULL | pardoned day |
| used_at | TIMESTAMPTZ | NOT NULL | |

**UNIQUE:** (`user_id`, `date`).

**journal_credits** — admin manual credit for a day (no limit).

| Field | Type | Constraints | Notes |
|---|---|---|---|
| id | BIGSERIAL | PK | |
| user_id | BIGINT | FK users, NOT NULL | credited user |
| date | DATE | NOT NULL | credited day |
| granted_by | BIGINT | FK users, NOT NULL | admin |
| granted_at | TIMESTAMPTZ | NOT NULL | |

**UNIQUE:** (`user_id`, `date`).

## notifications
Bell feed + native push source. Domain data in Postgres (history, reload, web-push). See [NOTIFICATIONS.md](NOTIFICATIONS.md).

| Field | Type | Constraints | Notes |
|---|---|---|---|
| id | BIGSERIAL | PK | |
| user_id | BIGINT | FK users, NOT NULL | recipient |
| kind | TEXT | NOT NULL, CHECK | `'dm'` \| `'reply'` \| `'news'` \| `'cabin_granted'` \| `'admin'` (+ legacy `'journal_missed'`, no longer generated) |
| room_id | BIGINT | FK rooms, NULL | NULL for `cabin_granted`/`admin` |
| message_id | BIGINT | FK messages, NULL | NULL for system kinds |
| actor_id | BIGINT | FK users, NULL | NULL for system kinds |
| ref_date | DATE | NULL | legacy (`journal_missed` dedup key); unused now |
| title | TEXT | NULL | `admin` broadcast heading |
| body | TEXT | NULL | `admin` broadcast text (preview derived from it) |
| created_at | TIMESTAMPTZ | NOT NULL | |
| read_at | TIMESTAMPTZ | NULL | NULL = unread |

**Indexes:** (`user_id`, `id`) feed; partial (`user_id`) `WHERE read_at IS NULL` unread count.

## push_subscriptions
Web Push (VAPID) browser/device subscriptions. One row per registered push endpoint. See [NOTIFICATIONS.md](NOTIFICATIONS.md).

| Field | Type | Constraints | Notes |
|---|---|---|---|
| id | BIGSERIAL | PK | |
| user_id | BIGINT | FK users ON DELETE CASCADE, NOT NULL, index | owner |
| endpoint | TEXT | NOT NULL, UNIQUE | push-service URL (natural key) |
| p256dh | TEXT | NOT NULL | subscription public key |
| auth | TEXT | NOT NULL | subscription auth secret |
| user_agent | TEXT | NULL | diagnostics |
| created_at | TIMESTAMPTZ | NOT NULL | |

Dead endpoints (404/410 on send) are pruned automatically. Per-kind push prefs are **not** here — they live in `users.settings["notifications"]` (JSONB).

## Support (feedback / faq_items)
See [SUPPORT.md](SUPPORT.md).

**feedback**

| Field | Type | Constraints | Notes |
|---|---|---|---|
| id | BIGSERIAL | PK | |
| user_id | BIGINT | FK users, NOT NULL | author (from token) |
| kind | TEXT | NOT NULL, CHECK | `'improvement'` \| `'bug'` |
| body | TEXT | NOT NULL | |
| created_at | TIMESTAMPTZ | NOT NULL | index: admin feed, newest first |
| resolved_at | TIMESTAMPTZ | NULL | NULL until admin marks resolved |

**faq_items**

| Field | Type | Constraints | Notes |
|---|---|---|---|
| id | BIGSERIAL | PK | |
| question | TEXT | NOT NULL | |
| answer | TEXT | NOT NULL | |
| sort_order | INT | NOT NULL, default 0 | manual order (ties by id) |
| created_at | TIMESTAMPTZ | NOT NULL | |
| updated_at | TIMESTAMPTZ | NOT NULL | |

## cabin_entries
Каюта (private psych journaling). Form fields per subkind live in JSONB `data`. Hard delete. See [CABIN.md](CABIN.md).

| Field | Type | Constraints | Notes |
|---|---|---|---|
| id | BIGSERIAL | PK | |
| user_id | BIGINT | FK users, NOT NULL | author (from token) |
| kind | TEXT | NOT NULL, CHECK | `'diary'` \| `'decatastrophize'` \| `'trigger'` |
| data | JSONB | NOT NULL | form fields; shape depends on `kind` (validated in `schemas/cabin.py`) |
| created_at | TIMESTAMPTZ | NOT NULL | |
| updated_at | TIMESTAMPTZ | NOT NULL | `onupdate=now()` |

**Index:** (`user_id`, `kind`, `created_at`).

## Tasks
Section "Задачи". Six tables. See [TASKS.md](TASKS.md).

**tasks**

| Field | Type | Constraints | Notes |
|---|---|---|---|
| id | BIGSERIAL | PK | |
| type | TEXT | NOT NULL, CHECK | `'common'` \| `'individual'` |
| title | TEXT | NOT NULL | |
| body | TEXT | NULL | markdown |
| kb_item_id | BIGINT | FK kb_items, NULL | optional link to a KB item |
| deadline_at | TIMESTAMPTZ | NULL | synced to `calendar_events` (services/tasks.py) |
| created_by | BIGINT | FK users, NOT NULL | |
| created_at | TIMESTAMPTZ | NOT NULL | |
| deleted_at | TIMESTAMPTZ | NULL | soft delete |

**task_media** — task-prompt media (admin), mirror of task_submission_media. PK (`task_id`, `media_asset_id`).

**task_assignments**

| Field | Type | Constraints | Notes |
|---|---|---|---|
| id | BIGSERIAL | PK | |
| task_id | BIGINT | FK tasks, NOT NULL | |
| user_id | BIGINT | FK users, NOT NULL | |
| status | TEXT | NOT NULL, default `'assigned'`, CHECK | `'assigned'` \| `'submitted'` \| `'returned'` \| `'accepted'` |
| late | BOOLEAN | NOT NULL, default false | set on first submission after deadline |
| reviewed_at | TIMESTAMPTZ | NULL | |
| created_at | TIMESTAMPTZ | NOT NULL | |

**UNIQUE:** (`task_id`, `user_id`); index (`user_id`). Individual → rows at task creation; common → lazily on first submission.

**task_submissions**

| Field | Type | Constraints | Notes |
|---|---|---|---|
| id | BIGSERIAL | PK | |
| assignment_id | BIGINT | FK task_assignments, NOT NULL | |
| body | TEXT | NULL | markdown |
| created_at | TIMESTAMPTZ | NOT NULL | index (`assignment_id`, `created_at`); history kept |

**task_submission_media** — PK (`submission_id`, `media_asset_id`); FKs to task_submissions, media_assets.

**task_comments** — review feedback under a submission; soft delete.

| Field | Type | Constraints | Notes |
|---|---|---|---|
| id | BIGSERIAL | PK | |
| submission_id | BIGINT | FK task_submissions, NOT NULL | |
| author_id | BIGINT | FK users, NOT NULL | |
| body | TEXT | NOT NULL | index (`submission_id`, `created_at`) |
| created_at | TIMESTAMPTZ | NOT NULL | |
| deleted_at | TIMESTAMPTZ | NULL | soft delete |

---

## Ephemeral state (Redis, NOT Postgres)
Short-lived realtime state lives only in Redis. This is the single list of Redis uses.

| Use | Notes |
|---|---|
| Typing ("печатает") | per-room event, short TTL, WS only. See [MESSAGES.md](MESSAGES.md) |
| Presence | who is online (refcount). See [MESSAGES.md](MESSAGES.md) |
| Refresh tokens / sessions | refresh `jti` whitelist for revoke/logout; access is stateless. See [AUTH.md](AUTH.md) |
| Rate-limit counters | login / send / upload. See [API_CONVENTIONS.md](API_CONVENTIONS.md) |
| Media upload intent | presigned-PUT intent, TTL ~15m. See [FILES.md](FILES.md) |
| Telegram bot state | `bot:pwd:{tg_id}`, `bot:await_q:{tg_id}`, `bot:qmap:{admin_msg_id}`. See [TELEGRAM_BOT.md](TELEGRAM_BOT.md) |
| Pub/sub channels | `room:*`, `presence`, `user:{id}` (personal notifications) |

---

## Relations map

```
users --< room_members >-- rooms
users --< messages (sender) >-- rooms
messages --+ (thread_root_id -> messages.id, self-FK to root)
messages --< message_attachments >-- media_assets
messages --> stickers --> stickerpacks
rooms --< pinned_messages >-- messages
rooms --< calendar_events              (room_id nullable)
users --< cabin_entries                (JSONB data by kind)
users --< journal_pardons / journal_credits
journal_programs --< journal_sections  (ON DELETE CASCADE; versioned diary structure)
users --< notifications                (actor/message/room nullable)
users --< push_subscriptions           (ON DELETE CASCADE; one per device, unique endpoint)
users --< feedback ;  faq_items        (standalone)
kb_items --< kb_item_media >-- media_assets
kb_items --< kb_comments >-- users
kb_items --> kb_categories             (nullable, out-of-MVP)
tasks --< task_media >-- media_assets
tasks --< task_assignments >-- users
task_assignments --< task_submissions --< task_submission_media >-- media_assets
task_submissions --< task_comments >-- users
tasks --> kb_items                     (kb_item_id nullable)
media_assets                           (shared: messages, KB, tasks, avatars, stickers)
```

> Dynamics homework entries are `messages` in the personal room (`rooms.is_personal`); no entry table.

## Migrations gotchas

`alembic revision --autogenerate` (i.e. `make migration`) re-reports **three phantom
index diffs** even on a clean, up-to-date schema. They are NOT real drift — alembic
cannot round-trip these indexes against the models (a partial/conditional index; the
FK indexes are declared in the migrations, not on the model columns):

| Phantom op autogenerate emits | Index | Real definition |
|---|---|---|
| `drop_index('uq_rooms_single_news')` on `rooms` | partial unique | `WHERE is_news` — enforces the single news channel |
| `drop_index('ix_journal_pardons_user_id')` on `journal_pardons` | btree on `user_id` | created by the journal_pardons migration |
| `drop_index('ix_journal_credits_user_id')` on `journal_credits` | btree on `user_id` | created by the journal_credits migration |

Rule: **NEVER** include drops/recreates of these three indexes in a migration.
After `make migration`, delete those lines from the generated file before committing;
keep only the real changes. (Migrations are expand/contract only — see CLAUDE.md.)
