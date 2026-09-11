# Междумирье

> Endpoints: `PATCH /api/admin/users/{id}` (trigger, via `plan_id`), `POST
> /api/admin/users/{id}/limbo` (explicit manual trigger, ARG-132), `GET/PATCH /api/auth/me`
> (`limbo_deadline_at`). Tables: `users` (`limbo_previous_plan_id`, `limbo_deadline_at`,
> `limbo_makeup_task_id`, `discipline_reset_at`), `tasks`/`task_assignments` (the auto-created
> makeup task), `plans.discipline_tracked` (which tariffs get discipline tracking at all).
> See [ROOMS.md](ROOMS.md) "Tariff change cleanup" and [TASKS.md](TASKS.md) "Isolation by
> intake and plan" for the plan-downgrade machinery this sits on top of.

A 5-day grace period for a participant downgraded from a **paid** tariff straight to the
cheapest one (`CHEAP_TARIFF_NAME`, currently "Наблюдатель"). Plain content-isolation rules
(ARG-96) would otherwise close off any common task tagged to the old tariff the moment
`plan_id` changes — Междумирье delays that specifically for tasks, for 5 days, and adds one
more thing to do: catch up the missed diary.

## Trigger

`services/limbo.py` `apply_plan_change`, called from `update_user` right after `plan_id` is
actually changed (alongside `resync_dm_memberships_after_plan_change` — same event, two
independent side effects). Enters Междумирье only when **all** of:
- the new `plan_id` resolves to the cheap tariff by name,
- the old `plan_id` was not null,
- the old `plan_id` was not already the cheap tariff.

So: paid → cheap triggers it. Cheap-from-day-one (never had a paid tariff) never triggers it,
and neither does a lateral move between two paid tariffs (e.g. Спецотряд → Игрок) — only
landing on the cheapest one, matching how the feature was scoped.

If the participant is **already** in Междумирье when a new `plan_id` PATCH lands (whatever the
target), the existing grace period is abandoned first — an admin acting again mid-window is
treated as a manual decision, not something to wait out. Междумирье is then re-entered fresh
only if that same PATCH also satisfies the trigger condition above.

### Explicit manual trigger (ARG-132)

