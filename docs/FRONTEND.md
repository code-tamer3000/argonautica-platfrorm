# Frontend

> Source: docs/archive/{PLATFORM_SPEC.md §4.11/§4.12, PROGRESS.md stages 12–27}, restructured 2026-07-06.
> `frontend/` — React SPA built as a PWA. Build/typecheck via `make test-frontend` / `make lint` (see CLAUDE.md).

## Stack

React 18 + TypeScript + Vite. TanStack Query v5 (server state), Zustand (UI state), react-router-dom v6. Markdown (`marked` + `DOMPurify`) is used in the knowledge base, tasks (curated, admin-authored bodies), and **journal channels** (`room.type === 'channel' && !is_news` — «Дневник»/«Личный дневник», where participants keep daily formatted entries), via `lib/markdown.ts`. DM, group and news-channel messages render as **plain text** (`lib/messageText.tsx`): newlines preserved, bare URLs auto-linked, @-mentions highlighted, no markdown syntax — nobody formats a DM with `**`/`#`, and rendering it there just swallowed literal characters. No test runner yet — the gate is `tsc --noEmit`.

## Structure (`src/`)

- `lib/` — `apiClient.ts` (Bearer auth, auto-refresh on 401 via a singleton promise, `ApiError`), `wsClient.ts` (auto-reconnect with backoff ≤15s, ping ~25s, re-subscribe after reconnect), `types.ts` (backend DTOs + discriminated `WsEvent` union), `mediaUpload.ts` (3-step presigned flow + video poster capture).
- `api/` — TanStack Query hooks per domain (messages, rooms, users, media, pins, threads, stickers, kb, calendar, profile, admin, dynamics, notifications, faq, feedback, cabin, tasks) + `cache.ts` mutators.
- `features/` — screens by domain: `auth`, `app` (AppShell, NotificationBell, nav badges), `chat`, `kb`, `calendar`, `profile`, `admin`, `cabin`, `support`, `tasks`.
- `components/` — shared UI (Avatar, Badge, Button, Card, Chip, EmptyState, Input, PageHeader, Segmented, Spinner, Overlay=Modal/Drawer/Lightbox, Toasts, icons, VideoPlayer, MediaComposer).
- **Chat composer paperclip → menu** (not a direct file dialog): «Файл» (upload as before) or «Ссылка на материал / задачу» → `features/chat/RefPicker.tsx` (tabs Материалы/Задачи, title search over `useKbItems`/`useTasks`, which the server already scopes to visible items). One picked ref → a chip above the input (beside media chips) and `ref_kind`/`ref_id` on `SendBody`; the optimistic bubble shows the ref immediately (`OutboxItem.optimisticRef`). `MessageItem` renders `msg.ref` as a «Перейти к материалу/задаче» button before the text (disabled when `available=false`). Media and a ref can ride the same message. See [MESSAGES.md](MESSAGES.md).
- `hooks/` — `useRealtime` (routes WS events into the Query cache), `useIsMobile`.
- `stores/` — Zustand: `ui` (activeRoomId, typing 4s TTL, online, dmPeers), `toast`, `theme` (dark/light, see below).
- `styles/` — `tokens.css` + `global.css`.

## Design system

Strictly the project design system (palette `--color-bezdna`/`--color-more`/`--color-zoloto`; fonts Prata/Lora/Onest; spacing/radii/effects) — take styling from it, not structure. Reference: `frontend/design-system/README.md`.

**Token contract.** Colors, spacing and radii resolve through `styles/tokens.css` — never hand-write a hex or a raw px where a token exists. `var(--x, #hex)` fallbacks are a trap: if `--x` isn't actually declared in `tokens.css`, the fallback fires *every time* and nobody notices (found in production: `--danger`/`--color-error`/`--color-gold`/`--border` were referenced in 6 files with hex fallbacks but declared nowhere — four different "error red"s across the app instead of one `--blood-bright`). Before adding a `var(--new-name, ...)` reference, either declare it in `tokens.css` or reuse an existing token; before merging, `grep -rn "var(--" frontend/src` for any name not defined in `tokens.css` (`--gk-gold*` in `features/genkeys/genkeys.module.css` is a legitimate local alias, not a bug — check module-scoped `:root`-level declarations before assuming a var is undefined). Base component set for new UI: `Button` for actions, `Input` for text fields, `Spinner` for loading state, `Overlay` for modals/drawers/lightboxes, plus `Badge`, `Card`, `Chip`, `EmptyState`, `Segmented` — don't hand-roll a competing implementation (full inventory + duplicates found: see ARG-39 audit).

