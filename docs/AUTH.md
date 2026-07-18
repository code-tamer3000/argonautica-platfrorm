# Auth & Access

> Source: docs/archive/{PLATFORM_SPEC.md §4.1/§6.1/§6.2, DECISIONS.md, OPERATIONS.md §1}, restructured 2026-07-06.
> Endpoints: `/api/auth`, `/api/admin`. Tables: `users` (see [DATA_MODEL.md](DATA_MODEL.md)).

## Model

- **Closed platform, no self-signup.** Admin provisions accounts; login = Telegram username (`users.username`), `email` optional.
- **Two roles** (`users.role`): `participant` (KB, chats, own profile) and `admin` / author (content + moderation + everything).
- **Per-flag grants** (not roles), admin-togglable via `PATCH /api/admin/users/{id}`:
  - `can_create_groups` (default true) — may create group rooms.
  - `can_access_cabin` (default false) — see [CABIN.md](CABIN.md).
  - `is_observer` (default false) — **observer mode**: passive, materials-only access.
    Keeps **only** КБ ([KB.md](KB.md)) and Генные ключи ([GENE_KEYS.md](GENE_KEYS.md)),
    plus own Профиль and Техподдержка.
    **Loses** Рубка **and Новости** (all chat, including the news channel — no room
    access at all), Задачи ([TASKS.md](TASKS.md)), Календарь ([CALENDAR.md](CALENDAR.md)),
    Каюта (even if `can_access_cabin`), Динамика ([DYNAMICS.md](DYNAMICS.md)) and the
    notification feed ([NOTIFICATIONS.md](NOTIFICATIONS.md)). Mutually exclusive with
    `admin` (a request that would make a user both → 400). Enforced by
    `require_participant` (whole-router on tasks/calendar/dynamics/notifications),
    `assert_room_access` (403 on every room for observers) for chat, and
    `require_cabin_access`.

## JWT flow

- **Access token** — short-lived, stateless, sent as `Authorization: Bearer <token>`.
- **Refresh token** — carries a `jti`; the `jti` is whitelisted in Redis so it can be revoked (logout a device, ban). See Redis uses in [DATA_MODEL.md](DATA_MODEL.md).
- TTLs from config: `JWT_ACCESS_TTL_MINUTES`, `JWT_REFRESH_TTL_DAYS`.
- Passwords hashed with **argon2** (`argon2-cffi`), never plaintext; transparent rehash on login when params change.

## Endpoints (`/api/auth`)

| Endpoint | Behavior |
|---|---|
| `POST /login` | IP rate-limited (anti-bruteforce). **Anti-enumeration:** identical response for "no such user" and "wrong password". |
| `POST /refresh` | **Rotation:** revoke the presented `jti`, issue a new pair. |
| `POST /logout` | Idempotent revoke of the refresh `jti`. |
| `POST /change-password` | Allowed while `must_change_password=true` (first login). |
| `GET /me` | Current profile (signed `avatar_url`, bio, settings). Reachable even when `must_change_password`. |
| `PATCH /me` | Update display_name/bio/avatar/settings; avatar must be the caller's own image asset (else 403/404); `extra="forbid"`. |

## Provisioning (admin, `/api/admin`)

- Whole router under `require_admin`.
- `POST /users` — server generates a one-time password, returns it **once**, sets `must_change_password=true`.
- `PATCH /users/{id}` — whitelisted fields only (`role`, `can_create_groups`, `can_access_cabin`, `is_observer`, …). Toggling `can_access_cabin` false→true sends a `cabin_granted` notification — see [NOTIFICATIONS.md](NOTIFICATIONS.md). Setting `is_observer=true` on an admin (or `role=admin` on an observer) → 400 (mutually exclusive).
- Bulk account creation runbook and the password-delivery bot: [OPERATIONS in archive] and [TELEGRAM_BOT.md](TELEGRAM_BOT.md).

## Authorization — threat #1

Every read/action checks membership/role **server-side**; never trust client-supplied `id`/`room_id` (IDOR / broken access control). Dependency chain in `api/deps.py`: `get_current_user → get_current_active_user → require_admin`. Cabin adds `require_cabin_access`; observer-closed sections add `require_participant` (rejects `is_observer`). See per-endpoint patterns in [API_CONVENTIONS.md](API_CONVENTIONS.md).

## Security notes

- Only WSS/HTTPS. WS handshake validates the JWT (see [MESSAGES.md](MESSAGES.md)).
- Token storage on the frontend (httpOnly-cookie + CSRF) is an **open question** — currently access in memory, refresh via the API client. See [FRONTEND.md](FRONTEND.md).
- Rate limits (login/send/upload) in [API_CONVENTIONS.md](API_CONVENTIONS.md).
