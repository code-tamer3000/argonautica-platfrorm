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
| is_observer | BOOLEAN | NOT NULL, default false | observer mode: materials-only, passive access. Mutually exclusive with `role='admin'`. See [AUTH.md](AUTH.md) |
| survey_required | BOOLEAN | NOT NULL, default false | exit survey pending → whole platform gated. Cleared on submit. See [SURVEY.md](SURVEY.md) |
| graduated_at | TIMESTAMPTZ | NULL | экспедиция пройдена: set on survey submit, never cleared. Dynamics hidden, Tasks collapse to submitted, Рубка read-only. See [SURVEY.md](SURVEY.md) |
| survey_gift_asset_id | BIGINT | FK media_assets, NULL | personal PDF book handed out after the survey |
| intake_id | BIGINT | FK intakes, NULL | cohort the user belongs to; drives the Dynamics 28-day window start. Mandatory in `POST /api/admin/users`; column stays nullable for historical rows (expand/contract) |
| plan_id | BIGINT | FK plans, NULL | tariff the participant signed up under (intake bot, [INTAKE_BOT.md](INTAKE_BOT.md)). Optional — manual admin provisioning doesn't require a plan |
| settings | JSONB | NOT NULL, default `'{}'` | UI prefs; no migration per key |
| created_at | TIMESTAMPTZ | NOT NULL | |
| updated_at | TIMESTAMPTZ | NOT NULL | |

## intakes
Cohort of participants sharing a Dynamics 28-day window start date. Not the same as a
`stream` (Tasks tournament mechanic, `tasks.type='stream'`) or a `group` (`rooms.type='group'`) —
those names were already taken. One historical intake (`starts_on = 2026-07-02`,
`ends_on = 2026-07-29`) is seeded/corrected by migrations and every existing user is
backfilled onto it. Also the unit of **content isolation** (ARG-96): admin-authored
content (channels, common tasks, KB items) can be scoped to one intake — see
"Content isolation by intake and plan" below.

| Field | Type | Constraints | Notes |
|---|---|---|---|
| id | BIGSERIAL | PK | |
| starts_on | DATE | NOT NULL, UNIQUE | Dynamics window start for every user in this intake |
| ends_on | DATE | NOT NULL | window close date; after it Dynamics is a read-only archive for the intake's users (frozen stats, no new entries/pardons). Independent of the 28-day Dynamics duration — set explicitly, not derived from `starts_on` |
| welcome_message | TEXT | NULL | welcome popup text on first login (ARG-106) — same copy as the news post, set by `scripts/provision_second_intake.py` (`NEWS_BODY`). NULL = no popup (intakes seeded before this feature) |
| created_at | TIMESTAMPTZ | NOT NULL | |

**Cohort-pending gate (ARG-106).** While `today < intake.starts_on`, a participant's own
Рубка (chat, root `/`) and Календарь screens are replaced client-side with a
"N days until start" placeholder (`CohortPending`, N = calendar days, no time-of-day
precision) — no backend enforcement, same trust level as any other early-availability UI
state (the participant's own data, not another user's). `GET /api/auth/me` exposes
`intake_starts_on`/`intake_welcome_message` (denormalized, same pattern as
`AdminUserOut.intake_starts_on`) for this and for the welcome popup. The popup's "don't
show again" choice persists as `users.settings.welcome_popup_dismissed` (bool), same
merge-on-`PATCH /auth/me` convention as notification prefs.

There is no explicit open/closed status beyond the date window: the **active** intake is
simply the one with the largest `starts_on`. Admin API (all under `require_admin`):

- `GET /api/admin/intakes` → intakes newest-first (`starts_on` DESC), each with `user_count`.
  The first row is the active intake.
- `POST /api/admin/intakes` `{starts_on, ends_on}` → 201 with the created intake; 409 when an
  intake with that `starts_on` already exists (UNIQUE); 422 when `ends_on <= starts_on`.
- `PATCH /api/admin/intakes/{id}` `{ends_on}` → move the close date. `starts_on` has no edit
  API on purpose (see ARG-89).
- `GET /api/admin/users?intake_id=<id>` filters users by intake; every `AdminUserOut` carries
  `intake_id` and the denormalized `intake_starts_on` so the admin list groups without a join
  on the client.