**Shared primitives, and what stays local.** `Badge` (`tone="neutral"|"accent"`), `Chip` (`kind=neutral|accepted|returned|soon|late|unreviewed`), `Card` (component for plain `<div>`, or `cardClass()` when the surface has to be a `<Link>`/`<article>`/`<form>`), `EmptyState` (`size="inline"|"block"`) and `Segmented` replace what used to be copy-pasted CSS across feature modules. Three things deliberately did **not** fold into them, because they only share a name:

- `features/auth` and `features/survey` `.card` — a centred, max-width layout wrapper for the whole screen, not a surface over the background.
- `features/admin/dynamics` `.card` — same surface but with its own padding/gap plus `.cardActive`/`.cardGraduated` border modifiers; folding it in would mean threading those through the shared API for one caller.
- `features/tasks/stream` `.note` and `.mark` (previously `.empty` and `.badge`) — an explanatory paragraph inside a panel and an inline annotation inside a blockquote. Neither reads as a centred empty state or a bordered uppercase pill; the names were the only thing they had in common with the primitives.

The rule this suggests: match on what an element *is*, not on what its class is called. Two `.empty` rules in different modules were genuinely the same component; a third was a paragraph.

**Theming (dark/light).** Dark is the default; a light "пергамент" theme is available. The palette tokens (`--color-*`) and a few semantic tokens are redefined under `:root[data-theme='light']` in `tokens.css`; since components resolve everything through those tokens, redefining the base palette flips the whole UI — style through tokens, never hardcode hex. `stores/theme.ts` owns the choice (persisted in `localStorage['arg-theme']`), sets `data-theme` on `<html>`, and is applied before first render via `applyThemeAtBoot()` in `main.tsx` (no flash). The user switches theme in the ЛК (ProfileScreen → «Оформление»).

## Admin navigation & page headers (ARG-97)

**Admin section config.** `features/admin/sections.ts` is the single source for the
admin's 13 sections (`ADMIN_SECTIONS`: `path`/`label`/`group`/`Component`) and the 3
groups (`ADMIN_GROUPS`: `intake`=Приём, `progress`=Прохождение, `support`=Поддержка).
`AdminLayout.tsx` renders the vertical grouped sidebar from `ADMIN_SECTIONS`;
`AppShell.tsx` generates the `/admin/*` child routes from the same array — removing a
row removes both the menu entry and the route. `ADMIN_DEFAULT_PATH` (`'dynamics'`) is
kept separate from array order so re-grouping sections doesn't change the `/admin`
landing redirect. On mobile (`useIsMobile`, ≤768px) the sidebar collapses behind a
burger toggle in `AdminLayout` and auto-closes on navigation (`useEffect` on
`location.pathname`).

