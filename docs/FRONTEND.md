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

`wsClient` exposes a status (`connecting`/`open`/`closed`, via `onStatus`) and `reconnectNow()`. On `visibilitychange → visible` `useRealtime` forces a reconnect (mobile browsers silently drop backgrounded sockets); on every (re)connect it refetches rooms **and** the active room's feed to catch messages missed while the socket was down.

## Offline resilience (network-tolerant chat)

The chat is built to survive bad networks — nothing typed or sent is lost. All of it is client-only, backed by a small dependency-free IndexedDB wrapper (`lib/idb.ts`, stores `outbox`/`drafts`/`querycache`/`cabinOutbox`/`cabinDrafts`; bump `DB_VERSION` when adding a store).

- **Outbox** (`lib/outbox.ts`, wired via `hooks/useOutbox.ts` at the AppShell root). Regular sends (text/attachments/sticker/voice) go through the outbox, **not** a direct mutation: the message is persisted to IndexedDB and shown immediately as an optimistic bubble (negative temp id, `MessageOut._outbox` status `pending`/`failed`). A single sequential worker POSTs with backoff, waits for `online` when offline, and survives reload (`hydrateOutbox` replays the queue at boot). On success the temp bubble is swapped for the real message (deduped against the WS `message.new`). Permanent 4xx (not 408/429) marks the bubble `failed` with **Повторить/Удалить** actions in `MessageItem`. Journal/repost sends stay on the direct mutation path (they have server-coupled side effects).
- **Drafts** (`lib/drafts.ts`). Unsent composer text is debounce-saved per room to IndexedDB, restored when the room reopens, cleared once the message is enqueued. Journal/repost text is excluded (it has its own "charge").
- **Cabin outbox + drafts** (`lib/cabinOutbox.ts` / `lib/cabinDrafts.ts`, wired via `hooks/useCabinOutbox.ts` inside `CabinScreen`). Same pattern as chat, applied to Каюта form submits so a long entry survives a flaky save. On submit the entry is persisted to IndexedDB and shown immediately in the list as an optimistic card (negative temp id for create, existing id for edit; `CabinEntryOut._outbox` status `pending`/`failed`); a background worker POSTs (create) or PUTs (edit) with backoff, waits for `online`, and replays the queue when the screen mounts. On success it's swapped for the server entry (list invalidated to reconcile). Failed cards show **Повторить/Убрать** (`DeliveryStatus`). Unsaved **new**-entry form fields are debounce-saved per `kind` and restored on reopen (the add button reads «Продолжить черновик»); edits aren't drafted (server is the source of truth), and the auto-growing textareas use `hooks/useAutoGrow.ts`.
- **Connection banner** (`features/app/ConnectionBanner.tsx` + `hooks/useConnectionStatus.ts`). Combines `navigator.onLine` and the WS status into `online`/`reconnecting`/`offline`; shows a thin banner under the topbar only when degraded — so the user doesn't have to guess whether the lag is theirs.
- **Bootstrap cache persist** (`lib/queryPersist.ts`). A stable slice of the TanStack Query cache (rooms/users/stickers/messages) is dumped to IndexedDB (debounced) and restored **before** first render in `main.tsx`, so a repeat visit paints instantly from the last session; restored data is marked stale (`updatedAt: 0`) so focus/mount triggers a background refetch. `refetchOnWindowFocus`/`refetchOnReconnect` are now on — the tab-switch "disappearing message" bug was stale cache never refetching on focus.

## PWA

Installable (Add to Home Screen; no stores). Web App Manifest (name, icons, `display: standalone`), Service Worker, HTTPS. Built with `vite-plugin-pwa` in **injectManifest** mode: the custom `src/sw.ts` gets the Workbox precache injected AND adds the `push`/`notificationclick` handlers for native notifications. Update UX unchanged (`registerType: 'prompt'`, `useRegisterSW`, `SKIP_WAITING` message from the update banner). Assets: apple-touch-icon, favicon, 192/512 icons.

**Native push (Web Push / VAPID)** is live. `src/lib/push.ts` handles permission + `pushManager.subscribe` + posting the subscription to the backend; the profile "Уведомления" section is the master toggle + per-kind toggles (persisted to `users.settings["notifications"]`). `sw.ts` shows the notification and, on click, focuses/navigates the app. iOS requires the PWA be installed (Add to Home Screen) — the profile UI warns when it isn't. `sw.ts` is typechecked separately (`tsconfig.sw.json`, WebWorker lib). See [NOTIFICATIONS.md](NOTIFICATIONS.md).

## Open question

Token storage (httpOnly-cookie + CSRF vs. in-memory access). Currently access lives in memory; the API client drives refresh. See [AUTH.md](AUTH.md).
