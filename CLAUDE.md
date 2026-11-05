# Argonautica — Agent Instructions

Commercial educational platform (~20–30 users): knowledge base + real-time chat,
plus Tasks, Dynamics (daily-homework journal), News, Notifications, Cabin (каюта,
private psych journaling), Support. Mobile access is PWA (no native apps).
Stack: FastAPI, PostgreSQL, Redis (pub/sub), React/Vite, MinIO, Nginx, Docker Compose.

## Verification = CI ONLY

**Тесты, линт, typecheck, миграции на тестовой БД, `local-up` и Playwright НЕ запускаются
локально — ни агентом, ни «на минуточку».** Единственный источник истины «зелено/красно» —
CI на GitHub. Поэтому: сделал → commit → push → PR → читай результат.

| Action | Как |
|--------|-----|
| Статус CI | `gh pr checks <PR> --watch` |
| Почему красный | `gh run view <run-id> --log-failed` |
| НЕ запускать локально | `make test*`, `make lint`, `make up-test`, `make migrate-test`, `make local-*`, `pytest`, `ruff`, `mypy`, `alembic`, `npm`, `tsc`, `vite`, `docker run/compose`, Playwright |
| Новая миграция (генерация файла) | `make migration m="<name>"` — единственная локальная make-цель |

Как это зашито:
- цели Makefile защищены `_ci-only` — без `CI=true` падают сразу (обход `FORCE_LOCAL=1` — только для человека, агенту запрещён);
- `.claude/settings.json` — `permissions.deny` + хук `.claude/hooks/block-local-checks.py` блокируют эти команды и Playwright;
- упал тест → НЕ «проверить локально», НЕ поднимать второй worktree «для контроля»: читать лог CI и историю прогонов базовой ветки.

Если CI недоступен или красный по причинам окружения (не кода) — остановись и доложи, не обходи.

**UI не проверяется локально.** После мёржа в `develop` фича уезжает на staging — человек
смотрит её там глазами. Агент в отчёте пишет, что именно смотреть на staging (экран,
сценарий, краевые случаи), и честно отмечает «UI не проверен визуально».

Hard rules:
- NEVER touch `docker/docker-compose.prod.yml`, `docker/deploy.sh`, `.env`, or `docker/nginx/certs/`.
- Makefile-цели остаются точками входа CI (ci.yml зовёт `make lint`, `make test`); их имена — стабильный контракт.

> `make` в CI полностью Dockerized: test/lint-цели гоняют `docker/docker-compose.test.yaml`
> (one-off контейнер из prod Dockerfile). Нет host venv, нет host node_modules.

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
| docs/LIMBO.md              | Междумирье: 5-day grace period after a paid→cheapest tariff downgrade |
| docs/CABIN.md              | каюта: 3 subkinds, JSONB data, access grant, admin view   |
| docs/TORCH.md              | клуб «Факел»: ручной гейт torch_unlocked, singleton-комната, заглушка, admin |
| docs/DYNAMICS.md           | daily-homework journal (28 days), pardons, credits, stats |
| docs/NOTIFICATIONS.md      | bell feed: kinds, generation, realtime delivery           |
| docs/SUPPORT.md            | feedback (bug/improvement) + FAQ                          |
| docs/SURVEY.md             | выпускная анкета: гейт платформы, вопросы, подарок-PDF     |
| docs/GRADUATION_BOOK.md    | генератор выпускных PDF-книг: офлайн-скрипты, приватные данные, запрет на Каюту |
| docs/CALENDAR.md           | calendar events, project-wide vs room-scoped visibility   |
| docs/ARGONAUTS.md          | participant roster tiles, profile+tasks page, diary link  |
| docs/TELEGRAM_BOT.md       | access/support bot: provisioning, proxy, runbook          |
| docs/INTAKE_BOT.md         | intake/payment bot: anketa → tariff → receipt → approval, plans CRUD |
| docs/GENE_KEYS.md          | Генные Ключи: interactive I-Ching wheel, bundled content, geometry |
| docs/EXPEDITION.md         | Круг Экспедиции: landing dashboard, 28-day moon circle, six stages, element locks |
| docs/ARCHITECTURE.md       | Mermaid diagrams: stack, per-domain ER, key flows, environments (human layer, NOT a contract) |
| docs/DECISIONS.md          | ADR log: why each non-obvious decision was made, what breaks if changed (🔒 = frozen) |
| docs/TASK_PROTOCOL.md      | task contract: template, size calibrator, interrogation rule, Linear directions |

