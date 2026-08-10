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

## The catalog has two entrances, and the standing one is a route (T-011/T-012)

**Source:** `src/app/(dashboard)/tasks/templates/page.tsx`, `src/app/(dashboard)/tasks/page.tsx`, `src/components/tasks/template-picker.tsx`, `src/app/(dashboard)/tasks/actions.ts`

The phase prompt is the *timely* entrance — one stage's checklists, offered at the moment the stage changes, gone once answered. `/tasks/templates` is the *standing* one: every phase, always reachable, linked from the `/tasks` header. A planter who declined the prompt, or who wants an earlier stage's list, has no other way in, so the prompt may never be the only door.

That route is also what makes `importTaskTemplateAction` legal where it lives. [`../invariants.md`](../invariants.md) → Authentication says a not-yet-wired write belongs in a sibling module with no `"use server"` directive; the action's auth shape was always right, but with the picker mounted nowhere it was still a POSTable endpoint no UI reached, and the first attempt at this track was rejected for exactly that. Unmounting the picker re-opens the finding — it does not merely lose a screen.

`/tasks/templates` is a **static segment beside `/tasks/[id]`**. Delete the directory and the URL does not 404; it resolves to a task whose id is the word "templates" and answers 500, which is why `template-picker.test.ts` asserts the route file renders the picker and the `/tasks` header links to it. Rendering the component in a test proves the markup, never that a browser can ask for it.

## A phase change prompts; it never creates (T-020)

**Source:** `src/lib/tasks/phase-prompt.ts`, `src/components/tasks/phase-template-prompt.tsx`, `src/lib/events/subscriptions.ts`, `src/lib/tasks/templates.ts`, `src/lib/tasks/import.ts`

`phase.changed` has a task-side handler, and the handler writes nothing. That is not an unfinished wire — it is the rule. A planter who advances a stage and finds twenty tasks they did not ask for stops trusting the list with the ones they did, so the stage change makes the stage's checklists *visible*, with their real dates already worked out, and the planter presses or does not. `handlePhaseChangedForTemplatePrompt` is registered precisely so the place a future author would add auto-creation already carries the argument against it; `phase-prompt-live.test.ts` asserts a phase change leaves the tasks table empty.

### The prompt is derived, the answer is stored

The **prompt** is still derived and always will be. `phase_transitions` already records durably, append-only, that a plant moved and when, and the catalog is code — so `buildPhaseTemplatePrompt(latestTransition, answeredTransitionId)` is a pure function, the prompt cannot go stale, cannot be half-written by a failed handler, and needed nothing back-filled for plants that moved before it shipped. What IS stored is the **answer**, and only the answer.

Four ways to get "prompt nothing", each a real case: no transition at all; a move that went nowhere (`toPhase === fromPhase`); the transition is already answered; the new phase has no templates. The last one is the guard for a phase the catalog has not caught up with — every phase 0–6 carries a template today.

A `kind = 'initial_declaration'` row is filtered out, for the reason [`../invariants.md`](../invariants.md) → Phase History gives: nobody moved anywhere. Prompting a planter mid-onboarding with a checklist import is the same surprise from the other direction.

A **backward** move still prompts. "Advance" is the oversight milestone's rule, because that one announces progress; a planter who moves 3 → 2 is doing phase-2 work and wants the phase-2 checklist.

The only non-derivable fact is "this planter already answered", and it lives in `phase_prompt_answers` — one row per transition, unique on `transition_id` (migration 0035). That key is what makes the prompt re-arm on its own: the next move is a different id with no row against it.

It shipped as an httpOnly **cookie** holding the answered transition's id, and that was ruled out on 2026-08-10 (PR #393). A cookie answers for a BROWSER: the same planter on a phone, in a private window, or after clearing cookies was prompted about the same transition, and accepting there imported a second full set of 22–26 tasks. The residual was written up around declining, which is the mild half — declining twice costs nothing, accepting twice costs a duplicated task list.

