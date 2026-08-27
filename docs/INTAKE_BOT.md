# Intake bot (приём и оплата)

> Service `intake-bot` (`backend/scripts/intake_bot.py`), same image as backend. Long-polling
> worker, not a web part. Introduced by ARG-92 — see also [TELEGRAM_BOT.md](TELEGRAM_BOT.md)
> (the *other* bot: access/support, a separate service on a separate token).

Replaces the manual "person messages a manager, pays, gets added by hand" path with a
self-service Telegram funnel: anketa → admin accepts → tariff → payment receipt → admin
confirms → platform account created. Ported and extended from the old PHP bot
(`OldBot/`, cron long-poll, no tariff step, no real account creation) — texts are reused
verbatim from `OldBot/bot_texts.md`.

## Funnel (`intake_applications.status`)

```
awaiting_about → submitted → choosing_plan → awaiting_offer → awaiting_receipt →
  payment_review → confirmed
                     ↑                ↓                ↓
                     └──── expired ←──┴────────────────┘   (booking burned, ARG-108)
```

1. **`/start`** → bot asks the applicant to describe themselves in one message
   (`ask_about`, also the opening line of `start` — same string, see «Placeholder texts»).
2. Reply → `status=submitted`; the anketa is forwarded to the admin DM with an **«Принять»**
   button.
3. Admin taps **«Принять»** → the anketa message is edited in place (`editMessageText`):
   button removed, «— ✅ Принята» appended to the header, no separate confirmation message —
   before this, the tap fired two *extra* chat messages (a confirmation + a `📋` log echo),
   which made it easy to reply to the wrong bubble later (see the admin-chat bug above).
   `status=choosing_plan` and the 24h booking clock starts (`payment_deadline_at`, see
   «Payment window» below); bot shows tariffs as buttons, read
   from the `plans` table **at request time** (not hardcoded — an admin price edit applies
   immediately, no bot redeploy). **One button per tariff** («Вода — 12 000 ₽») opening a
   description screen: title, price, `plans.description`, and a single row of
   **«⬅️ Назад»** / **«✅ Перейти к оплате»**. List ⇄ description ⇄ back all happen in
   **one message** via `editMessageText` — the chat never fills with stale copies of the
   menu (ARG-94). If that message is gone (user deleted it), the bot silently falls back to
   sending a new one. A tap on a screen that is stale relative to `app.status` changes
   nothing and answers with an alert («Этот шаг уже пройден»).
4. Pick a tariff → `status=awaiting_offer` (ARG-43): bot sends **«📄 Читать оферту»**
   (a Telegram `web_app` button opening `{PLATFORM_URL}/oferta` — the one unauthenticated
   route in the SPA, see [FRONTEND.md](FRONTEND.md)) and **«✅ Согласен, к оплате»**
   (`callback_data=of:<app_id>`). Payment details are **not** sent yet.
