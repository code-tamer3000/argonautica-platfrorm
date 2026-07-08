# Argonautica — Agent Instructions

Commercial educational platform (~20–30 users): knowledge base + real-time chat,
plus Tasks, Dynamics (daily-homework journal), News, Notifications, Cabin (каюта,
private psych journaling), Support. Mobile access is PWA (no native apps).
Stack: FastAPI, PostgreSQL, Redis (pub/sub), React/Vite, MinIO, Nginx, Docker Compose.

## Commands — the ONLY way to run things

| Action            | Command                     |
|-------------------|-----------------------------|
| All checks        | `make test`                 |
| Backend tests     | `make test-backend`         |
| Frontend tests¹   | `make test-frontend`        |
| Lint + typecheck  | `make lint`                 |
| Apply migrations  | `make migrate-test`         |
| New migration     | `make migration m="<name>"` |
| Test env up/down  | `make up-test` / `make down-test` |

¹ `test-frontend` currently runs typecheck only (`tsc --noEmit`) — no frontend test runner exists yet.

Hard rules:
- NEVER run pytest, alembic, npm, or vite directly. Always via `make` targets — they
  define the correct environment. (Currently local venv/compose; will move to a
  dedicated test compose stack later. Makefile internals may change, target names will not.)
- NEVER touch `docker/docker-compose.prod.yml`, `docker/deploy.sh`, `.env`, or `docker/nginx/certs/`.
- If a `make` target fails for environment reasons (not code reasons), stop and report — do not improvise workarounds.

> Current reality (not yet Dockerized): `make` wraps the host backend venv
> (`backend/.venv`) and the dev compose stack (`docker/docker-compose.yml`).

## Architecture facts (one line each; details in docs/)

- Message IDs: BIGSERIAL, monotonic. No UUIDs for messages (read receipts depend on monotonic ids).
- Threads: flat, single level, via `thread_root_id`. A reply always points at the root, never at another reply.
- Channels: implicit access — NO `room_members` rows for regular channel members (lazy, only to store read state). Writes to channels: admins only.
- Deletion: soft delete everywhere (`deleted_at`). Exception: Cabin entries are hard-deleted.
- Read receipts: `last_read_message_id` per member, no per-message table.
- Auth: JWT (stateless access + Redis-whitelisted refresh). Users are admin-provisioned (TG username + one-time password), no self-signup.
- Media: MinIO presigned URLs; uploads/downloads bypass FastAPI (only image-thumbnail generation reads bytes server-side).
- Realtime: Redis pub/sub. Ephemeral state (typing, presence, sessions, rate-limit, bot state) lives ONLY in Redis, never Postgres.
- Migrations: expand/contract ONLY (blue-green deploy, shared Postgres). Never drop/rename a column in the same release that stops writing it.
- Authorization on EVERY request: membership/role checked server-side; never trust client-supplied ids (IDOR is threat #1).

## Docs index — read ONLY what the task needs

| File                       | Covers                                                    |
|----------------------------|-----------------------------------------------------------|
| docs/DATA_MODEL.md         | every table: fields, types, constraints, indexes, relations |
| docs/AUTH.md               | JWT flow, Redis whitelist, provisioning, roles, per-flag grants |
| docs/ROOMS.md              | rooms, DMs, groups, channels, membership, dedup, news channel |
| docs/MESSAGES.md           | send/edit/delete, threads, pins, read receipts, stickers, typing/presence, repost, WS events |
| docs/FILES.md              | MinIO presigned flow, thumbnails, limits, media access    |
| docs/API_CONVENTIONS.md    | endpoint/error/pagination patterns, authz, rate limits    |
| docs/FRONTEND.md           | React structure, state, API/WS clients, PWA, design system |
| docs/DEPLOY.md             | environments, blue-green, CI/CD, what NOT to touch (reference) |
| docs/KB.md                 | knowledge base: items, media, comments, publish/visibility |
| docs/TASKS.md              | tasks: common/individual, assignments, submissions, review |
| docs/CABIN.md              | каюта: 3 subkinds, JSONB data, access grant, admin view   |
| docs/DYNAMICS.md           | daily-homework journal (28 days), pardons, credits, stats |
| docs/NOTIFICATIONS.md      | bell feed: kinds, generation, realtime delivery           |
| docs/SUPPORT.md            | feedback (bug/improvement) + FAQ                          |
| docs/CALENDAR.md           | calendar events, project-wide vs room-scoped visibility   |
| docs/TELEGRAM_BOT.md       | access/support bot: provisioning, proxy, runbook          |
| docs/GENE_KEYS.md          | Генные Ключи: interactive I-Ching wheel, bundled content, geometry |

Do not read the whole docs/ directory. Pick from the index. Historical/vision docs are in docs/archive/.

New feature docs: fold into the closest core domain file if <50 lines AND a natural home exists; otherwise a standalone docs/<DOMAIN>.md added to this index.

## Git & PR rules

- Base branch: `develop`. Prod branch: `main`. Feature branches: `feature/<slug>`.
- Conventional commits (`feat:`, `fix:`, `refactor:`, `docs:`, `test:`).
- Commit once at the end of a task, after `make lint && make test` pass (not after every step).
- Small change (bugfix, minor refactor, text/style) → commit straight to `develop`.
  Large change (new feature, migration, cross-module) → `feature/*` branch + PR into `develop`.
- PRs into `develop` may be self-merged when CI is green (no manual review wait). `develop` → `main` is ALWAYS merged manually by the user.
- If the spec is ambiguous: make the smallest reasonable assumption, implement it, and list it explicitly under **Assumptions**. Never guess silently, never expand scope.
- Any change that alters behavior described in docs/ MUST update the corresponding docs/ file in the SAME task.

## Testing rules

- New endpoint → integration test (httpx against the app, real test DB).
- Bug fix → regression test that fails before the fix.
- Do not mock PostgreSQL or Redis in integration tests — the test compose provides real ones.
- Frontend has no test runner yet; the gate is `tsc --noEmit`. When vitest is added, cover components with logic (skip snapshot-only tests).
- `make migration` autogenerate re-reports 3 phantom index diffs — see docs/DATA_MODEL.md "Migrations gotchas"; NEVER commit those index drops/recreates.