Do not read the whole docs/ directory. Pick from the index. Historical/vision docs are in docs/archive/.

ARCHITECTURE.md and DECISIONS.md are the *human* layer: orientation and rationale.
They never override DATA_MODEL.md or the feature docs — those stay the contract.
Before "simplifying" something that looks over-engineered, check DECISIONS.md first.

New feature docs: fold into the closest core domain file if <50 lines AND a natural home exists; otherwise a standalone docs/<DOMAIN>.md added to this index.

## Task workflow

Tasks live in **Linear** (team `ArgonauticaPlatform`, `ARG-*`) — that is the source of
truth for scope. The repo never stores a second copy of a spec.

| Skill | Does | Never does |
|-------|------|------------|
| `/idea` | raw dictated thought → interrogation → one Linear issue per protocol | write code |
| `/slice` | oversized issue → 2–6 sub-issues, each one session / one PR | write code |
| `/work ARG-NN` | issue → implementation → verification → PR → Done | reformulate or re-slice the issue |

Hard rules:
- **One task — one context — one PR.** If a feature does not fit in one context, it is
  sliced wrong; that is a missing planning step, not a tool limit. Stop and `/slice`.
- `/work` refuses an issue that lacks the protocol sections «Границы» / «Готово, когда»,
  or that fails the size calibrator in docs/TASK_PROTOCOL.md.
- Discovering mid-task that the task is bigger than it looked → do NOT push through.
  Commit what is green, note the remainder on the issue, open a follow-up.
- Ask the user only where different answers produce different work; everything else is a
  documented assumption (see «Assumptions» in the protocol).

## Git & PR rules

- Base branch: `develop`. Prod branch: `main`. Feature branches: `feature/<slug>`.
- Conventional commits (`feat:`, `fix:`, `refactor:`, `docs:`, `test:`).
- Commit once at the end of a task (not after every step); зелёность подтверждает CI после push, не локальный прогон.
- Small change (bugfix, minor refactor, text/style) → commit straight to `develop`.
  Large change (new feature, migration, cross-module) → `feature/*` branch + PR into `develop`.
- PRs into `develop` may be self-merged when CI is green (no manual review wait). `develop` → `main` is ALWAYS merged manually by the user.
- **Cleanup after merge** (обязательно): merge with `gh pr merge --squash --delete-branch`, then `git checkout develop && git pull --ff-only && git fetch --prune`
  (`gh` leaves you on `main`), remove your worktree. `develop` и `main` защищены от удаления (branch protection), на GitHub включено автоудаление веток.
- **Linear statuses**: задача, проверяемая только CI → `Done` после мёржа. Задача, меняющая поведение/UI → описание содержит раздел
  «Проверить на staging (вручную)» с чекбоксами, статус `На проверке`; `Done` ставит человек после ручной проверки.
- If the spec is ambiguous: make the smallest reasonable assumption, implement it, and list it explicitly under **Assumptions**. Never guess silently, never expand scope.
- Any change that alters behavior described in docs/ MUST update the corresponding docs/ file in the SAME task.

## Testing rules

- New endpoint → integration test (httpx against the app, real test DB).
- Bug fix → regression test that fails before the fix.
- Do not mock PostgreSQL or Redis in integration tests — the test compose provides real ones.
- Frontend has no test runner yet; the gate is `tsc --noEmit` (в CI). When vitest is added, cover components with logic (skip snapshot-only tests).
- `make migration` autogenerate re-reports 4 phantom index diffs — see docs/DATA_MODEL.md "Migrations gotchas"; NEVER commit those index drops/recreates.
- UI-задача: локально не смотрим (см. «Verification = CI ONLY»); в отчёте — что проверить на staging.