`POST /api/admin/users/{id}/limbo` — a dedicated entry point, not just a side effect of
editing the tariff field. Resolves the cheap plan by name, 400s if the participant is already
on it (or has no plan at all — nothing to downgrade from), otherwise sets `plan_id` to it and
runs the exact same `apply_plan_change` + `resync_dm_memberships_after_plan_change` pair that
`PATCH /users/{id}` runs on a qualifying plan change. It also stamps `users.discipline_reset_at
= now()` so the "late submissions" counter (see [TASKS.md](TASKS.md) "Просрочка задачи как
метрика") starts a fresh cycle once the tariff is restored.

Surfaced in the admin Dynamics screen (`AdminDynamics.tsx`) as a «Отправить в Междумирье»
button, behind a confirm popup, shown only when the row's `limbo_eligible` (from
`GET /api/admin/dynamics`) is true: the participant's tariff has `plans.discipline_tracked =
true` **and** (≥3 overdue tasks **or** ≥5 missed diary days — `LIMBO_ELIGIBLE_OVERDUE_TASKS` /
`LIMBO_ELIGIBLE_OVERDUE_DIARY_DAYS` in `api/dynamics.py`). The threshold only gates the button's
visibility, not the endpoint itself — an admin can still call it on anyone eligible by the
underlying downgrade rule above; there's no server-side re-check of the diary/task counts.

## What changes while in it

- `users.limbo_previous_plan_id` — the tariff to restore to.
- `users.limbo_deadline_at` — `now + 5 days` at entry (`LIMBO_DAYS` in `services/limbo.py`).
- `users.limbo_makeup_task_id` — one auto-created `type='individual'` task, title "Опиши весь
  период последних дней" (`MAKEUP_TASK_TITLE`/`MAKEUP_TASK_BODY` in `services/limbo.py`),
  assigned to the participant, `deadline_at` = the same
  5-day deadline, created via the same calendar-sync (`sync_task_calendar_event`) and
  websocket fan-out (`fan_out_task_event`) as a normal admin-created task — just built directly
  in `services/limbo.py` rather than through `POST /api/tasks`, since this is a system action,
  not an admin filling out the create-task form.
- **Common tasks tagged to the old tariff stay reachable.** `_effective_plan_id` in
  `services/tasks.py` returns `limbo_previous_plan_id` instead of the current (already-cheap)
  `plan_id` for as long as `limbo_deadline_at` is set — used everywhere `_visible_common_where`/
  `assert_task_visible`'s common branch would otherwise check the live `plan_id` (list, detail,
  `compute_progress`, `attention_count`). This is scoped to **tasks only** — contacts, diaries,
  channels, KB stay governed by the live (already-cheap) `plan_id` throughout Междумирье; the
  feature was deliberately scoped narrow to what the participant needs to finish, not a full
  "pretend the downgrade didn't happen" mode.
- Everything else about being on the cheap tariff already applies immediately (ARG-114/117
  diary cuts, ARG-110 contact/dm rank cascade, dm resync) — Междумирье does not touch those.

## Resolving it

No scheduler exists anywhere in this codebase (checked — no cron/APScheduler/Celery beat/
systemd timer). Like the Dynamics 28-day window, the 5-day deadline is evaluated **lazily**:
`resolve_limbo` (`services/limbo.py`) runs on every authenticated request via
`get_current_active_user` (`api/deps.py`) — a single `limbo_deadline_at IS NULL` check for
everyone not in Междумирье, so the cost is negligible platform-wide.

Two outcomes, checked in this order:
1. **Requirements met → restored immediately**, not held until the deadline (the deadline is a
   cutoff, not a review date): the makeup task's own assignment is `submitted`/`accepted`, AND
   no common task tagged to `limbo_previous_plan_id` has an assignment still `assigned`/
   `returned` (or no assignment at all — an untouched tariff task counts as unfinished too).
   `plan_id` is set back to `limbo_previous_plan_id`, all three limbo columns clear, and
   `resync_dm_memberships_after_plan_change` runs again (dm chats that were closed by the
   original downgrade come back, same as any other tariff restoration).
2. **Deadline passed, requirements not met → Междумирье just ends.** The three limbo columns
   clear; `plan_id` is left as-is (already the cheap tariff — nothing to restore to). The
   makeup task and any leftover old-tariff tasks aren't deleted, they simply stop being
   reachable again the moment `_effective_plan_id` falls back to the live (cheap) `plan_id`.

Neither outcome is "instant" in the sense of firing the moment it becomes true server-side —
it fires on that participant's *next* request. In practice that's login, or any API call from
the PWA, so the lag is invisible to a normal session.

## Frontend

`UserOut.limbo_deadline_at` (via `GET/PATCH /api/auth/me`) gates `LimboPopup.tsx`
(`frontend/src/features/app`), rendered next to `WelcomePopup` in `AppShell.tsx` — same
component shape and dismiss mechanics as the welcome popup: a "don't show again" checkbox
persisted to `users.settings.limbo_popup_dismissed` via `PATCH /api/auth/me` (merge-pattern,
not a wholesale replace). The one difference from the welcome popup: `apply_plan_change`
(`services/limbo.py`) resets that flag to `false` every time a **new** Междумирье starts, so a
dismissal from a past grace period never silently suppresses a later one. Closing without the
checkbox only hides it for the current render (`closed` local state) — it reappears on the next
login/reload for as long as the grace period is still open and undismissed. No separate "return
to the old tariff" notification exists yet — the participant discovers it happened by the popup
disappearing (condition `limbo_deadline_at != null` no longer holds) and their tariff/roster
context updating on next load.
