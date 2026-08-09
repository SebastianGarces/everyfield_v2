# Tasks, Subtasks & Recurrence

Why and how, for the Tasks rules in [`../invariants.md`](../invariants.md). Two features that look separate and are not: **subtasks** (T-016) give a task a checklist, **recurrence** (T-017) mints the next instance when you complete the current one — and the interesting rules are all about where the two meet.

**Source:** `src/lib/tasks/service.ts`, `src/lib/tasks/recurrence.ts`, `src/lib/tasks/types.ts`, `src/components/tasks/subtask-list.tsx`, `src/app/(dashboard)/tasks/page.tsx`, `src/app/(dashboard)/tasks/actions.ts`

## Nesting is one level, refused in both directions

`tasks.parent_task_id` is a self-FK, so the database will accept a chain of any depth. One level is an application rule and `checkSubtaskNesting()` is where it lives. It refuses four things, and each matters on its own:

- a subtask being given children (`SUBTASK_DEPTH_ERROR`)
- a task that already has children being demoted into a subtask (`SUBTASK_HAS_CHILDREN_ERROR`)
- a task parenting itself (`SUBTASK_SELF_ERROR`)
- a parent that is not in scope, which is how a cross-tenant or soft-deleted parent id arrives (`SUBTASK_PARENT_MISSING_ERROR`)

The second is the one that is easy to leave out and fatal to leave out. "Give B to A" refused but "give A to B" allowed builds the identical two-level tree. Both create and update run `assertSubtaskNesting()`; only update can trip the has-children arm.

The check is pure and the loader is church-scoped, which is what makes tenancy fall out of it: a parent id from another church loads as nothing and reads as *missing*, never as an un-parented task.

## Ticking the last box does not finish the task

There is deliberately no code path from "every subtask complete" to "parent complete". That is the ruling on #90: *every item is ticked* and *this work is finished* are different claims, and only the planter can make the second. `setSubtaskCompletionAction` never touches the parent row.

When the list is fully ticked `SubtaskList` says so and points at the Complete button rather than pressing it. If you are reading the absence as an oversight and preparing to "fix" it — this paragraph is the fix.

## A subtask is a checklist item, not a task (#370)

This one shipped broken and was ruled. `listTasks` filtered subtasks out of the list; `getTaskCounts` did not. On `/tasks?view=all&includeCompleted=true` the header read "1 active / 3 completed" directly above "Showing 1 of 1 tasks", with no completed rows rendered at all. The default `my_tasks` view hid it by accident, because subtasks then inherited no assignee and the assignee filter dropped them.

The ruling: **the badges mirror the list.** `topLevelTasksOnly()` is one exported condition and both builders apply it — `taskListConditions()` and `taskCountConditions()`. `subtasks.test.ts` renders both through `PgDialect` and asserts the emitted SQL, so the two cannot drift apart again without a test failing.

`listTasks` keeps an `includeSubtasks` escape hatch for callers that genuinely want the rows. `getTaskCounts` deliberately has none: a badge reading "3 completed" means three tasks in every view, with no option that changes it.

Checklist work is still real work, so it is still reported — as `checklistComplete` / `checklistTotal` on `TaskCounts`, rendered on their own quiet line under the badges and only when `checklistTotal > 0`. Kept apart rather than folded into `complete`, because two adjacent numbers over one list get read as one population, which is the bug this replaced.

Those two counts are scoped by the subtask's **parent**, not by the subtask's own assignee: the question the line answers is "how much checklist work sits inside the tasks I am looking at", so an item follows the task it itemises into or out of view.

## A subtask inherits its parent's assignee (#370)

Subtasks were originally created with no assignee at all, which made them invisible — no "My tasks" view, no assignee filter, nobody accountable. `resolveSubtaskAssignee()` now defaults a new subtask to the parent's assignee.

A **default**, not a lock: an explicit assignee on the form wins, the subtask is reassignable afterwards like any other task, and a parent with no assignee still yields a subtask with no assignee. Inheritance, not invention.

## The checklist is part of a recurring task's template (#370)

Completing a recurring task mints the successor **with the whole checklist**, every box unticked — the ticked items and the ones nobody got to, under one rule. `planRecurrenceChildren()` is the pure half; `createNextRecurrence` calls it after the successor row exists.

The alternative that was rejected: carry open items forward as open and ticked items forward as fresh. That needs a per-item "was this ever done" state, and it makes a weekly list that was half-finished once behave differently from an identical list that was finished. A repeating task repeats whole. The Repeat helper text on the task form states this — if the rule changes, that copy is part of the change.

Two details that are not obvious from the code:

- **Order is stamped, not defaulted.** `listSubtasks` sorts by `created_at`, and a single multi-row INSERT stamps every default with the same transaction timestamp, which would leave the checklist order to an `asc(id)` tiebreak over random UUIDs. `planRecurrenceChildren` sets `created_at` one millisecond apart per item.
- **An item's own due date is dropped.** It belonged to the cycle that just closed. Carrying it would hand the new checklist a set of already-overdue items; the parent carries the schedule.

Copying the checklist is wrapped in its own `try`/`catch`. The successor row already exists at that point, so a failure logs and still returns the successor — a checklist that has to be retyped is a smaller loss than a completion that looks like it did not happen.

## One open instance per series, minted on completion

There is no cron. The next instance exists because you completed the previous one, which is what stops a repeating task piling up while a planter is away.

`seriesIdOf()` reads `recurrence_rule ->> 'seriesId'`, falling back to the task's own id for the head of a chain. `findOpenInSeries` runs **before** the successor insert, so a series resurrected by reopening and re-completing an older instance gains neither a second open task nor a duplicate checklist. `updateTask` carries the stored `seriesId` across a schedule edit, so editing an instance mid-chain does not orphan it.

Known gap, carried as a follow-up rather than fixed here: the guard is a SELECT-then-INSERT, which [`../invariants.md`](../invariants.md) → Transactions names as *not* a concurrency guard. It is safe for two racers on the same task — `completeTask` is a real compare-and-set and everything downstream hangs off its rowcount — but not for two open instances of one series completed concurrently. The honest fix is a partial unique index on the series key for open rows.

## What a successor does and does not carry

Carried: title, description, priority, `due_time`, assignee, category, `related_type`/`related_id`, `parent_task_id`, the recurrence rule, and the checklist. Only the schedule moves — `dueDate` advances from the previous **due date**, not from the completion day, so completing late does not drift the weekday.

Not carried: `completionEvent`. An auto-completion hook is installed by whatever generated the task (a meeting finalize, say), and one of them — `meeting.evaluation.completed` — is backed by a partial unique index on `(church_id, related_id)`. Copying it aborts the second instance's insert. Recurrence mints plain work; hooks stay with the generator.

## Completion is written before its successor

The reverse of the usual "durable marker last" rule, and deliberate, because the two failure modes are not symmetric. A successor with no completion leaves **two** open instances of one series, breaking the guarantee a planter relies on. A completion with no successor leaves a gap that reopening and re-completing repairs. We take the recoverable one, and `completeTask` swallows a recurrence failure rather than telling the planter their completed task failed to complete.
