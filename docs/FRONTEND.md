# Frontend

> Source: docs/archive/{PLATFORM_SPEC.md §4.11/§4.12, PROGRESS.md stages 12–27}, restructured 2026-07-06.
> `frontend/` — React SPA built as a PWA. Build/typecheck via `make test-frontend` / `make lint` (see CLAUDE.md).

## Stack

React 18 + TypeScript + Vite. TanStack Query v5 (server state), Zustand (UI state), react-router-dom v6. Markdown via `marked` + `DOMPurify`. No test runner yet — the gate is `tsc --noEmit`.

## Structure (`src/`)

- `lib/` — `apiClient.ts` (Bearer auth, auto-refresh on 401 via a singleton promise, `ApiError`), `wsClient.ts` (auto-reconnect with backoff ≤15s, ping ~25s, re-subscribe after reconnect), `types.ts` (backend DTOs + discriminated `WsEvent` union), `mediaUpload.ts` (3-step presigned flow + video poster capture).
- `api/` — TanStack Query hooks per domain (messages, rooms, users, media, pins, threads, stickers, kb, calendar, profile, admin, dynamics, notifications, faq, feedback, cabin, tasks) + `cache.ts` mutators.
- `features/` — screens by domain: `auth`, `app` (AppShell, NotificationBell, nav badges), `chat`, `kb`, `calendar`, `profile`, `admin`, `cabin`, `support`, `tasks`.
- `components/` — shared UI (Avatar, Button, Spinner, Overlay=Modal/Drawer/Lightbox, Toasts, icons, VideoPlayer, MediaComposer).
- `hooks/` — `useRealtime` (routes WS events into the Query cache), `useIsMobile`.
- `stores/` — Zustand: `ui` (activeRoomId, typing 4s TTL, online, dmPeers), `toast`.
- `styles/` — `tokens.css` + `global.css`.

## Design system

Strictly the project design system (palette `--color-bezdna`/`--color-more`/`--color-zoloto`; fonts Prata/Lora/Onest; spacing/radii/effects) — take styling from it, not structure. Reference: `frontend/design-system/README.md`.

## Realtime

WS starts at the AppShell root; `useRealtime()` routes events (`message.*`, `pin.*`, `read`, `typing`, `presence`, `notification.*`, `task.*`) into the cache. Client **must** reconnect on drop (blue-green deploy severs sockets). See [MESSAGES.md](MESSAGES.md) for the event contract.

## PWA

Installable (Add to Home Screen; no stores). Web App Manifest (name, icons, `display: standalone`), Service Worker (shell cache, required for install), HTTPS. Built with `vite-plugin-pwa`. Assets: apple-touch-icon, favicon, 192/512 icons. **Push notifications are out of MVP** (Web Push; iOS restrictions) — the open WS only delivers while the app is active. See [NOTIFICATIONS.md](NOTIFICATIONS.md).

## Open question

Token storage (httpOnly-cookie + CSRF vs. in-memory access). Currently access lives in memory; the API client drives refresh. See [AUTH.md](AUTH.md).
