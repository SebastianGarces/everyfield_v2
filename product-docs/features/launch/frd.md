# FRD — Launch (Launch Sunday)

> A launch is a first-class entity: one live launch per church, carrying a target date, a status, a
> readiness structure of milestones, and an outcome record. It is the thing the whole methodology
> counts down to, tracks readiness for, and records the outcome of.

> **Tracked on the board:** [Launch #271](https://github.com/SebastianGarces/everyfield_v2/issues/271) — open requirements are its sub-issues. Implementation status is not tracked in this file.

## Feature overview

Every church plant works toward one culminating event: Launch Sunday. The Launch feature gives
that event a home — a single live launch per church with a target date, a status lifecycle, a
readiness structure derived from the Launch Playbook, and an outcome record. It is the canonical
owner of the launch date — no other row holds a copy — the anchor of the pre-launch experience, and
the source of the outcome data the platform's intelligence layer needs for eventual launch-outcome
linkage.

## User-visible behavior

- The planter schedules the launch (sets the target date), postpones or moves it, and — when the
  day comes — records what happened. Every date change is journaled (who, when, old → new), and
  setting or changing the date emits the oversight milestone notification.
- Scheduling seeds a fixed set of readiness **milestones** from the Launch Playbook's priority
  areas (operations / set-up & tear-down; launch-team preparation; promotion). Each milestone
  expands into linked tasks (`launch_prep` category); milestone progress reflects its tasks.
- A dedicated **`/launch` page** carries the countdown, status, milestone progress with linked
  tasks, and outcome capture. The **dashboard** shows a compact countdown/status card linking to it.
- The outcome record: happened / postponed, attendance count, decisions/responses, notes, and a
  "capture the day" record — the Playbook's own charge that the day be recorded and remembered.
- Launch Sunday is **not** a meeting: no meeting row is created for the service.

## Screens and workflows

| Surface | Content |
|---|---|
| `/launch` | Countdown + status; schedule/postpone (journaled); milestones with linked-task progress; outcome capture once the date arrives |
| Dashboard card | Compact countdown/status, links to `/launch` |

Workflow: schedule (planning → scheduled, milestones seeded) → prepare (milestones/tasks
complete) → the day (record outcome: completed, or postponed → new target date, journaled).

## Functional requirements

| ID | Level | Requirement |
|---|---|---|
| LS-001 | Must | One live launch per church: target date, status (`planning` / `scheduled` / `completed` / `postponed`), outcome fields. The launch entity is the **only** owner of the launch date — the church row carries no `launch_date` column, and every consumer (phase-engine countdown, oversight health read, launch-date milestone notification, settings edit paths) reads from or writes through the launch. |
| LS-002 | Must | Date-change journal: every set/postpone/move records actor, timestamp, old → new. Setting or changing the date emits the oversight milestone event. |
| LS-003 | Must | Milestones: scheduling seeds the fixed Playbook-derived set (operations / launch-team prep / promotion); each milestone links tasks (`launch_prep`); milestone progress derives from its tasks. Custom planter-defined milestones are out of scope for alpha. |
| LS-004 | Must | `/launch` page: countdown, status, milestone + task progress, schedule/postpone actions, outcome capture. Nav-level entry. |
| LS-005 | Must | Dashboard countdown/status card linking to `/launch`. |
| LS-006 | Must | Outcome record on the launch: happened/postponed, attendance count, decisions/responses, notes, capture-the-day record. No meeting row is involved. |
| LS-007 | Must | Permissions: the planter schedules, postpones, and records the outcome (plant-level decisions, same rule as association consent); milestone/task completion follows normal task rules. |
| LS-008 | Must | Intelligence integration: launch facts (date, status, readiness progress, outcome) join the phase-engine fact snapshot; recording a completed launch is a material event. Completing a launch does **not** auto-advance `current_phase` — the engine stays advisory. |
| LS-009 | Should | Postponement flow keeps history legible: the journal distinguishes a reschedule from a postponement-after-scheduled. |

## Acceptance criteria

- A planter can schedule a launch; the launch row is created/updated, milestones are seeded, the
  dashboard card and `/launch` countdown reflect the date, and the oversight milestone
  notification fires. No code path reads a `launch_date` column on the church row; no such column
  exists.
- Changing the date journals the change and re-fires the milestone event; the countdown updates
  everywhere it is displayed.
- Milestone progress moves when its linked tasks complete; a milestone with no open tasks can be
  marked complete.
- On/after the target date the planter can record the outcome; a completed launch shows its
  outcome on `/launch`, and the fact snapshot for the plant includes launch status/outcome.
- A non-planter member cannot schedule, postpone, or record an outcome (server-side enforcement).
- The phase-engine countdown signal and the oversight health listing show the same launch date the
  `/launch` page shows — one source.

## Data entities (feature-owned)

- **launches** — one live row per church: target date, status, outcome fields (attendance,
  decisions, notes, capture-the-day), timestamps.
- **launch_milestones** — the seeded Playbook-derived milestone rows, each linkable to tasks.
- **launch date journal** — append-only history of date/status changes (actor, timestamp,
  old → new). May be its own table or a typed event stream; the implementing unit decides.

Schema detail belongs to the implementing unit.

## Integration points

- **Phase engine**: the countdown signal reads the launch entity; launch facts join the fact
  snapshot; completed launches are the substrate for eventual outcome linkage (PE-021).
- **Tasks**: milestones link `launch_prep` tasks; completion semantics are the task system's.
- **Notifications**: the launch-date milestone event fires from the launch entity's write path; no
  new notification categories.
- **Oversight**: the portfolio/health surfaces read the launch date from the entity. Richer launch
  progress for oversight is future scope.
- **Church settings**: any settings-screen edit of the launch date goes through the launch entity's
  action, never a bare column write.
- **Domain source**: milestone content derives from the Launch Playbook (`launch-playbook.md`) —
  referenced, not duplicated.

## Non-functional requirements

- Tenancy: all launch reads/writes scoped to the caller's church.
- The date has exactly one owner; no surface may cache or duplicate it in schema.
- Destructive/status-changing actions (postpone, record outcome) confirm before writing.

## Success metrics

- Every active alpha plant has a scheduled launch with seeded milestones.
- Outcome records exist for launches that happen — the PE-021 dataset starts accumulating.
- The launch story (countdown → readiness → outcome) is demonstrable end-to-end in the alpha demo
  path.

## Non-goals (alpha)

- Custom planter-defined milestones.
- Post-launch recurring services (Sunday service tracking, worship/volunteer scheduling) — parked
  to its own discovery: the Services question, the ChMS boundary, and the oversight-value thesis.
- Oversight-facing launch-progress surfaces beyond the existing date/countdown reads.
- Multi-launch history/attempt analytics (one live launch; the journal preserves the story).

## Open questions

None. The post-launch Services direction is deliberately parked as its own discovery, not an open
question of this FRD.