5. Tap **«✅ Согласен, к оплате»** → `intake_applications.offer_accepted_at` = now,
   `offer_version` = the bot's `OFFER_VERSION` constant (bump it whenever the offer text
   changes — the offer itself lives in git, `frontend/src/features/oferta/content/oferta.md`,
   not in the DB), `status=awaiting_receipt`; **now**
   the bot sends payment details (the
   `accepted` text with `{price}` substituted for the chosen tariff's price) and asks for a
   receipt. Below the text, `_payment_keyboard()` attaches two buttons: **«💬 Связаться по
   техническим вопросам»** (reuses `CB_ASK_QUESTION`/`_handle_ask_question` — this is the
   one screen where that legacy inline button still renders, since this is the step where
   questions are most common) and **«💳 Оплатить зарубежной картой»** (`TRIBUTE_PAYMENT_URL`,
   opens the Tribute mini-app for applicants without a RU bank account — one fixed link for
   every tariff, Tribute handles the actual amount on its own side, not something this bot
   passes through).
6. Receipt (photo or PDF document) → `status=payment_review`; forwarded to the admin DM
   with a **«Подтвердить оплату»** button.
7. Admin taps **«Подтвердить оплату»** → bot creates the platform account **on this
   environment** (see `PLATFORM_URL` — on staging, the staging domain). The receipt
   message's caption is edited in place (`editMessageCaption`, button removed, «— ✅
   Подтверждено, логин ...» appended) instead of a separate confirmation message, same
   reasoning as the anketa-accept edit above. (Manual confirmation with no receipt at all —
   admin saw the payment land some other way — goes through `/confirm @username` instead,
   see below, which shares this same account-creation path.) Login = the
   applicant's Telegram `@username`, one-time password (`must_change_password=true`),
   `intake_id` = the current active intake ([DATA_MODEL.md](DATA_MODEL.md) `intakes`),
   `plan_id` = the chosen tariff. Right after the account is created, the bot assigns the
   new user every `type='individual'` task tagged with this same `intake_id` (welcome
   tasks provisioned ahead of time by `scripts/provision_second_intake.py`, with an empty
   recipient list at creation — see that script and [TASKS.md](TASKS.md)). Sends
   login/password + `PLATFORM_URL` to the applicant. `status=confirmed`,
   `intake_applications.user_id` set.
   - If the applicant has no Telegram `@username` at this point, account creation is
     refused (login = username, must exist) — the admin gets an alert and the applicant is
     asked to set one; nothing else in the funnel is blocked, retry the same button once
     they have.
8. Any step between «Принять» and the receipt can end in **`expired`** — the booking
   window ran out. See «Payment window» below.
9. In-between statuses show `wait_decision` / `wait_payment_check` / the offer prompt again
   (idle waiting on the *other* party, or on the applicant tapping «Согласен») if the
   applicant sends something out of turn.