- `POST /api/admin/users` requires `intake_id` (400 if it does not exist); `PATCH
  /api/admin/users/{id}` accepts `intake_id` to move a participant between intakes (explicit
  `null` is rejected — a participant may not be left without an intake).

## Content isolation by intake and plan (ARG-96)

Admin-authored content — channels (`rooms.type='channel'`), common tasks
(`tasks.type='common'`), KB items — can be scoped to one intake and/or a set of plans.
Group/dm rooms and individual/pair/stream tasks are **not** gated by this: they already
have explicit membership/assignment, which is stronger than intake/plan. See
[ROOMS.md](ROOMS.md), [TASKS.md](TASKS.md), [KB.md](KB.md) for the exact visibility rules.

**Intake (`intake_id`)** — nullable FK to `intakes` on `rooms`, `tasks`, `kb_items`. `NULL` =
visible to every intake (the safe backfill default — all pre-ARG-96 content stays NULL,
except regular non-personal channels/tasks/kb_items, which were backfilled onto the
historical intake). The news channel (`rooms.is_news`) is gated the same way as a regular
channel (ARG-104 — was a platform-wide singleton with `intake_id` always NULL before;
`uq_rooms_news_per_intake` now enforces one news channel per intake, the pre-ARG-104
singleton backfilled onto the historical intake). Personal diary rooms (`rooms.is_personal`)
also keep `intake_id` NULL, but are **not** cross-intake — see "Personal diary rooms" in
[ROOMS.md](ROOMS.md): they're browsable by other users ("Все дневники"), so visibility is
gated by comparing the owner's and the viewer's `intake_id`/`plan_id` directly
(`same_cohort`), not via a column on the room itself.

**Plan (`<entity>_plans`)** — many-to-many, not a column: an empty set of rows = visible to
every plan of the user's intake; a non-empty set = only the listed plans. This is the only
shape that expresses both shared and plan-exclusive content without a second migration once
ARG-26 (what each plan actually includes) lands.

| Table | Columns | Notes |
|---|---|---|
| room_plans | room_id (FK rooms), plan_id (FK plans) | PK (room_id, plan_id) |
| task_plans | task_id (FK tasks), plan_id (FK plans) | PK (task_id, plan_id) |
| kb_item_plans | kb_item_id (FK kb_items), plan_id (FK plans) | PK (kb_item_id, plan_id) |

Visibility check (`app/services/visibility.py`, `intake_visible` / `plan_visibility_clause` /
`plan_visible`) is a double filter — content must pass **both**: `intake_id IS NULL OR
intake_id = user.intake_id`, AND `<entity>_plans` empty OR contains `user.plan_id`. Applied
in `assert_room_access` (channel branch), `assert_task_visible`/`list_tasks` (common branch),
`assert_kb_item_visible`/`list_items`, and `assert_media_access` (media inherits the
visibility of its carrier — channel message, task, or KB item).

Editing `starts_on` and deleting an intake have no API on purpose — see ARG-89.

## plans
Tariff of the expedition: name, price, description, active flag. Read by the intake bot
directly from the DB (no HTTP round-trip — same pattern as `scripts/telegram_bot.py`
reading `users` directly), so price/name edits apply without a bot redeploy. See
[INTAKE_BOT.md](INTAKE_BOT.md).

| Field | Type | Constraints | Notes |
|---|---|---|---|
| id | BIGSERIAL | PK | |
| name | TEXT | NOT NULL | |
| price | INTEGER | NOT NULL | rubles, whole number |
| description | TEXT | NOT NULL, default `''` | shown behind the bot's «Подробнее» button |
| is_active | BOOLEAN | NOT NULL, default true | false hides it from the bot without deleting history |
| created_at | TIMESTAMPTZ | NOT NULL | |
| updated_at | TIMESTAMPTZ | NOT NULL | |

Full CRUD under `require_admin`: `GET/POST /api/admin/plans`, `PATCH/DELETE
/api/admin/plans/{id}`. Deleting a plan still referenced by `users.plan_id` or
`intake_applications.plan_id` 409s — deactivate instead.

