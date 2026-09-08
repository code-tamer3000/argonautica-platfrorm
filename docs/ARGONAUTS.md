# Argonauts

> Endpoints: `/api/argonauts`. No new tables — composes `users`, `task_assignments`,
> `tasks`, `rooms` (see [DATA_MODEL.md](DATA_MODEL.md)).

Roster of the current participant's intake ("who else is on this expedition with
me", including the viewer themself), grouped into sections by tariff (admins
their own leading section, observers a trailing one), one tile
per person (photo, name, "N tasks done" when N>0), expanding to a profile page
with bio, task list, and a link to that person's diary. Composition-only endpoint
(no new business logic) in the style of `api/dashboard.py`.

The viewer's own tile (`ArgonautsScreen.tsx`, `Tile`) is rendered with
`cardClass({ accent: true })` — the same "asks for attention" gold-border variant
`Динамика` uses for its own record — so it's identifiable at a glance without a
separate badge (ARG-119).

A profile also opens from outside the roster: the message action menu in Rubka
(`useMessageMenu.tsx`) carries a "Посмотреть профиль" item that navigates to
`/argonauts/{sender_id}` for any message not authored by the viewer — hidden on
your own messages (opening your own profile from a message menu isn't a useful
affordance, even though `/argonauts/{myId}` now resolves fine). A sender outside
the viewer's roster (a different intake) hits the same "Участник не найден" empty
state the page already has for a direct link — the menu item does not pre-check
membership.

> **Observers** are *listed* in the roster but cannot *open* it: the whole
> `/api/argonauts` router is behind `require_participant` → 403 for
> `users.is_observer`, same as Tasks/Rubka/Calendar.
>
> **Holders of the cheapest tariff** (`CHEAP_TARIFF_NAME`, currently
> "Наблюдатель") cannot open the section either — `_deny_cheap_tariff`, a second
> router-level dependency next to `require_participant`, 403s them the same way.
> This is a *separate* group from `users.is_observer` (see "Roster composition"
> below): they are still *listed* as a tile in other participants' rosters
> (trailing "Наблюдатели" section, alongside flag-observers), they just can't
> open `/api/argonauts` themselves. Same asymmetry as diary access
> (`is_cheap_tariff` in [services/visibility.py](../backend/app/services/visibility.py)).

## Roster composition

`GET /api/argonauts` returns **every** user with `intake_id == current_user.intake_id`,
including the caller themself (ARG-119) — the tile is highlighted client-side (see
above), not filtered out server-side. Observers are included too, as one trailing
"Наблюдатели" section — and "observer" here is the union of two independent
groups:
- `users.is_observer` — the flag, set after 5 missed days (see AUTH.md/oferta);
- holders of the `OBSERVER_TARIFF_NAME` tariff (`api/argonauts.py`, currently
  "Наблюдатель") — a **purchased tariff row in `plans`**, unrelated to the flag.
  A user can hold this tariff from day one with `is_observer == False` the whole
  time; either condition alone puts them in the observer section. A user with no
  tariff at all (`plan_id IS NULL`) is a different, unrelated case and stays a
  regular participant ("Без тарифа").

Both `ArgonautOut` and `ArgonautDetailOut` carry `is_observer` — **not the DB
column**, but that union, computed in `_roster`; it is what the frontend groups
and what hides the task count on those tiles/profiles.

Admins ARE included (their own section, see below) but never carry a task count
— they have no assignments by construction, and the tile/detail hide the
"N задач" line entirely for `role == 'admin'` (and likewise for observers)
rather than show a permanent 0.

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