**`PageHeader`** (`components/PageHeader.tsx` + `pageHeader.module.css`) is the shared
screen header: an always-visible back button (`navigate(-1)`, no attempt to detect
whether there's history to go back to) + `<h1>{title}</h1>` + an optional actions slot
(`children`, right-aligned). Wired on all 13 admin screens, `TaskDetail`, `KbViewer`,
`ProfileScreen` and `SupportScreen`. Menu-item labels and each screen's `<h1>` are kept
in sync through this: the `title` prop always equals the section's `ADMIN_SECTIONS`
label.

**Three pre-existing "back" affordances were deliberately left unconverted** — each is
a different mechanism than "go to the previous history entry":

- `features/kb/book/KbBookReader.tsx` — `<Link to={backTo}>` where `backTo` is computed
  (`/genkeys?key=N` for a Gene Key deep-link, otherwise `/kb/:id`). A generic
  `navigate(-1)` would break the Gene Key round-trip.
- `features/chat/ChatPane.tsx` (`onBack` prop) — mobile master/detail: switches from
  room detail back to the room list within the same route, not a history navigation.
- `features/chat/DailyJournalForm.tsx` (`backToChoice`) — toggles between journal input
  modes (free entry / task sections) inside the composer bar; it never leaves the
  screen, so there's no "previous screen" to go back to.

## Realtime

WS starts at the AppShell root; `useRealtime()` routes events (`message.*`, `pin.*`, `read`, `typing`, `presence`, `notification.*`, `task.*`) into the cache. Client **must** reconnect on drop (blue-green deploy severs sockets). See [MESSAGES.md](MESSAGES.md) for the event contract.

`wsClient` exposes a status (`connecting`/`open`/`closed`, via `onStatus`) and `reconnectNow()`. On `visibilitychange → visible` `useRealtime` forces a reconnect (mobile browsers silently drop backgrounded sockets); on every (re)connect it refetches rooms **and** the active room's feed to catch messages missed while the socket was down.

## Offline resilience (network-tolerant chat)

The chat is built to survive bad networks — nothing typed or sent is lost. All of it is client-only, backed by a small dependency-free IndexedDB wrapper (`lib/idb.ts`, stores `outbox`/`drafts`/`querycache`/`cabinOutbox`/`cabinDrafts`/`outboxBlobs`; bump `DB_VERSION` when adding a store).

- **Outbox** (`lib/outbox.ts`, wired via `hooks/useOutbox.ts` at the AppShell root). Regular top-level sends (text/attachments/sticker/voice) go through the outbox, **not** a direct mutation: the message is persisted to IndexedDB and shown immediately as an optimistic bubble (negative temp id, `MessageOut._outbox` status `pending`/`failed`). A single sequential worker POSTs with backoff, waits for `online` when offline, and survives reload (`hydrateOutbox` replays the queue at boot). On success the temp bubble is swapped for the real message. **Dedup against the WS echo:** the server broadcasts your own `message.new` too, but its real id ≠ the temp id, so id-dedup can't catch it — the WS handler therefore skips a `message.new` whose `sender_id` is you **while `outbox.hasPending(roomId)` is true** (the send path's `resolveOptimistic`/`appendMessage` places it instead); another device of the same user has no queue, so it still shows the message. Permanent 4xx (not 408/429) marks the bubble `failed` with **Повторить/Удалить** actions in `MessageItem`. Journal/repost sends stay on the direct mutation path (they have server-coupled side effects), as do **thread replies** (they don't live in the room's optimistic feed) — media on those paths is uploaded synchronously at send time (`runPendingUpload`) and so needs the network. **Offline media (deferred upload).** A file/voice attached in the composer is **not** uploaded on attach — `preparePendingUpload`/`preparePendingVoice` only snap dimensions/poster **locally** (no network) and hand a raw `PendingUpload` (the source `Blob` + metadata) to `enqueueMedia`. The bytes go to the `outboxBlobs` store (keys `${clientId}:${tempAssetId}` and `…:poster`, temp id negative), the optimistic bubble renders from a `blob:` URL, and the **worker** does the 3-step MinIO upload (`resolvePendingUploads`) → fills `body.attachment_ids` → POSTs the message, all with the same backoff/`online`-wait as text. **Upload progress:** the worker threads the PUT's `xhr.upload.onprogress` back through an outbox `progress` callback → `markUploadProgress` writes the overall fraction (`(uploaded + current)/total` across a message's attachments) into `_outbox.uploadProgress`, and `MessageItem` renders a bar on the optimistic bubble while it's `pending` — so sending a big video in chat shows a real % instead of just a muted bubble. Cleared automatically when the temp bubble is swapped for the real message. So a voice/file message queued fully offline survives reload (`hydrateOutbox` re-mints the `blob:` URLs) and sends itself when the network returns — previously the upload ran *before* the enqueue and just failed offline (a lost «fail load» file / vanishing voice spinner). Bytes and URLs are released (`revokeObjectURL` + store delete) as each asset uploads and on success/**Удалить**. **Order matters on success:** the temp bubble is swapped for the real message (`onResolve`, which carries the server presigned-URLs) **before** `releaseBlobs` revokes the optimistic `blob:` URL — otherwise there's a frame where the temp bubble is still shown but its `blob:` URL is already dead, and the attachment (video/photo) vanishes until a page reload.
- **Drafts** (`lib/drafts.ts`). Unsent composer text is debounce-saved per room to IndexedDB, restored when the room reopens, cleared once the message is enqueued. Journal/repost text is excluded (it has its own "charge").
- **Cabin outbox + drafts** (`lib/cabinOutbox.ts` / `lib/cabinDrafts.ts`, wired via `hooks/useCabinOutbox.ts` inside `CabinScreen`). Same pattern as chat, applied to Каюта form submits so a long entry survives a flaky save. On submit the entry is persisted to IndexedDB and shown immediately in the list as an optimistic card (negative temp id for create, existing id for edit; `CabinEntryOut._outbox` status `pending`/`failed`); a background worker POSTs (create) or PUTs (edit) with backoff, waits for `online`, and replays the queue when the screen mounts. On success it's swapped for the server entry (list invalidated to reconcile). Failed cards show **Повторить/Убрать** (`DeliveryStatus`). Unsaved **new**-entry form fields are debounce-saved per `kind` and restored on reopen (the add button reads «Продолжить черновик»); edits aren't drafted (server is the source of truth), and the auto-growing textareas use `hooks/useAutoGrow.ts`.
- **Connection banner** (`features/app/ConnectionBanner.tsx` + `hooks/useConnectionStatus.ts`). Combines `navigator.onLine` and the WS status into `online`/`reconnecting`/`offline`; shows a thin banner under the topbar only when degraded — so the user doesn't have to guess whether the lag is theirs.
- **Bootstrap cache persist** (`lib/queryPersist.ts`). A stable slice of the TanStack Query cache (rooms/users/stickers/messages) is dumped to IndexedDB (debounced) and restored **before** first render in `main.tsx`, so a repeat visit paints instantly from the last session; restored data is marked stale (`updatedAt: 0`) so focus/mount triggers a background refetch. `refetchOnWindowFocus`/`refetchOnReconnect` are now on — the tab-switch "disappearing message" bug was stale cache never refetching on focus.

