# Date & Time Rendering

Why and how, for the Date & Time Rendering rules in [`../invariants.md`](../invariants.md).

**Source:** `src/lib/datetime.ts`, `src/lib/validations/meetings.ts`

`getFullYear()/getMonth()/getDate()` is the runtime's calendar and is how a planter far enough east pressed "Today" and got tomorrow.

See [hierarchical-access.md](hierarchical-access.md) for the day-vs-instant countdown bug that `launches.target_date` produced.

## Calendar-day primitives: one module, and a named debt

`MS_PER_DAY`, `toCalendarDate(date)` and `addCalendarDays(from, days)` live in `datetime.ts`, which imports nothing and is client-safe by construction. They lived in `src/lib/tasks/recurrence.ts` until #411 — a `"use client"` component reaching into the tasks domain for a datetime primitive, and `24 * 60 * 60 * 1000` spelled five ways across four files.

**The debt list (#411 quality round 1):** ten non-test call sites still hand-spell `toISOString().split("T")[0]` / `.slice(0, 10)` — `src/lib/people/{assessments.ts×2,commitments.ts,export.ts}`, `src/lib/oversight/read.ts`, `src/lib/launch/outcome.ts`, `src/components/people/{assessment,interview,commitment}-form.tsx`, `src/components/phase-engine/milestone-timeline.tsx`. (`src/lib/launch/validation.ts` and `src/lib/validations/tasks.ts` are round-trip VALIDATORS, not writes — not in the debt.) Nothing differs today, because the primitive IS that expression — which is exactly why it drifts the moment the primitive is re-based off UTC. Route a call site whenever you touch its module; the rule becomes absolute when the list is empty. `src/lib/launch/countdown.ts` keeps its own `daysUntilTarget` — a separate ruling about a countdown, not a second copy of "which day is this".
