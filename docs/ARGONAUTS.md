# Argonauts

> Endpoints: `/api/argonauts`. No new tables — composes `users`, `task_assignments`,
> `tasks`, `rooms` (see [DATA_MODEL.md](DATA_MODEL.md)).

Roster of the current participant's intake ("who else is on this expedition with
me"), one tile per person (photo, name, "N tasks done"), expanding to a profile
page with bio, task list, and a link to that person's diary. Composition-only
endpoint (no new business logic) in the style of `api/dashboard.py`.

> **Observers** (`users.is_observer`) have no access: the whole `/api/argonauts`
> router is behind `require_participant` → 403, same as Tasks/Rubka/Calendar.

## Roster composition

`GET /api/argonauts` returns every user with `intake_id == current_user.intake_id`,
**excluding**: the caller themself, observers (`is_observer`), and admins.

This follows the diary-visibility rule (ARG-112: `diary_visible` in
[services/visibility.py](../backend/app/services/visibility.py)) — **intake only**,
no tariff rank cascade (unlike `GET /api/users/contacts`, ARG-110). Reason: the
roster links straight to each person's diary, and "Все дневники" already shows
everyone in the intake regardless of tariff — a rank-cascaded roster would show
*fewer* people than the diary list it links into, which would read as a bug.

A caller with `intake_id IS NULL` (historical record without an intake) gets an
empty roster, not "everyone" — showing the whole platform to someone unassigned
is not what this section is for.

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

## Diary link

`diary_room_id` = the target's personal channel (`rooms.is_personal AND
rooms.created_by == user_id`), same lookup as `_personal_room_id` in
`api/dynamics.py`. `null` if the person has none yet (button hidden client-side).
Opening it goes through the existing `/diaries/{roomId}` route — access is
re-checked there by `assert_room_access`/`diary_visible`, this endpoint grants
no new room permission.

## Detail 404 vs 403

`GET /api/argonauts/{user_id}` re-applies the same roster filter and returns
**404** (not 403) for anyone outside it — a foreign-intake user, an observer, an
admin, or a nonexistent id are indistinguishable to the caller, so the response
doesn't confirm whether an id exists outside their own intake.

## Frontend

`/argonauts` (grid, `ArgonautsScreen.tsx`) and `/argonauts/:userId` (profile,
`ArgonautDetail.tsx`) — second nav item, right after Главная (see
[FRONTEND.md](FRONTEND.md) `routes.tsx`). Gated the same way as Рубка/Календарь:
`access: { kind: 'observerBlocked' }` + `withCohortGate` (cohort-pending
placeholder if `today < intake.starts_on`).