The server orders the roster in three blocks: **admins first**, then participants
by ascending tariff rank (`cohort_plan_ranks`/`user_rank`) then `display_name`
(exactly like `list_contacts`, ARG-110), then **observers last**. The frontend
does not recompute rank — it slices the already-ordered list into sections
wherever the section key changes, reusing `groupPreOrdered` from
[lib/planGroups.ts](../frontend/src/lib/planGroups.ts) (the same helper
`NewChatModal`/`NewGroupModal` use for the contact list, though the roster passes
its own key function, `argonautSectionKey` in `ArgonautsScreen.tsx`, instead of
the contact list's `contactPlanKey` — observers need their own key, since a
flag-observer may hold any tariff).

Section labels are whatever the admin named the tariffs for that intake, except
that the roster renders them as groups: "Админы" for the admin block,
"Наблюдатели" for the observer block, and "Игрок" → "Игроки" via `SECTION_LABELS`
in `ArgonautsScreen.tsx`. "Спецотряд"/"Око" already read as a group and are shown
verbatim; "Без тарифа" for participants with none. This is display-only — the
tariff names in `plans` are never rewritten (`CHEAP_TARIFF_NAME == "Наблюдатель"`
matching depends on them).

`tasks_done` on a tile is shown only when `> 0` and the person is neither an
admin nor an observer — a bare
"Выполнено 0 задач" on every fresh participant's tile read as noise, not signal.

## Tasks

`tasks_done` (tile) and `tasks` (detail page) count only **`common`-type tasks
already `accepted`/`submitted`**, gated by `_completed_common_where`
(`api/argonauts.py`) — **not** `_visible_common_where` (that one gates the Tasks
section itself, ARG-96, and still applies plan/intake to a task not yet done).
The completed-task gate keeps the intake half of ARG-96 unconditionally, but
drops the *plan* half for exactly two viewers: the card's own owner
(`TaskAssignment.user_id == current_user.id`) and any admin. A downgrade
shouldn't erase the owner's own view of work they already handed in, and an
admin — who typically holds no plan at all — needs the same unconditional
oversight they get everywhere else on the platform; without this a `plan_id
IS NULL` admin would fail every non-empty `task_plans` check and see *nobody's*
tariff-scoped completed tasks.

Consequence: a **third-party** participant looking at someone else's argonaut
page still can't see a task scoped to a tariff they don't hold — that part is
still intentional: leaking the *title* of a task a viewer isn't entitled to see
would be an IDOR, even on someone else's profile, completed or not. Only the
owner's own view and admin oversight are exempt.