## PWA

Installable (Add to Home Screen; no stores). Web App Manifest (name, icons, `display: standalone`), Service Worker, HTTPS. Built with `vite-plugin-pwa` in **injectManifest** mode: the custom `src/sw.ts` gets the Workbox precache injected AND adds the `push`/`notificationclick` handlers for native notifications. Update UX unchanged (`registerType: 'prompt'`, `useRegisterSW`, `SKIP_WAITING` message from the update banner). Assets: apple-touch-icon, favicon, 192/512 icons.

**Media cache, two layers (ARG-75 + ARG-16).**

- **Layer 1 — ordinary browser HTTP cache**, works for **all** media kinds on **every** origin including `MEDIA_DOMAIN`. The backend now rounds the presigned-GET signing moment down to a 24h window (`PRESIGN_GET_WINDOW`, `services/media.py`, see [FILES.md](FILES.md)), so repeat requests for the same object within the window get a byte-identical URL — the browser cache, which keys on the full URL including query, finally hits. nginx's `Cache-Control: private, max-age=86400, immutable` was always correct; it just had nothing to key on before. No SW/Cache Storage involved, so this layer benefits video/audio too (though 206-range responses cache poorly in Chrome/Firefox's HTTP cache — the gain there is partial; full range/segment delivery is [ARG-77]).
- **Layer 2 — SW `CacheFirst`** (`sw.ts` + `lib/mediaCache.ts`), same-origin only, **images only**. Predates layer 1 (ARG-16) and is kept as a second line of defense: it keys on `origin + pathname` (dropping query entirely, so it doesn't even need a stable presigned URL) and isn't capped by the 24h window. Cache `arg-media-v1`, capped by `workbox-expiration` (60 entries / 7 days / `purgeOnQuotaError`). Any request carrying a `Range` header is passed through untouched — video streams by range and a CacheFirst over it would break seeking (and would blow the phone's quota); the route requires `destination === 'image'` **or** an image extension in the path (the lightbox pulls its image through `fetch`, whose destination is `''`). Logout (`features/auth/api.ts`) deletes the cache — media is private and the device may be shared; the delete is best-effort so a missing Cache API can't break logout.

**Lightbox preview derivative.** Attachments carry `preview_url` (WebP ~1600px) next to `thumb_url` and `url`. The feed renders `thumb_url`, the lightbox opens `preview_url ?? url`, and downloads always use `url` (the original). The fallback is load-bearing: `preview_url` is `null` for legacy rows, non-images and failed generation. The lightbox's progress logic is unchanged — photos still stream the whole blob with a % bar (`useImageDownload`), video still plays natively with a buffer indicator.

**Native push (Web Push / VAPID)** is live. `src/lib/push.ts` handles permission + `pushManager.subscribe` + posting the subscription to the backend; the profile "Уведомления" section is the master toggle + per-kind toggles (persisted to `users.settings["notifications"]`). `sw.ts` shows the notification and, on click, focuses/navigates the app. iOS requires the PWA be installed (Add to Home Screen) — the profile UI warns when it isn't. `sw.ts` is typechecked separately (`tsconfig.sw.json`, WebWorker lib). See [NOTIFICATIONS.md](NOTIFICATIONS.md).

**Mobile keyboard / viewport** (`lib/viewport.ts`). `#root`/`body` are `position: fixed` at `--app-height` (= `visualViewport.height`), so the composer sits flush above the on-screen keyboard and iOS's focus-scroll can't drag the layer up (any window/ancestor scroll is pinned back to 0). `--app-height` and the `html[data-kb='open']` flag update on `visualViewport` resize; **keyboard-open is detected by comparing the current viewport height against the largest height seen (the keyboard-free baseline), not against `root.clientHeight`** — on Android the layout viewport shrinks with the keyboard too, so a `clientHeight` comparison stayed ≈0 and never fired (the bottom tab-bar then stayed over the composer). `data-kb='open'` hides the bottom nav (`translateY(100%)`) and drops its `padding-bottom` reserve so the composer is flush. On mobile the composer `textarea` `max-height` is smaller (120px) so a long message scrolls internally instead of pushing the send button off-screen, and while `data-kb='open'` the personal-journal `DailyJournalForm` bar and the typing indicator are hidden — on a short screen they ate the height the composer needed and pushed its bottom under the keyboard (DMs have neither bar, hence the journal-only bug). Note: iOS renders a native accessory bar (↑↓ / «Готово») above the keyboard for form fields; it can't be removed by any web means (contenteditable doesn't drop it either on current iOS), so we don't try — the layout just keeps the input fully visible above it.

## Клиентский RUM (ARG-80)

Серверные метрики (ARG-79) видят только своё время ответа; «долго грузится» с телефона
ими не разложить. Клиентский слой (`lib/metrics.ts`, тот же модуль, что и метрики медиа,
та же очередь + батч + `keepalive`) добавляет четыре измерения. Всё best-effort:
недоступный приёмник, отсутствующий API браузера или ошибка сбора не роняют ни один экран.

- **Первый экран** — один трейс на загрузку приложения из Navigation Timing:
  `dns`, `tcp`, `tls`, `ttfb`, `dom_interactive` + `lcp` через `PerformanceObserver`
  (нет LCP — трейс уходит без него, а не теряется). Разделитель, ради которого всё
  сделано: **`ttfb` = канал плюс сервер, `frontend` = `lcp − ttfb` = сам фронт**
  (`frontend` считается на приёме). Разрезы: **холодный/тёплый заход**
  (`navigator.serviceWorker.controller === null` — оболочка ещё не из кэша SW),
  **тип сети** (`effectiveType`) и **версия сборки** (`__BUILD_VERSION__`, define в
  `vite.config.ts`, переопределяется `BUILD_VERSION` в окружении сборки; без неё цифры
  до и после релиза смешиваются в кашу). Трейс уходит через 5с после `load` или раньше,
  если вкладку свернули.
- **Открытие комнаты** — `beginRoomOpen` в `api/messages.ts` (первая страница истории)
  → `noteRoomHistoryLoaded` (длительность запроса + `ttfb` из Resource Timing) →
  `noteRoomRendered` в `ChatPane` по кадру после того, как лента отрисована свежими
  данными. Завязка на `dataUpdatedAt`, а не на «есть сообщения»: лента сперва рисуется
  из восстановленного кэша (`queryPersist`), и иначе трейс закрывался бы до ответа.
  Лента, пришедшая только из кэша (запроса не было), не меряется вовсе.
- **Байты медиа за заход в комнату** — сумма `transferSize` из Resource Timing по
  image/video/audio за 3с после захода, с меткой `first`/`repeat` (список посещённых
  комнат — в `sessionStorage`). Отданное из кэша даёт `transferSize === 0`, поэтому
  просадка суммы на повторном заходе и есть метрика попадания в кэш медиа (ARG-75).
  Окно замера отматывается на 1с назад: при заходе с перезагрузкой картинки уходят в
  сеть в том же кадре, что и монтирование.
- **Упавший экран** — `error` и `unhandledrejection`: сообщение (≤500), стек (≤4000),
  роут (`location.pathname`, без query) и версия сборки. Пользовательского контента нет;
  не больше 10 записей за сессию, отправка сразу (экран мог упасть совсем).

Приём — `POST /api/metrics/client` (любой активный пользователь, всегда 204). Свод —
`GET /api/metrics/client` (админ): `{enabled, first_screen: {"cold:4g:lcp": {...}},
scenarios: {"room_open:ttfb": {...}}, bytes: {"first:image": {count, sum_bytes,
avg_bytes}}, errors: {counts, recent}}`. Перцентили — метки бакетов гистограммы Redis
(`metrics:client:*`), как у медиа и HTTP. Флаги: `CLIENT_METRICS_ENABLED`,
`CLIENT_METRICS_TTL_SECONDS`, `CLIENT_ERRORS_KEEP`. Сырые события — JSON-строки с
`"metric":"client"` в логе бэкенда; поля проходят белый список (`log_client_metric`),
как структурный лог запросов. Значения клиентские и не доверенные: только наблюдение.

## Open question

Token storage (httpOnly-cookie + CSRF vs. in-memory access). Currently access lives in memory; the API client drives refresh. See [AUTH.md](AUTH.md).
