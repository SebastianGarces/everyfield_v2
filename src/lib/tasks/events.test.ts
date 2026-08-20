import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { test } from "node:test";

import { isUniqueViolation } from "@/db/errors";
import { sourceReader } from "@/lib/testing/source-span";

import type { FinalizedAttendee } from "@/lib/meetings/events";

import {
  TASKS_MEETING_EVALUATION_UNIQUE,
  followUpDueDate,
  followUpRecipients,
  handleMeetingAttendanceFinalized,
} from "./events";

// ----------------------------------------------------------------------------
// MEET-011 — two concurrent finalizes both pass the SELECT guard in
// `handleMeetingAttendanceFinalized`; the partial unique index
// `tasks_meeting_evaluation_unique_idx` is what actually stops the second one.
// The loser's INSERT is rejected as a whole (the evaluation row shares the
// statement with the follow-ups), and the handler treats exactly that error as
// an idempotent no-op.
//
// WHAT IS ASSERTED HERE CHANGED WITH #411, AND THE DELETION IS THE POINT. This
// file used to own a byte-identical copy of `isUniqueViolation` under the name
// `isDuplicateGenerationError`, with five tests over the cause chain, the
// message fallback and the -1 branches — a second implementation of a predicate
// `src/db/errors.ts` already owns, and a second suite proving the same walk.
// Both are gone. `src/db/errors.test.ts` proves the WALK; what is left here is
// the pair of facts that are this domain's own and that the shared predicate
// cannot check for itself:
//
//   1. the constant names the index the migration actually creates — the
//      predicate matches on that string, so a rename anywhere else turns a
//      caught race into a thrown finalize;
//   2. the catch in `handleMeetingAttendanceFinalized` reaches the SHARED
//      predicate with THAT constant, rather than a broadened `code === '23505'`
//      test that would swallow a genuine write failure.
// ----------------------------------------------------------------------------

const EVENTS_SOURCE = readFileSync(
  path.join(process.cwd(), "src/lib/tasks/events.ts"),
  "utf8"
);

const MIGRATION_SOURCE = readFileSync(
  path.join(process.cwd(), "src/db/migrations/0022_tense_hydra.sql"),
  "utf8"
);

test("the constant names the index the migration creates", () => {
  assert.ok(
    MIGRATION_SOURCE.includes(TASKS_MEETING_EVALUATION_UNIQUE),
    "the predicate matches on this exact string; a rename that misses one side " +
      "turns an expected race into a finalize that throws"
  );
});

test("the race is classified by the shared predicate, not a local copy", () => {
  // Anchored on the INSERT's opening, not its whole one-line form: the
  // statement gained a `.returning({ id: tasks.id })` when T-018 wired the
  // generated follow-ups into the notification queue, and the anchor throwing on
  // that move is the guard working (`memory/invariants.md` → Multi-Tenancy, on
  // why a moved anchor must throw rather than slice the empty string).
  const catchBlock = sourceReader(EVENTS_SOURCE, "events.ts").span(
    ".insert(tasks)",
    "throw error;"
  );

  assert.match(
    catchBlock,
    /isUniqueViolation\(\s*error,\s*TASKS_MEETING_EVALUATION_UNIQUE\s*\)/,
    "the one predicate in src/db/errors.ts decides this, with this index named"
  );

  assert.doesNotMatch(
    EVENTS_SOURCE,
    /23505/,
    "the SQLSTATE belongs to src/db/errors.ts; spelling it here is how the " +
      "second copy grew back"
  );
});

test("a violation of THIS index is the expected race outcome, and no other", () => {
  // One case each side of the line, through the shared predicate — the walk
  // itself is proven in src/db/errors.test.ts and is not re-proven here.
  const ours = Object.assign(
    new Error(
      `duplicate key value violates unique constraint "${TASKS_MEETING_EVALUATION_UNIQUE}"`
    ),
    { code: "23505", constraint: TASKS_MEETING_EVALUATION_UNIQUE }
  );

  assert.equal(isUniqueViolation(ours, TASKS_MEETING_EVALUATION_UNIQUE), true);

  const somebodyElses = Object.assign(
    new Error('duplicate key value violates unique constraint "tasks_pkey"'),
    { code: "23505", constraint: "tasks_pkey" }
  );

  assert.equal(
    isUniqueViolation(somebodyElses, TASKS_MEETING_EVALUATION_UNIQUE),
    false,
    "swallowing this would finalize a meeting whose tasks never landed"
  );
});

// ----------------------------------------------------------------------------
// VM-007 (#323 WS2) — who gets a follow-up, and when it is due.
//
// Both rules are pure functions of the register, so they are read here without
// a database. The end-to-end proof that the generated ROWS carry them is
// `scripts/g3-followup-generation.ts`, which runs the real finalize against a
// real database and reads the tasks back.
// ----------------------------------------------------------------------------

function attendee(
  personId: string,
  attendanceType: FinalizedAttendee["attendanceType"]
): FinalizedAttendee {
  return { personId, attendanceType };
}

test("a mixed register owes a follow-up to the first-timers alone", () => {
  const register = [
    attendee("ann", "first_time"),
    attendee("bob", "returning"),
    attendee("dee", "core_group"),
    attendee("cy", "first_time"),
    // A row written before `attendance_type` was derived: unknown, and unknown
    // is not first-time.
    attendee("eve", null),
  ];

  assert.deepEqual(followUpRecipients(register), ["ann", "cy"]);
});

test("a register with no first-timers owes no follow-ups at all", () => {
  assert.deepEqual(
    followUpRecipients([
      attendee("bob", "returning"),
      attendee("dee", "core_group"),
    ]),
    []
  );
});

test("the follow-up window is anchored to the MEETING day, not to the finalize", () => {
  // Sunday's meeting, finalized whenever: the task is due Tuesday either way.
  const meetingDay = new Date("2026-08-16T19:30:00.000Z");

  assert.equal(followUpDueDate(meetingDay), "2026-08-18");

  // The anchoring is the point of VM-007 AC 7: a planter who finalizes late
  // gets a task that is ALREADY DUE, because the window closed while the
  // register sat unfinished. Nothing about `now` can move this value.
  const lateFinalize = new Date("2026-08-20T14:00:00.000Z");
  assert.ok(
    followUpDueDate(meetingDay) < lateFinalize.toISOString().slice(0, 10),
    "a meeting finalized four days later is due before the finalize"
  );
});

test("the window is whole calendar days, so a late-evening meeting does not roll", () => {
  assert.equal(
    followUpDueDate(new Date("2026-08-16T23:59:00.000Z")),
    "2026-08-18"
  );
  assert.equal(
    followUpDueDate(new Date("2026-08-16T00:00:00.000Z")),
    "2026-08-18"
  );
});

test("a non-vision meeting generates nothing — and reaches no query to find out", async () => {
  // The type guard is the FIRST statement of the handler, so this resolves
  // without a database. That is what is being asserted: under `pnpm test:ci`
  // the DATABASE_URL is a placeholder that no query can reach, so a handler
  // that had started reading would reject here instead of resolving.
  for (const type of ["team_meeting", "orientation", "training"]) {
    await handleMeetingAttendanceFinalized("meeting-1", type, "church-1", [
      attendee("ann", "first_time"),
    ]);
  }
});