`individual`/`pair`/`stream` tasks are never shown here — those are private
assignments (and, for `pair`, may carry the other participant's text), not
public expedition record.

Status shown:
- `tasks_done` = count of `TaskAssignment.status == 'accepted'`.
- `tasks` (detail) = `accepted` **and** `submitted` (awaiting review). `returned`
  (sent back for rework) and `assigned` (not yet touched) are excluded — neither
  reads as "here's what this person did".

Each row in `tasks` also carries `submission_text` — the target's **latest**
`TaskSubmission.body` for that assignment (`_latest_submission_bodies` in
`api/argonauts.py`, a batched max-`created_at` join, same "history kept, take the
newest" shape as `_expedition_feat` below). The frontend (`ArgonautDetail.tsx`,
`TaskRow`) expands it inline as an accordion on click — no navigation to
`/tasks/{task_id}` needed just to read one person's submission (ARG-119); the
route itself still works as a secondary "Открыть задачу" link, for the full task
card (other people's submissions, review history).

## Expedition feat

`expedition_feat` (detail page only) — the text of the target's **latest**
submission (any status: `assigned` obviously has none, but `submitted`/
`returned`/`accepted` all qualify — whatever they wrote last) to the task titled
exactly `EXPEDITION_FEAT_TASK_TITLE` (`api/argonauts.py`, currently "Освобождаем
оперативку" — a specific existing production task, not a newly-introduced
concept). Matched by **exact task title**, not a DB flag — nothing marks that
task as special, so renaming it on prod silently breaks this field.

On production this task is **`type='individual'`** (assigned per-user to every
participant at intake start), not `common` — this matters: `_completed_common_where`
(used by `tasks`/`tasks_done` above) hard-filters `Task.type == 'common'` and
would silently match nothing here, which is exactly the bug the first version of
this field shipped with (verified against prod DB — task id 35, 21 individual
assignments, zero rows matched the common-only query). `_expedition_feat`
does **not** reuse `_completed_common_where`; it matches by title plus an
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
and **`null` for an admin target unless `users.diary_public` is set** — a plain
admin's personal channel fails `diary_visible` (`owner.role == 'admin'` without
`diary_public`), so the link would 404/403 through `assert_room_access`; the
endpoint omits it rather than hand out a dead button. When `diary_public` is set
(see [ROOMS.md](ROOMS.md), [AUTH.md](AUTH.md)) the link is included — the target
is already same-intake by construction (`_roster`), matching `diary_visible`'s
other requirement. Opening a real one goes through the existing `/diaries/{roomId}`
route — access is re-checked there too, this endpoint grants no new room permission.

## Writing a message from a profile

The profile page (not the tile) carries `can_message: bool` — whether the
*current viewer* can DM this person, i.e. `current_user.role == 'admin' or
contact_visible(current_user, user, ranks)`, the exact same predicate that
`assert_peer_visible` runs on `POST /api/rooms` (ARG-110, rank cascade — see
[ROOMS.md](ROOMS.md)). This is a direct read of an existing rule, not new
business logic: a viewer's rank sees tariffs `<= their own` (Игрок → Игроки;
Спецотряд → Спецотряд + Игроки; Око → all); a non-navigator admin is only
message-able by the top-2 tariffs of the intake (`can_message_admin`); an
`is_navigator` admin is message-able by everyone; a viewer who is themself an
admin has no restriction.

`can_message` is deliberately **narrower** than roster membership — the roster
shows the whole intake (ARG-119), writing follows the ARG-110 rank cascade, same
as it always has for `/api/users/contacts`/`POST /api/rooms`. Seeing someone's
tile does not imply you can message them; this endpoint just tells the frontend
in advance so it doesn't render a button that would 403 on click.

`ArgonautDetail.tsx` shows a "Написать сообщение" button when `can_message` is
true, the profile isn't the viewer's own, and the viewer hasn't graduated
(`graduated_at` — a graduate loses write access to all of Rubka via
`assert_can_write`, so the button would open a DM with no working composer).
Clicking it calls the same `POST /api/rooms {type: 'dm', peer_id}` /
`useCreateRoom()` flow as `UserProfileModal.tsx` in Rubka (dedup by `dm_key` is
server-side, so a repeat click just reopens the existing room), then navigates
to `/chats/{room.id}` — no new endpoint.

## Detail 404 vs 403

`GET /api/argonauts/{user_id}` re-applies the same roster filter and returns
**404** (not 403) for anyone outside it — a foreign-intake user or a nonexistent
id are indistinguishable to the caller, so the response doesn't confirm whether
an id exists outside their own intake. (Admins and observers ARE in the roster,
so their ids resolve normally — see "Roster composition".)

## Frontend

`/argonauts` (grid, `ArgonautsScreen.tsx`) and `/argonauts/:userId` (profile,
`ArgonautDetail.tsx`) — second nav item, right after Главная (see
[FRONTEND.md](FRONTEND.md) `routes.tsx`). Gated by `access: { kind: 'rosterAccess'
}` (`RequireAccess.tsx`) — closed to both `is_observer` and `is_cheap_tariff`
(`AccessContext.canRoster`, mirrors the backend's two dependencies above); the nav
item itself disappears for both groups via the same `isRouteVisible` check
(`AppShell.tsx`). Falls back to `<ObserverBlocked/>` for observers (they get the
usual "materials only" placeholder) and a plain redirect to `/` for the cheap
tariff (no dedicated placeholder exists for that group). Also
`withCohortGate` (cohort-pending placeholder if `today < intake.starts_on`).
