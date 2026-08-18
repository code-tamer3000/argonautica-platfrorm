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
awaiting_about → submitted → choosing_plan → awaiting_receipt → payment_review → confirmed
```

1. **`/start`** → bot asks the applicant to describe themselves in one message.
2. Reply → `status=submitted`; the anketa is forwarded to the admin DM with an **«Принять»**
   button.
3. Admin taps **«Принять»** → `status=choosing_plan`; bot shows tariffs as buttons, read
   from the `plans` table **at request time** (not hardcoded — an admin price edit applies
   immediately, no bot redeploy). **One button per tariff** («Вода — 12 000 ₽») opening a
   description screen: title, price, `plans.description`, and a single row of
   **«⬅️ Назад»** / **«✅ Перейти к оплате»**. List ⇄ description ⇄ back all happen in
   **one message** via `editMessageText` — the chat never fills with stale copies of the
   menu (ARG-94). If that message is gone (user deleted it), the bot silently falls back to
   sending a new one. A tap on a screen that is stale relative to `app.status` changes
   nothing and answers with an alert («Этот шаг уже пройден»).
4. Pick a tariff → `status=awaiting_receipt`; bot sends payment details (the `accepted`
   text with `{price}` substituted for the chosen tariff's price) and asks for a receipt.
5. Receipt (photo or PDF document) → `status=payment_review`; forwarded to the admin DM
   with a **«Подтвердить оплату»** button.
6. Admin taps **«Подтвердить оплату»** → bot creates the platform account **on this
   environment** (see `PLATFORM_URL` — on staging, the staging domain): login = the
   applicant's Telegram `@username`, one-time password (`must_change_password=true`),
   `intake_id` = the current active intake ([DATA_MODEL.md](DATA_MODEL.md) `intakes`),
   `plan_id` = the chosen tariff. Sends login/password + `PLATFORM_URL` to the applicant.
   `status=confirmed`, `intake_applications.user_id` set.
   - If the applicant has no Telegram `@username` at this point, account creation is
     refused (login = username, must exist) — the admin gets an alert and the applicant is
     asked to set one; nothing else in the funnel is blocked, retry the same button once
     they have.
7. In-between statuses show `wait_decision` / `wait_payment_check` (idle waiting on the
   *other* party) if the applicant sends something out of turn.

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

## Data model

`plans` (admin CRUD), `intake_applications` (funnel state, no admin API — internal to the
bot), `users.plan_id` — see [DATA_MODEL.md](DATA_MODEL.md).

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
- Admin chat = the task author's personal DM (`TELEGRAM_INTAKE_BOT_ADMIN_CHAT_ID`), not a
  group chat — obtained the standard way (message the bot `/start` from that account first,
  read the chat id from `docker logs`).
- Env: `TELEGRAM_INTAKE_BOT_TOKEN`, `TELEGRAM_INTAKE_BOT_ADMIN_CHAT_ID`, `TELEGRAM_PROXY`
  (shared with the access bot), `PLATFORM_URL` (shared — on staging this should point at
  `https://staging.argonautica-systems.ru`).
- Not part of blue-green, no `:8000` healthcheck (long-poller, not an HTTP server) — same
  pattern as `bot` and `transcode-worker`.

## Boundaries (ARG-92)

- No real payment provider — payment is still eyeballed from the receipt by the admin.
  Provider integration is a separate, later task (ARG-63/ARG-32).
- Staging-only account creation; the bot never provisions on prod.
- Legal/offer texts (ARG-43) are out of scope.
