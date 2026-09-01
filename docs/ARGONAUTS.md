# Argonauts

> Endpoints: `/api/argonauts`. No new tables — composes `users`, `task_assignments`,
> `tasks`, `rooms` (see [DATA_MODEL.md](DATA_MODEL.md)).

Roster of the current participant's intake ("who else is on this expedition with
me"), grouped into sections by tariff (admins their own tail section), one tile
per person (photo, name, "N tasks done" when N>0), expanding to a profile page
with bio, task list, and a link to that person's diary. Composition-only endpoint
(no new business logic) in the style of `api/dashboard.py`.

> **Observers** (`users.is_observer`) have no access: the whole `/api/argonauts`
> router is behind `require_participant` → 403, same as Tasks/Rubka/Calendar.

## Roster composition

`GET /api/argonauts` returns every user with `intake_id == current_user.intake_id`,
**excluding** the caller themself and two independent groups:
- observers, `users.is_observer` — set after 5 missed days (see AUTH.md/oferta);
- holders of the `OBSERVER_TARIFF_NAME` tariff (`api/argonauts.py`, currently
  "Наблюдатель") — a **purchased tariff row in `plans`**, unrelated to the flag.
  A user can hold this tariff from day one with `is_observer == False` the whole
  time; either condition alone is enough to exclude them. A user with no tariff
  at all (`plan_id IS NULL`) is a different, unrelated case and stays in.

Admins ARE included (their own section, see below) but never carry a task count
— they have no assignments by construction, and the tile/detail hide the
"N задач" line entirely for `role == 'admin'` rather than show a permanent 0.

This follows the diary-visibility rule (ARG-112: `diary_visible` in
[services/visibility.py](../backend/app/services/visibility.py)) — **intake only**,
no tariff rank cascade (unlike `GET /api/users/contacts`, ARG-110). Reason: the
roster links straight to each person's diary, and "Все дневники" already shows
everyone in the intake regardless of tariff — a rank-cascaded roster would show
*fewer* people than the diary list it links into, which would read as a bug.

A caller with `intake_id IS NULL` (historical record without an intake) gets an
empty roster, not "everyone" — showing the whole platform to someone unassigned
is not what this section is for.

## Ordering and sections

The server sorts the roster exactly like `list_contacts` (ARG-110): participants
by ascending tariff rank (`cohort_plan_ranks`/`user_rank`), then `display_name`;
admins always last, as one tail block. The frontend does not recompute rank — it
slices the already-ordered list into sections wherever `role`/`plan_id` changes,
reusing `contactPlanKey`/`groupPreOrdered` from
[lib/planGroups.ts](../frontend/src/lib/planGroups.ts) (the same helper
`NewChatModal`/`NewGroupModal` use for the contact list). Section labels are
whatever the admin named the tariffs for that intake (typically Игрок/Спецотряд/
Око), "Без тарифа" for participants with none, and "Админ" for the admin block.

`tasks_done` on a tile is shown only when `> 0` and `role != 'admin'` — a bare
"Выполнено 0 задач" on every fresh participant's tile read as noise, not signal.

## Tasks

`tasks_done` (tile) and `tasks` (detail page) count only **`common`-type tasks
that are visible to the VIEWER**, not to the target user. This reuses
`_visible_common_where` from [services/tasks.py](../backend/app/services/tasks.py)
— the same double intake+plan filter that gates the Tasks section (ARG-96) —
built from `current_user`, not from the profile being viewed.

Consequence: two viewers looking at the same argonaut's page can see different
`tasks_done` counts, if a common task is scoped to a tariff one of them doesn't
hold. This is intentional — leaking the *title* of a task a viewer isn't entitled
to see would be an IDOR, even on someone else's profile.

