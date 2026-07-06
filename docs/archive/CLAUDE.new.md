# Argonautica — Agent Instructions

Commercial educational platform: knowledge base + real-time chat.
Stack: FastAPI, PostgreSQL, Redis (pub/sub), React/Vite, MinIO, Nginx, Docker Compose.

## Commands — the ONLY way to run things

| Action            | Command                     |
|-------------------|-----------------------------|
| All tests         | `make test`                 |
| Backend tests     | `make test-backend`         |
| Frontend tests    | `make test-frontend`        |
| Lint + typecheck  | `make lint`                 |
| Apply migrations  | `make migrate-test`         |
| New migration     | `make migration m="<name>"` |
| Test env up/down  | `make up-test` / `make down-test` |

Hard rules:
- NEVER run pytest, alembic, npm, or vite directly. Always via `make` targets — they
  define the correct environment. (Currently local venv/compose; will move to a
  dedicated test compose stack later. Makefile internals may change, target names will not.)
- NEVER touch `docker-compose.prod.yml`, `.env.prod`, or anything under `deploy/`.
- If a `make` target fails for environment reasons (not code reasons), stop and report — do not improvise workarounds.

## Architecture facts (one line each; details in docs/)

- Message IDs: BIGSERIAL, monotonic. No UUIDs for messages.
- Threads: flat, single level, via `thread_root_id`.
- Channels: implicit access — NO `room_members` rows for regular channel members (lazy membership). Writes to channels: admins only.
- Deletion: soft delete everywhere (`deleted_at`).
- Read receipts: `last_read_message_id` per member, not per message.
- Auth: JWT + Redis whitelist. Users are admin-provisioned (TG username + one-time password), no self-signup.
- Media: MinIO presigned URLs, uploads/downloads bypass FastAPI.
- Realtime: Redis pub/sub.
- Migrations: expand/contract ONLY (blue-green deploy). Never drop/rename a column in the same release that stops writing it.

## Docs index — read ONLY what the task needs

| File                      | Covers                                        |
|---------------------------|-----------------------------------------------|
| docs/DATA_MODEL.md        | tables, fields, constraints, indexes          |
| docs/AUTH.md              | JWT flow, Redis whitelist, provisioning       |
| docs/ROOMS.md             | rooms, DMs, channels, membership, dedup       |
| docs/MESSAGES.md          | CRUD, threads, soft delete, read receipts     |
| docs/FILES.md             | MinIO, presigned URL flow, limits             |
| docs/API_CONVENTIONS.md   | endpoint patterns, error format, pagination   |
| docs/FRONTEND.md          | React structure, state, API client            |
| docs/DEPLOY.md            | environments, blue-green, CI (reference only) |

Do not read the whole docs/ directory. Pick from the index.

## Git & PR rules

- Base branch: `develop`. Branch name: `feature/<issue-number>-<slug>`.
- Conventional commits (`feat:`, `fix:`, `refactor:`, `docs:`, `test:`).
- One issue = one PR. Keep the diff focused; no drive-by refactoring.
- Before opening a PR: `make lint && make test` must pass.
- PR description template: **What / Why / How tested / Assumptions**.
- If the spec is ambiguous: make the smallest reasonable assumption, implement it, and list it explicitly under **Assumptions**. Never guess silently, never expand scope.
- Any change that alters behavior described in docs/ MUST update the corresponding docs/ file in the same PR.

## Testing rules

- New endpoint → integration test (httpx against the app, real test DB).
- Bug fix → regression test that fails before the fix.
- Do not mock PostgreSQL or Redis in integration tests — the test compose provides real ones.
- Frontend: vitest + testing-library for components with logic; skip snapshot-only tests.