The cookie is still written and still read, as a fast path and nothing more. The asymmetry is what makes keeping it safe: a cookie can only ever *suppress* a prompt, never restore one, so a stale or forged value costs its owner their own prompt and cannot argue away the row. `getLatestPhaseTransition` reads both in one LEFT JOIN — the answer is a fact about that transition, and fetching it separately would let the plant move in between and pair a new transition with an old answer.

### Accepting is idempotent, and the claim goes first

This is the half a durable record does not give you for free. Reading "has this been answered?" and then importing is a SELECT-then-INSERT, which [`../invariants.md`](../invariants.md) → Transactions names as *not* a concurrency guard: two presses in the same millisecond both pass the read, and neon-http has no interactive transaction to hold instead.

So `acceptPhaseTemplatePrompt` **claims** the answer row — `ON CONFLICT (transition_id) DO NOTHING`, `.returning()` — and imports only if the claim came back with a row. The loser reports `already_answered`, which the caller treats as a success that created nothing: the transition IS answered, so the prompt comes down either way. The conflict target is the transition alone, matching the index, so a request supplying a different `churchId` for the same transition still loses.

**The claim is the first write, which inverts the usual marker-last rule on purpose.** Marker-last is for redo-safe steps; importing a checklist is not one — T-012 creates a second copy by design and says so. A marker written afterwards is written after the damage. Claiming first carries the opposite failure, and it is the smaller one: a crash between the claim and the first INSERT leaves a transition answered with no tasks, which is visible, and every checklist stays reachable at `/tasks/templates`. The service narrows it further — a claim whose import wrote **nothing** is released, so the prompt returns; a claim whose import got **part-way** is kept, because re-offering checklists already in the list is how a planter imports them twice.

Two orderings inside the accept matter and are easy to get wrong:

- The claim happens **after** the requested keys are filtered against the live prompt. Claiming first would let a forged POST naming only bogus keys spend the planter's one answer and leave them with no prompt and no tasks.
- The already-answered check happens **before** the prompt is built, not by reading the built prompt's `null`. `buildPhaseTemplatePrompt` returns `null` for four different reasons and the caller has to tell "answered" (a success, prompt comes down) from "nothing to offer" (leave it up).

The button is disabled while the request runs, which is the belt over these braces — it does not make the repeat harmless, it stops the planter watching a second request they have no reason to think is a no-op. `useFormStatus` needs a client component, so the two buttons live in `phase-template-prompt-controls.tsx` and the rest of the prompt stays a server component; the decision they render is the pure `phaseTemplatePromptControlState`, because `useFormStatus` reports `pending: false` under `renderToStaticMarkup` and could not otherwise be asserted.

The prompt also states the import policy now, in its own words rather than the catalog's: the two surfaces no longer behave the same. Importing from `/tasks/templates` again really does add a second copy; this prompt can be answered exactly once per stage change. Both halves are surprising on their own, so both are said.

### Dates come from the transition, not from the press

`acceptPhaseTemplatePrompt` hands `transition.createdAt` to the T-011 import path, so a planter who answers three days later gets the schedule they would have got by answering immediately. Counting from the press instead quietly punishes anyone who thought about it first, and it makes the dates the prompt *showed* different from the dates it *wrote*.

It also re-derives the prompt from the database and filters the request's template keys against it. The keys come from a browser, so a forged one can name a checklist from a stage this plant has never reached; re-deriving turns that into a no-op instead of a private import path around the picker. It closes the other window too — if the plant moved again between render and press, the answer applies to the *current* transition and is dated from it, which is the only answer still true.

### Two handlers on one event

`phase.changed` now carries the oversight milestone (N-025) and this prompt. The bus runs handlers through `Promise.allSettled`, so neither can cost the other its turn, and `subscriptions.test.ts` asserts both are registered — a single `bus.on` per event type would have replaced the first silently.