`individual`/`pair`/`stream` tasks are never shown here — those are private
assignments (and, for `pair`, may carry the other participant's text), not
public expedition record.

Status shown:
- `tasks_done` = count of `TaskAssignment.status == 'accepted'`.
- `tasks` (detail) = `accepted` **and** `submitted` (awaiting review). `returned`
  (sent back for rework) and `assigned` (not yet touched) are excluded — neither
  reads as "here's what this person did".

## Expedition feat

`expedition_feat` (detail page only) — the text of the target's **latest**
submission (any status: `assigned` obviously has none, but `submitted`/
`returned`/`accepted` all qualify — whatever they wrote last) to the task titled
exactly `EXPEDITION_FEAT_TASK_TITLE` (`api/argonauts.py`, currently "Освобождаем
оперативку" — a specific existing production task, not a newly-introduced
concept). Matched by **exact task title**, not a DB flag — nothing marks that
task as special, so renaming it on prod silently breaks this field.

On production this task is **`type='individual'`** (assigned per-user to every
participant at intake start), not `common` — this matters: `_visible_common_where`
(used by `tasks`/`tasks_done` above) hard-filters `Task.type == 'common'` and
would silently match nothing here, which is exactly the bug the first version of
this field shipped with (verified against prod DB — task id 35, 21 individual
assignments, zero rows matched the common-only query). `_expedition_feat`
does **not** reuse `_visible_common_where`; it matches by title plus an
intake-label check (`Task.intake_id IS NULL OR Task.intake_id == current_user.intake_id`,
same "label not a gate" semantics documented on `Task.intake_id` for individual
tasks) — real access control comes from `user` already having passed through
`_roster` (same intake as the viewer), not from task-visibility rules that don't
apply to a per-user individual task in the first place.

`null` when no such task exists (most non-prod/test environments), it belongs to
a different intake, or the target never submitted to it.

### Editing your own feat

`ArgonautDetailOut` also carries `expedition_feat_task_id` and
`expedition_feat_status` (the caller's own assignment status: `assigned`/
`submitted`/`returned`/`accepted`, or `null`) — used only when viewing **your
own** profile (`ArgonautDetail.tsx` compares `useAuth().user.id` to the profile
id). On your own page these feed the existing `TaskComposer`
(`features/tasks/TaskComposer.tsx`, the same widget the Tasks section uses) so
you can submit/edit your answer right there, POSTing through the already-existing
`POST /api/tasks/{task_id}/submissions` — **no new write endpoint** was added for
this. `TaskComposer` gained an optional `onSubmitted` callback so the Argonaut
page can invalidate its own query (`argonautKey(userId)`, a different cache entry
than the Tasks section's) after a successful save; nothing else about the
component changed, `TaskDetail.tsx`'s usage is unaffected.

`expedition_feat_task_id` is `null` — hiding the composer entirely — whenever the
target user has no `task_assignments` row for this task at all (not just no
submission yet): `assert_task_visible` would 403 an individual-task submission
from someone with neither an assignment nor authorship, so exposing the composer
in that case would just be a guaranteed error, not a genuine edit affordance.

## Diary link

`diary_room_id` = the target's personal channel (`rooms.is_personal AND
rooms.created_by == user_id`), same lookup as `_personal_room_id` in
`api/dynamics.py`. `null` if the person has none yet (button hidden client-side),
and **always `null` for admins** — an admin's personal channel fails
`diary_visible` (`owner.role != 'admin'`), so the link would 404/403 through
`assert_room_access`; the endpoint omits it rather than hand out a dead button.
Opening a real one goes through the existing `/diaries/{roomId}` route — access
is re-checked there too, this endpoint grants no new room permission.

## Detail 404 vs 403

`GET /api/argonauts/{user_id}` re-applies the same roster filter and returns
**404** (not 403) for anyone outside it — a foreign-intake user, an observer, or
a nonexistent id are indistinguishable to the caller, so the response doesn't
confirm whether an id exists outside their own intake. (Admins ARE in the
roster now, so an admin id resolves normally — see "Roster composition".)

## Frontend

`/argonauts` (grid, `ArgonautsScreen.tsx`) and `/argonauts/:userId` (profile,
`ArgonautDetail.tsx`) — second nav item, right after Главная (see
[FRONTEND.md](FRONTEND.md) `routes.tsx`). Gated the same way as Рубка/Календарь:
`access: { kind: 'observerBlocked' }` + `withCohortGate` (cohort-pending
placeholder if `today < intake.starts_on`).