After `confirmed`, the chat becomes **service mode**: **«Сменить пароль»** (re-issue a
fresh one-time password, same helper as `scripts/telegram_bot.py`'s password reset) as an
inline button, plus `/question` (forward to admin DM + deliver the reply back — same
mechanism as the access bot's support channel), same as at every other step.

**«Задать вопрос» is available at every funnel step**, not just in service mode — as the
**`/question` command** and the bot's menu button (`setMyCommands` + `setChatMenuButton`,
both set by the service at startup, not by hand in BotFather). It is deliberately *not* an
inline button any more (ARG-94): a per-message "💬 Задать вопрос" row competed with the
buttons that actually belong to the current step. The command sets an ephemeral Redis flag
(`intakebot:await_q:{tg_id}`, distinct prefix from the access bot's `bot:await_q:*` —
separate service, separate Redis namespace) and takes priority over whatever the funnel
step would otherwise do with the applicant's next message. The old `svc_q` callback is
still handled so buttons in already-sent chats keep working.

The question forwarded to the admin chat includes the applicant's **currently chosen
tariff** in parens next to their tag (or «тариф ещё не выбран» before `choosing_plan`) —
useful context when several applicants are mid-funnel at once. `intakebot:qmap:{message_id}`
(Redis, 7-day TTL) stores this forwarded message's `{chat_id, text}` as JSON, not just a bare
chat id — when the admin replies, the bot edits *that same message* in place to append
«✅ Отвечено» instead of posting a separate confirmation, same edit-in-place pattern as the
funnel buttons above. Reads of the old bare-`chat_id` format (questions forwarded before
this changed) still deliver correctly, just without the in-place mark — no stored text to
edit into.

## Payment window (ARG-108)

A booking is held for **24 hours after the admin accepts the application** («Принять»),
not from the moment the payment details are revealed: the seat must not sit occupied while
someone takes a week to pick a tariff.

- `payment_deadline_at` is set in `_handle_accept` together with `status=choosing_plan`
  (and re-set on re-accepting an `expired` row). The window comes from
  `INTAKE_PAYMENT_WINDOW_HOURS` (default **24**, hardcoded — prod compose is untouchable;
  staging passes it through so a run can be forced to burn in minutes:
  `INTAKE_PAYMENT_WINDOW_HOURS=0.05`).
- The clock runs in `choosing_plan` / `awaiting_offer` / `awaiting_receipt`
  (`STATUSES_ON_PAYMENT_CLOCK`) and **freezes on `payment_review`**: the receipt is in, the
  ball is the admin's, and an applicant who paid at 23:59 must not burn because nobody was
  awake.
- **No reminders before the deadline** — deliberate. Instead the deadline is spelled out on
  two screens, worded differently depending on whether a tariff is chosen yet
  (`_with_deadline`, `TEXT_DEADLINE_NOTE_PLAN` on the tariff list vs
  `TEXT_DEADLINE_NOTE_PAYMENT` on the payment-details screen — «до 21:40 27 августа», МСК).
- Expiry is a **background sweep** (`_expire_sweep_loop`, every 60s, started by `main()`
  alongside the long-poll loop): an applicant who simply goes quiet never gives the bot a
  single update to react to. `_expire_overdue` marks the rows and commits **before**
  sending anything, so a failed commit cannot leave someone told their booking is gone
  while it is not.
- The same check also runs **synchronously** in every participant-facing handler
  (`_expired_guard` on the tariff/offer buttons, one check in `_handle_message` covering a
  late receipt). Without it, buttons stay live for up to a minute past the deadline.
- On expiry: `status=expired`, `expired_at` set, the applicant is told the price is no
  longer guaranteed (`TEXT_EXPIRED`). **The admin is deliberately not notified at this
  point** — most applicants who let the window lapse never come back, and pinging the admin
  for every one of them is just noise. The admin only hears about it if the applicant
  themselves comes back (see "Coming back" below).
- A tap on any stale funnel button of an expired application answers «Время на оплату
  истекло», not the usual «Этот шаг уже пройден».
- **Coming back**: `/start` on an `expired` application returns it to `submitted` with the
  original anketa (`_resubmit_after_expiry`) — the row is reused, `tg_id` stays unique — and
  the admin gets a «🔁 Повторная заявка» card. There is no self-service path straight back
  to the tariff list: a second chance goes through a human.
- `/confirm @username` still works on an expired application (the money arrived by another
  route) — `expired_at` just stays as a historical marker.

## Data model

`plans` (admin CRUD), `intake_applications` (funnel state; read-only admin API since
ARG-107, see below — mutating it is still bot-only), `users.plan_id` — see
[DATA_MODEL.md](DATA_MODEL.md). Booking columns: `payment_deadline_at`, `expired_at`.

`intake_applications.tg_id` is **unique**: one Telegram account = one application, ever.
`intake_applications.user_id → users.id` has **no `ON DELETE`**, so the account created at
`confirmed` cannot be deleted while its application still points at it. Whenever both go
away, the order is fixed: **application first, then the user** (see `/reset` below, and
`delete_user` in `app.api.admin`).

## Resetting a run (`/reset`, staging only)

Because `tg_id` is unique and the login is the applicant's `@username`, a Telegram account
can walk the funnel exactly once — the next `/start` resumes the stuck status, and even a
manual `DELETE` of the application leaves the login taken. `/reset` (ARG-95) removes both
so the same account can run the funnel again from scratch:

- Accepted **only** from the admin DM (`TELEGRAM_INTAKE_BOT_ADMIN_CHAT_ID`). `/reset`
  resets the admin's own application, `/reset @username` the named applicant's. Sent from
  anywhere else it does nothing and answers nothing.
- Gated by `INTAKE_BOT_ALLOW_RESET` (`1`/`true`/`yes`/`on`), set **only** in
  `docker/docker-compose.staging.yml`. Off by default and on prod: the command replies
  that reset is unavailable on this environment and touches no data.
- What it removes: the `intake_applications` row, then — if it had a `user_id` — the
  platform user via the admin `delete_user` (rooms, messages, media, task assignments are already handled
  there; a user owning shared content still blocks deletion and the admin is told why),
  then the applicant's ephemeral Redis keys (`intakebot:await_q:*`, `intakebot:pwd:*`).
  An application with no `user_id` (run never reached `confirmed`) is not an error.
- The admin gets back what was deleted: the application's status and the platform login,
  or an explicit "nothing to reset" when there is no such application.
- Deliberately **not** in `setMyCommands` — it is a service command, not a funnel step.
- Scope: one applicant at a time. No bulk "wipe the stand", no web/admin UI.

## Manual payment confirmation (`/confirm @username`)

Admin-only command (any environment, unlike `/reset`) for when the admin sees the payment
land some other way than a forwardable receipt (bank statement, Tribute payment from abroad
without a screenshot the applicant thinks to send) — the normal path (applicant sends a
receipt → «✅ Подтвердить оплату» button on it) never fires, and the funnel would otherwise
be stuck.

- Accepted only from `ADMIN_CHAT_ID`; requires a target — `/confirm @username`, no
  chat-implicit form (unlike `/reset`).
- Valid on any status once a tariff is chosen (`plan_id` set) and the application isn't
  already `confirmed` — typically `awaiting_offer`/`awaiting_receipt`/`payment_review`.
  No tariff chosen yet → refused with an explicit reply, nothing changed.
- Shares the same account-creation path as the `pay:` callback (`_finalize_payment`): same
  `_create_platform_user` call, same credentials message to the applicant, same welcome-task
  assignment. The admin-chat confirmation is worded differently — «...подтверждена
  **вручную (без чека)**...» — so the log/history makes clear the receipt was never
  eyeballed.
- Registered in `ADMIN_COMMANDS` (visible in the admin chat's own menu), unlike `/reset`.

## Web funnel dashboard (admin, ARG-107)

`GET /api/admin/applications` (`app/api/applications.py`, `require_admin`) is a **read-only**
CRM view of `intake_applications` for the `/admin/funnel` page — a kanban board, one column
per status, so the admin can see who is stuck without paging through the bot's DM. There is
no write path here: moving an application through the funnel is still only done from
Telegram (`✅ Принять`, `✅ Подтвердить оплату`, …), same as before this task.

Response shape: `{total, by_status: {<status>: count, ...all 8 keys always}, items: [...]}`
— all 8 including `expired` (ARG-108). Each item adds two backend-computed fields the
frontend must not try to derive itself: `stage_since` (timestamp the application entered
its *current* status) and `days_in_stage`.

Five nullable timestamp columns back `stage_since`, set by the bot right next to the
`status` assignment that causes them (`submitted_at`, `accepted_at`, `plan_chosen_at`,
`receipt_at`, `confirmed_at`). `awaiting_receipt` reuses the pre-existing
`offer_accepted_at` (ARG-43) instead of a new column — offer consent and entering that
status happen in the same handler; `expired` reuses ARG-108's `expired_at`. Historical
rows from before ARG-107 may have earlier timestamps as `NULL` (backfill only recovered
`confirmed_at`, exactly, and `submitted_at`, approximately — see the migration) — the API
and the UI both render that as "—", not as an error.

The receipt itself is never proxied to the browser (no `getFile` call): the API only
exposes `has_receipt`/`receipt_kind`. Checking the actual photo/PDF still means opening the
admin's Telegram DM.

## Bot status (`/info`)

Read-only admin command: which intake the bot will attach new users to, which plans it is
currently offering applicants, the payment card baked into `TEXT_ACCEPTED`, and the
payment window with the bookings currently ticking (up to 10, soonest deadline first).

- Accepted only from the admin DM, same as `/reset`; from anywhere else it does nothing.
- Reports the active intake (`intakes` row with the latest `starts_on` — same query the
  funnel itself uses when it creates a user) or a warning that there is none, the active
  (`is_active`) plans with their prices, or a warning that there are none, and the payment
  details string (`PAYMENT_DETAILS`) shared with `TEXT_ACCEPTED`.
- Registered via `setMyCommands` scoped to the admin chat only
  (`BotCommandScopeChat`/`ADMIN_COMMANDS`) — shows up as a tappable command in the admin's
  own chat menu without ever reaching `BOT_COMMANDS` (the global, participant-facing list).

## Placeholder texts

`bot_texts.md` keys (`start`, `ask_about`, `submitted`, `accepted`, `need_receipt`,
`receipt_got`, `confirmed`, `wait_decision`, `wait_payment_check`, `already_done`,
`need_start`) are used verbatim. Everything *not* in that file — tariff descriptions, the
service-mode menu, "ask a question"/"change password" prompts, admin-chat cards — is a
temporary placeholder; final copy is a separate follow-up.

## Transport & deployment

- Same transport as the access bot: HTTP Bot API + long-polling `getUpdates` over
  `TELEGRAM_PROXY` (RU hosting blocks Telegram IPs directly) — see ADR-029.
- **Own Telegram token** (`TELEGRAM_INTAKE_BOT_TOKEN`, distinct from `TELEGRAM_BOT_TOKEN`)
  → own `getUpdates` poller → does **not** conflict with the prod access bot. This is why,
  unlike the access bot, `intake-bot` **does run on staging**
  (`docker/docker-compose.staging.yml`) — the "no bot on staging" rule in
  [DEPLOY.md](DEPLOY.md) exists specifically to avoid a second poller on the *same* token.
- Admin chat (`TELEGRAM_INTAKE_BOT_ADMIN_CHAT_ID`) can be either the task author's personal
  DM or a group/supergroup — both are supported the same way, matched purely by `chat_id`
  (staging currently uses a personal DM, prod a supergroup with several admins). Obtained
  the standard way for a DM (message the bot `/start` from that account first, read the
  chat id from `docker logs`) or by adding the bot to the group and reading its chat id the
  same way. **Historical bug (found live, ARG — no admin reply ever got through in the prod
  group):** the update dispatcher only forwarded messages to the funnel handler when
  `chat.type == "private"`, so replies/`/reset`/`/info` typed into a group admin chat never
  even reached the code — no error anywhere, just silence. Fixed by `_should_handle_message`
  (dispatch also when `chat_id == ADMIN_CHAT_ID`, regardless of chat type).
- Env: `TELEGRAM_INTAKE_BOT_TOKEN`, `TELEGRAM_INTAKE_BOT_ADMIN_CHAT_ID`,
  `TELEGRAM_INTAKE_BOT_LOG_CHAT_ID` (optional — redirects `_log_action`'s "📋" echoes, e.g.
  password changes, to a different chat than `ADMIN_CHAT_ID`; falls back to `ADMIN_CHAT_ID`
  when unset, same as before this existed), `INTAKE_BOT_ALLOW_RESET` (staging only, see
  `/reset`), `INTAKE_PAYMENT_WINDOW_HOURS` (default 24, see «Payment window»),
  `TELEGRAM_PROXY` (shared with the access bot), `PLATFORM_URL` (shared — on
  staging this should point at `https://staging.argonautica-systems.ru`).
- Not part of blue-green, no `:8000` healthcheck (long-poller, not an HTTP server) — same
  pattern as `bot` and `transcode-worker`.

## Boundaries (ARG-92)

- No real payment provider — payment is still eyeballed from the receipt by the admin.
  Provider integration is a separate, later task (ARG-63/ARG-32).
- Staging-only account creation; the bot never provisions on prod.

## Offer consent (ARG-43)

- The offer text lives in git, not the DB — `frontend/src/features/oferta/content/oferta.md`,
  rendered by `OfertaScreen` at the SPA's one public route, `/oferta` (added in `App.tsx`
  ahead of `AuthGuard`; no API calls, no auth). It ships as-is; wording/legal review is a
  content decision, not an engineering one.
- The applicant reads it inside Telegram as a `web_app` inline button — no external link,
  no PDF.
- Consent is recorded on `intake_applications` (`offer_accepted_at`, `offer_version`)
  **before** the funnel reveals payment details — see step 4–5 above. There is no path from
  `choosing_plan` to `awaiting_receipt` that skips `awaiting_offer`.