## intake_applications
Funnel state for the intake/payment bot (ARG-92): one row per Telegram chat (`tg_id`
unique). Postgres, not sqlite/Redis — the funnel must survive a container restart
(Redis is only for the ephemeral "awaiting a support question" flag, per ADR-013).
Mutating it is bot-only; a read-only admin API for the funnel dashboard was added in
ARG-107. See [INTAKE_BOT.md](INTAKE_BOT.md).

| Field | Type | Constraints | Notes |
|---|---|---|---|
| id | BIGSERIAL | PK | |
| tg_id | BIGINT | NOT NULL, UNIQUE | Telegram user id (== chat id in a private chat) |
| tg_username | TEXT | NULL | refreshed on every `/start` |
| tg_first_name | TEXT | NULL | |
| tg_last_name | TEXT | NULL | |
| status | TEXT | NOT NULL, default `'awaiting_about'`, CHECK, INDEX (`ix_intake_applications_status`) | `awaiting_about` → `submitted` → `choosing_plan` → `awaiting_offer` → `awaiting_receipt` → `payment_review` → `confirmed` |
| about | TEXT | NULL | the applicant's one-message self-description |
| submitted_at | TIMESTAMPTZ | NULL | entered `submitted` (ARG-107) |
| accepted_at | TIMESTAMPTZ | NULL | entered `choosing_plan` (ARG-107) |
| plan_chosen_at | TIMESTAMPTZ | NULL | entered `awaiting_offer` (ARG-107) |
| receipt_at | TIMESTAMPTZ | NULL | entered `payment_review` (ARG-107) |
| confirmed_at | TIMESTAMPTZ | NULL | entered `confirmed` (ARG-107); backfilled exactly from `users.created_at` |
| plan_id | BIGINT | FK plans, NULL | set once the applicant picks a tariff |
| receipt_file_id | TEXT | NULL | Telegram `file_id` of the payment receipt (photo or PDF) |
| receipt_kind | TEXT | NULL | `'photo'` \| `'document'` |
| offer_accepted_at | TIMESTAMPTZ | NULL | set on the «✅ Согласен, к оплате» callback (ARG-43); gates `awaiting_offer → awaiting_receipt`; also doubles as the `stage_since` timestamp for `awaiting_receipt` (ARG-107 — no separate column) |
| offer_version | TEXT | NULL | edition of the accepted offer (bot's `OFFER_VERSION` constant), not a DB-stored text |
| user_id | BIGINT | FK users, NULL | set once the platform account is created (final step) |
| created_at | TIMESTAMPTZ | NOT NULL, INDEX (`ix_intake_applications_created_at`) | |
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
| is_news | BOOLEAN | NOT NULL, default false | news channel; one per intake (`uq_rooms_news_per_intake` on `intake_id`, ARG-104 — was a platform-wide singleton before); top posts admin-only |
| intake_id | BIGINT | FK intakes, NULL | channel-only isolation by intake (ARG-96); NULL = cross-intake. Ignored for dm/group/personal/news |

**room_plans** — channel-only isolation by plan (ARG-96), many-to-many. PK (`room_id`, `plan_id`); FKs to rooms, plans.

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
| ref_kind | TEXT | NULL, CHECK | ссылка на материал/задачу: `'kb'` \| `'task'`. No FK (target resolved lazily). See [MESSAGES.md](MESSAGES.md) |
| ref_id | BIGINT | NULL | kb_item / task id; paired with `ref_kind` |
| reply_count | INT | NOT NULL, default 0 | denormalized on root |
| last_reply_at | TIMESTAMPTZ | NULL | denormalized on root |
| created_at | TIMESTAMPTZ | NOT NULL | |
| edited_at | TIMESTAMPTZ | NULL | |
| deleted_at | TIMESTAMPTZ | NULL | soft delete |

**Index:** (`room_id`, `thread_root_id`, `created_at`).
**CHECK:** `ck_messages_ref_pair` — `(ref_kind IS NULL) = (ref_id IS NULL)` (both or neither); `ck_messages_ref_kind` — `ref_kind IN ('kb','task')`.

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
| thumb_key | TEXT | NULL | feed thumbnail key (≤1024px WebP); NULL = no preview |
| preview_key | TEXT | NULL | lightbox derivative key (`previews/…`, ≤1600px WebP); images only; NULL = legacy / failed / not smaller than the original |
| kind | TEXT | NOT NULL | `'image'` \| `'video'` \| `'file'` \| `'audio'` (voice) |
| mime_type | TEXT | NOT NULL | |
| size | BIGINT | NOT NULL | bytes |
| width | INT | NULL | image/video |
| height | INT | NULL | image/video |
| duration | INT | NULL | seconds, video |
| transcode_status | TEXT | NULL, CHECK in (`processing`,`done`,`failed`) | server video transcode state; NULL = not video / legacy (pre-feature) |
| variant_key | TEXT | NULL | served H.264 720p mp4 key (`video/720/<uuid>.mp4`); = `storage_key` on the fast path |
| variant_mime | TEXT | NULL | variant mime (`video/mp4`) |
| created_by | BIGINT | FK users, NOT NULL | |
| created_at | TIMESTAMPTZ | NOT NULL | |

Public URL is not stored: access is via presigned URL after an auth check (see [FILES.md](FILES.md)).

**Video transcode columns** (see [FILES.md](FILES.md) "Video transcode"): expand-only, all nullable. `transcode_status` is the *durable serving state* (the worker's live progress/attempt count lives only in Redis); the served `url` is the variant iff `transcode_status='done'` and `variant_key` is set, else the original. Legacy videos (rows created before the feature) keep all three NULL and serve the original unchanged.

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
| intake_id | BIGINT | FK intakes, NULL | isolation by intake (ARG-96); NULL = cross-intake |

**kb_item_media** — PK (`kb_item_id`, `media_asset_id`); FKs to kb_items, media_assets.

**kb_item_plans** — isolation by plan (ARG-96), many-to-many. PK (`kb_item_id`, `plan_id`); FKs to kb_items, plans.

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

## survey_responses
Exit survey of the expedition, one row per participant. Questions live in code
(`app/services/survey_form.py`), answers in JSONB — same trade-off as Cabin. See [SURVEY.md](SURVEY.md).

| Field | Type | Constraints | Notes |
|---|---|---|---|
| id | BIGSERIAL | PK | |
| user_id | BIGINT | FK users, NOT NULL, UNIQUE | one submission per person, no edits |
| version | INT | NOT NULL | `SURVEY_VERSION` at submit time |
| answers | JSONB | NOT NULL | `{question_key: answer}`, shape depends on question kind |
| publish_consent | BOOLEAN | NOT NULL, default false | may the testimonial be shown publicly with the author's name |
| created_at | TIMESTAMPTZ | NOT NULL | |

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
Section "Задачи". Eight tables. See [TASKS.md](TASKS.md).

**tasks**

| Field | Type | Constraints | Notes |
|---|---|---|---|
| id | BIGSERIAL | PK | |
| type | TEXT | NOT NULL, CHECK | `'common'` \| `'individual'` \| `'pair'` |
| title | TEXT | NOT NULL | |
| body | TEXT | NULL | markdown |
| kb_item_id | BIGINT | FK kb_items, NULL | optional link to a KB item |
| pair_id | BIGINT | FK task_pairs, NULL | set only on a cross-task (peer-learning); links it to its pair |
| deadline_at | TIMESTAMPTZ | NULL | synced to `calendar_events` (services/tasks.py) |
| created_by | BIGINT | FK users, NOT NULL | author; for a cross-task = the giving participant |
| created_at | TIMESTAMPTZ | NOT NULL | |
| deleted_at | TIMESTAMPTZ | NULL | soft delete |
| intake_id | BIGINT | FK intakes, NULL | isolation by intake (ARG-96) — read only for `type='common'`; individual/pair/stream ignore it (assignment is stronger). On an `individual` task it may still be set — a provisioning tag ("this is intake X's welcome task"), read by `intake_bot.py`'s post-signup auto-assignment, not by visibility |
| sets_display_name | BOOLEAN | NOT NULL, default false | submitting this task overwrites `users.display_name` with the submission's trimmed text (see `create_submission`); no hardcoded task id/title, only this flag |

**task_media** — task-prompt media (admin), mirror of task_submission_media. PK (`task_id`, `media_asset_id`).

**task_plans** — isolation by plan (ARG-96), many-to-many, same `type='common'`-only scope as `intake_id`. PK (`task_id`, `plan_id`); FKs to tasks, plans.

**task_pairs** — a pair inside a `pair`-type task (peer-learning). Soft delete. See [TASKS.md](TASKS.md).

| Field | Type | Constraints | Notes |
|---|---|---|---|
| id | BIGSERIAL | PK | |
| task_id | BIGINT | FK tasks, NOT NULL | the parent `pair`-task; index (`task_id`) |
| meeting_organizer_id | BIGINT | FK users, NOT NULL | member who manages the meeting (random at creation) |
| meeting_at | TIMESTAMPTZ | NULL | informational meeting time; NULL = none/cancelled |
| created_at | TIMESTAMPTZ | NOT NULL | |
| deleted_at | TIMESTAMPTZ | NULL | soft delete (admin disbands the pair) |

**task_pair_members** — membership in a pair (two rows per pair).

| Field | Type | Constraints | Notes |
|---|---|---|---|
| id | BIGSERIAL | PK | |
| pair_id | BIGINT | FK task_pairs, NOT NULL | index (`pair_id`) |
| task_id | BIGINT | FK tasks, NOT NULL | denormalized for the unique constraint below |
| user_id | BIGINT | FK users, NOT NULL | |

**UNIQUE:** (`task_id`, `user_id`) — one user in at most one pair per pair-task.

**task_streams** — config of a `stream`-type task (turnir bracket), 1:1 with the task. See [TASKS.md](TASKS.md).

| Field | Type | Constraints | Notes |
|---|---|---|---|
| id | BIGSERIAL | PK | |
| task_id | BIGINT | FK tasks, NOT NULL, UNIQUE | `uq_task_stream_task` |
| stage | INT | NOT NULL, default 0 | **deprecated** — leftover from the global-stage design; no longer read or written (dropped in a later release, expand/contract) |
| depth | INT | NOT NULL | number of merge rounds (16 participants → 4) |
| created_at | TIMESTAMPTZ | NOT NULL | |
| deleted_at | TIMESTAMPTZ | NULL | soft delete |

> A stream has a single deadline, the ordinary `tasks.deadline_at` (so it lands on the calendar for free). Progression itself is derived, not stored — see [TASKS.md](TASKS.md) "Поток".

**task_stream_nodes** — a subgroup in the bracket (the thing that agrees one phrase). Soft delete.

| Field | Type | Constraints | Notes |
|---|---|---|---|
| id | BIGSERIAL | PK | |
| task_id | BIGINT | FK tasks, NOT NULL | index (`task_id`) |
| round | INT | NOT NULL | 1 = pairs, … `depth` = root |
| parent_id | BIGINT | FK task_stream_nodes, NULL | NULL at the root |
| side | TEXT | CHECK IN ('left','right'), NULL | canvas layout only; NULL at the root (centre) |
| position | INT | NOT NULL | order within the round |
| room_id | BIGINT | FK rooms, NULL | discussion group room; created when the node becomes ready (all members submitted); index (`room_id`) |
| phrase | TEXT | NULL | approved phrase; NULL = not agreed yet |
| phrase_option_id | BIGINT | NULL | winning option (NULL when an admin forced the phrase) |
| approved_at | TIMESTAMPTZ | NULL | |
| approved_by | BIGINT | FK users, NULL | NULL = unanimous vote; otherwise the admin who forced it |
| created_at / deleted_at | TIMESTAMPTZ | | |

**task_stream_node_members** — membership, denormalized across **all** rounds (a participant has one row per round), so "who is in this node" and "which node of round r is this user in" are single queries — the whole visibility check depends on it.

| Field | Type | Constraints | Notes |
|---|---|---|---|
| id | BIGSERIAL | PK | |
| node_id | BIGINT | FK task_stream_nodes, NOT NULL | |
| task_id | BIGINT | FK tasks, NOT NULL | denormalized; index (`task_id`, `user_id`) |
| user_id | BIGINT | FK users, NOT NULL | |

**UNIQUE:** (`node_id`, `user_id`).

**task_stream_texts** — a participant's personal text, one row per version (0 = initial, `depth` = final). Editable while its stage is open, hence UPDATE rather than a submission history.

| Field | Type | Constraints | Notes |
|---|---|---|---|
| id | BIGSERIAL | PK | |
| task_id / user_id | BIGINT | FK, NOT NULL | |
| version | INT | NOT NULL | 0..depth |
| body | TEXT | NOT NULL | plain text (no attachments) |
| created_at / updated_at | TIMESTAMPTZ | NOT NULL | |

**UNIQUE:** (`task_id`, `user_id`, `version`) — `uq_task_stream_text`.

**task_stream_options** — candidate phrases proposed inside a node. Soft delete. Fields: `id`, `node_id` (FK, index), `author_id` (FK users), `text`, `created_at`, `deleted_at`.

**task_stream_votes** — one vote per person per node; re-voting is an UPDATE. Fields: `id`, `node_id` (FK), `option_id` (FK task_stream_options), `user_id` (FK users), `created_at`.

**UNIQUE:** (`node_id`, `user_id`) — `uq_task_stream_vote`. A phrase is approved on **unanimity** and is then final (`recompute_node_approval` is a no-op once `approved_at` is set) — neighbours upstream already rely on it.

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
| Video transcode queue | `transcode:pending` (list), `transcode:inflight` (hash, claim ts), `transcode:attempts` (hash). Job state + retry count; durable serving state is `media_assets.transcode_status`. See [FILES.md](FILES.md) |
| Telegram bot state | `bot:pwd:{tg_id}`, `bot:await_q:{tg_id}`, `bot:qmap:{admin_msg_id}`. See [TELEGRAM_BOT.md](TELEGRAM_BOT.md) |
| Pub/sub channels | `room:*`, `presence`, `user:{id}` (personal notifications) |

---

## Relations map

```
users --> intakes                      (intake_id nullable; cohort → Dynamics window start+end)
rooms --> intakes ; rooms --< room_plans >-- plans       (channel-only isolation, ARG-96)
tasks --> intakes ; tasks --< task_plans >-- plans       (common-only isolation, ARG-96)
kb_items --> intakes ; kb_items --< kb_item_plans >-- plans  (isolation, ARG-96)
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
tasks --< task_pairs (pair-type) --< task_pair_members >-- users
tasks --> task_pairs                   (pair_id nullable; cross-task → its pair)
tasks --> task_streams (stream-type, 1:1)
tasks --< task_stream_nodes --< task_stream_node_members >-- users
task_stream_nodes --> task_stream_nodes (parent_id; the bracket tree)
task_stream_nodes --> rooms            (room_id nullable; subgroup discussion room)
task_stream_nodes --< task_stream_options --< task_stream_votes >-- users
tasks --< task_stream_texts >-- users  (one row per participant per version)
tasks --> kb_items                     (kb_item_id nullable)
media_assets                           (shared: messages, KB, tasks, avatars, stickers)
```

> Dynamics homework entries are `messages` in the personal room (`rooms.is_personal`); no entry table.

## Migrations gotchas

`alembic revision --autogenerate` (i.e. `make migration`) re-reports **four phantom
index diffs** even on a clean, up-to-date schema. They are NOT real drift — alembic
cannot round-trip these indexes against the models (a partial/conditional index; the
FK indexes are declared in the migrations, not on the model columns):

| Phantom op autogenerate emits | Index | Real definition |
|---|---|---|
| `drop_index('uq_rooms_news_per_intake')` on `rooms` | partial unique | `WHERE is_news` on `intake_id` — one news channel per intake (ARG-104) |
| `drop_index('ix_journal_pardons_user_id')` on `journal_pardons` | btree on `user_id` | created by the journal_pardons migration |
| `drop_index('ix_journal_credits_user_id')` on `journal_credits` | btree on `user_id` | created by the journal_credits migration |
| `drop_index('ix_journal_sections_program_id')` on `journal_sections` | btree on `program_id` | created by the journal_sections migration |

Rule: **NEVER** include drops/recreates of these four indexes in a migration.
After `make migration`, delete those lines from the generated file before committing;
keep only the real changes. (Migrations are expand/contract only — see CLAUDE.md.)
