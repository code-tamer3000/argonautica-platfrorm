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
- `stores/` — Zustand: `ui` (activeRoomId, typing 4s TTL, online, dmPeers), `toast`, `theme` (dark/light, see below).
- `styles/` — `tokens.css` + `global.css`.

## Design system

Strictly the project design system (palette `--color-bezdna`/`--color-more`/`--color-zoloto`; fonts Prata/Lora/Onest; spacing/radii/effects) — take styling from it, not structure. Reference: `frontend/design-system/README.md`.

**Theming (dark/light).** Dark is the default; a light "пергамент" theme is available. The palette tokens (`--color-*`) and a few semantic tokens are redefined under `:root[data-theme='light']` in `tokens.css`; since components resolve everything through those tokens, redefining the base palette flips the whole UI — style through tokens, never hardcode hex. `stores/theme.ts` owns the choice (persisted in `localStorage['arg-theme']`), sets `data-theme` on `<html>`, and is applied before first render via `applyThemeAtBoot()` in `main.tsx` (no flash). The user switches theme in the ЛК (ProfileScreen → «Оформление»).

## Realtime

WS starts at the AppShell root; `useRealtime()` routes events (`message.*`, `pin.*`, `read`, `typing`, `presence`, `notification.*`, `task.*`) into the cache. Client **must** reconnect on drop (blue-green deploy severs sockets). See [MESSAGES.md](MESSAGES.md) for the event contract.

## PWA

Installable (Add to Home Screen; no stores). Web App Manifest (name, icons, `display: standalone`), Service Worker, HTTPS. Built with `vite-plugin-pwa` in **injectManifest** mode: the custom `src/sw.ts` gets the Workbox precache injected AND adds the `push`/`notificationclick` handlers for native notifications. Update UX unchanged (`registerType: 'prompt'`, `useRegisterSW`, `SKIP_WAITING` message from the update banner). Assets: apple-touch-icon, favicon, 192/512 icons.

**Native push (Web Push / VAPID)** is live. `src/lib/push.ts` handles permission + `pushManager.subscribe` + posting the subscription to the backend; the profile "Уведомления" section is the master toggle + per-kind toggles (persisted to `users.settings["notifications"]`). `sw.ts` shows the notification and, on click, focuses/navigates the app. iOS requires the PWA be installed (Add to Home Screen) — the profile UI warns when it isn't. `sw.ts` is typechecked separately (`tsconfig.sw.json`, WebWorker lib). See [NOTIFICATIONS.md](NOTIFICATIONS.md).

## Open question

Token storage (httpOnly-cookie + CSRF vs. in-memory access). Currently access lives in memory; the API client drives refresh. See [AUTH.md](AUTH.md).
