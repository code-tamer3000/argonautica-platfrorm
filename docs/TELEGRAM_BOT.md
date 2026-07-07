# Telegram Bot (access & support)

> Source: docs/archive/{PLATFORM_SPEC.md §4.18, DECISIONS.md, OPERATIONS.md §2, DATA_MODEL.md}, restructured 2026-07-06.
> Service `bot` (`backend/scripts/telegram_bot.py`), same image as backend. Not a web part — a long-polling worker.

The way into a closed platform (no web signup) and a support channel to the admin. Accounts are pre-created by the admin (see [AUTH.md](AUTH.md)); login = Telegram `@username`.

## Functions (inline-keyboard menu)

- **Get / reset password** — matches the sender's `@username` to a platform login (case-insensitive) and issues a **fresh one-time password** (DB stores only the argon2 hash, so it re-issues, not "retrieves"; sets `must_change_password`), plus the link and PWA install instructions. Rate-limited in Redis (`bot:pwd:{tg_id}`).
- **Ask a technical question** — forwarded to the admin DM (`TELEGRAM_ADMIN_CHAT_ID`); the admin's `reply` is delivered back to the participant. State in Redis: `bot:await_q:{tg_id}`, `bot:qmap:{admin_msg_id}` → chat to deliver the answer to. Every action is also logged to the admin DM + stdout.

## Transport & deployment

- **HTTP Bot API + long-polling `getUpdates`** (not MTProto/webhook). On RU hosting Telegram IPs are often blocked → tunnel through a plain **SOCKS5/HTTP proxy** (`TELEGRAM_PROXY`) over httpx. No public route/TLS endpoint needed.
- **Singleton, outside blue-green**, healthcheck disabled (it doesn't listen on :8000): two pollers on one token would fight over `getUpdates`. For the same reason the bot is **not on staging** (see [DEPLOY.md](DEPLOY.md)).
- Env: `TELEGRAM_BOT_TOKEN`, `TELEGRAM_PROXY`, `TELEGRAM_ADMIN_CHAT_ID`, `PLATFORM_URL`.

## Accepted risk

A Telegram username can be changed → theoretical takeover of a login that matched by handle. The group is closed (~30 people), the password is temporary and must be changed — risk accepted; issue frequency is Redis-limited.

> Setup/proxy/diagnostics runbook: docs/archive/OPERATIONS.md §2.
