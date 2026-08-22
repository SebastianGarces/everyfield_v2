// ============================================================================
// Tasks — the sentences that depend on the reader's seat (AS-020).
//
// Same shape and same reason as `src/lib/people/presentation.ts`: the harness
// has no DOM, so copy inside a `.tsx` is copy no test can read. The rule lives
// once, in `CAPABILITY_MATCHED_SUBTITLES` (`read-only-surfaces.test.ts`), which
// pins both branches below by equality and checks the page passes `tasks.write`
// in. This surface carries a second test of its own — `presentation.test.ts` —
// because its sentence makes a claim about the product that no string
// comparison can check.
//
// Keep it free of `@/db` and of anything a client component cannot import.
// ============================================================================

/**
 * The task list's subtitle, and the one page of the three #668 fixed where the
 * Member's sentence was a COPY DECISION rather than a translation.
 *
 * The old line was "Manage your tasks and follow-ups" for every seat. On
 * /people and /teams the non-holder simply holds nothing, so the honest sentence
 * describes the page. Here they hold something: `tasks.own` is SEATED
 * (`seat-rules.ts`), so a plant Member may complete and reopen A TASK ASSIGNED
 * TO THEM, and `mayActOnTaskRow` is the rule both the card and the server ask.
 * What they may not do is `tasks.write` — creating, assigning, editing,
 * deleting, importing a checklist — which is every control the page hides.
 *
 * SO "MANAGE YOUR TASKS" WAS HALF WRONG, NOT WHOLLY WRONG, and that is the trap
 * this sentence had to get out of. Two wrong answers were available:
 *
 *   * Leave it. "Your tasks" is partly true of a Member, so the line looks
 *     defensible — until you read the verb in front of it, which offers them
 *     the whole of `tasks.write`.
 *   * Describe the list and stop. That is the shape /people and /teams take,
 *     and here it would UNDER-claim: it tells a Member with three assigned
 *     tasks that this is a page to look at, when the complete control on each of
 *     their own rows is right there. An over-hide in sentence form is the same
 *     defect pointed the other way, and the sweep is not allowed to commit it
 *     either (`read-only-surfaces.ts`).
 *
 * WHICH LIST THE SENTENCE MAY NAME IS DECIDED BY THE DEFAULT VIEW, not by the
 * page's scope. `parseTaskListSearchParams` defaults `view` to `my_tasks`, so a
 * Member who opens /tasks is looking at their own rows and nothing else — a
 * draft reading "Your plant's tasks and follow-ups" described a list one toggle
 * away from the one on screen, which is the same species of false claim as the
 * verb it replaced. The toggle offers My Tasks and All Tasks, so the sentence
 * names both, in that order, and then the verb.
 *
 * Its second clause is an imperative on purpose: an instruction is honest
 * exactly when its reader may perform it, which is the same reason /meetings/new
 * keeps "Set a date, time, and location…" — the rule was never "no imperatives",
 * it is "no imperative for a write this reader would be refused".
 * `readsAsAnImperative` reads the FIRST word only, so a mid-sentence imperative
 * is invisible to it by design; do not widen the predicate to catch this one.
 *
 * "The ones assigned to you" may be an empty set, and the sentence survives it:
 * it states what this page lets them do, the way the writer's branch does on a
 * plant with no tasks at all.
 */
export function taskListSubtitle(canWrite: boolean): string {
  return canWrite
    ? "Manage your tasks and follow-ups"
    : "Your tasks and your plant's — complete the ones assigned to you";
}
