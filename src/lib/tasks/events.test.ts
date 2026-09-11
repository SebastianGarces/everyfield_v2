import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { test } from "node:test";

import { sourceReader, stripComments } from "@/lib/testing/source-span";

import type { FinalizedAttendee } from "@/lib/meetings/events";

import {
  followUpDueDate,
  followUpRecipients,
  handleMeetingAttendanceFinalized,
} from "./events";

// ----------------------------------------------------------------------------
// MEET-011 / #521 — EVERY ROW THE GENERATION INSERT WRITES HAS AN ARBITER, AND
// EACH ARBITER IS SPELLED LIKE THE READ ABOVE IT.
//
// Two concurrent finalizes both pass the SELECT guards in
// `handleMeetingAttendanceFinalized`; only a partial unique index can tell them
// apart. There are two, one per kind of row the handler writes, and the pair is
// what lets the INSERT be per-row idempotent rather than all-or-nothing:
//
//   `tasks_meeting_evaluation_unique_idx`  (church_id, related_id)
//   `tasks_person_follow_up_unique_idx`    (church_id, related_id, due_date)
//
// WHAT THESE TESTS PIN, AND WHY IT IS NOT THE INDEX NAME. Until #521 this file
// asserted that an exported constant named the index the migration creates, and
// that the handler's catch reached `isUniqueViolation` with that constant.
// There is no catch left: the INSERT carries an untargeted
// `ON CONFLICT DO NOTHING`, so no name is matched on and the constant is gone
// (`src/db/errors.test.ts` still proves the shared predicate's walk, for the
// domains that do recognise a violation).
//
// What replaces it is the property the two residuals were both instances of: AN
// INDEX PREDICATE WIDER THAN THE READ IT GUARDS IS A SUPPRESSION VECTOR. The
// evaluation index named the completion event and the soft-delete while the
// guard also demanded `related_type = 'meeting'`, so a row with that event, a
// meeting's id and `related_type = 'person'` held the slot INVISIBLY: the real
// INSERT failed 23505, was read as a benign lost race, and the meeting
// finalized with no tasks, permanently (#323 WS1, from #162). So each predicate
// is asserted clause for clause against the SELECT it stands behind.
//
// The live half — that a real Postgres enforces this, and that the crafted row
// no longer steals the slot — is `follow-up-race.test.ts`.
// ----------------------------------------------------------------------------

const EVENTS_SOURCE = readFileSync(
  path.join(process.cwd(), "src/lib/tasks/events.ts"),
  "utf8"
);

const SCHEMA_SOURCE = readFileSync(
  path.join(process.cwd(), "src/db/schema/tasks.ts"),
  "utf8"
);

/**
 * One index declaration, cut out between its own opener and the NEXT one.
 *
 * `span` resolves both anchors against the whole file, so the closing anchor has
 * to be text that occurs once and later — the following declaration, never a
 * `"),"` that first appears three hundred lines up (`source-span.ts`, on why a
 * mis-anchored span is a test about nothing). Reordering the declarations
 * therefore throws here rather than quietly asserting against a neighbour.
 */
function indexPredicate(from: string, to: string): string {
  return sourceReader(SCHEMA_SOURCE, "schema/tasks.ts").span(
    `uniqueIndex("${from}")`,
    `uniqueIndex("${to}")`
  );
}

test("the evaluation index names every clause its guard reads", () => {
  const predicate = indexPredicate(
    "tasks_meeting_evaluation_unique_idx",
    "tasks_person_follow_up_unique_idx"
  );

  for (const clause of [
    "completionEvent} = 'meeting.evaluation.completed'",
    "relatedType} = 'meeting'",
    "deletedAt} is null",
  ]) {
    assert.ok(
      predicate.includes(clause),
      `#323 WS1: the guard reads ${clause} and an index that does not is a slot a row can hold unseen`
    );
  }

  assert.ok(
    predicate.includes("table.churchId, table.relatedId"),
    "one live evaluation task per (church, meeting)"
  );
});

test("the follow-up index is keyed on the tuple that identifies a meeting's follow-up", () => {
  const predicate = indexPredicate(
    "tasks_person_follow_up_unique_idx",
    "tasks_id_church_id_unique_idx"
  );

  assert.ok(
    predicate.includes("table.churchId, table.relatedId, table.dueDate"),
    "a follow-up row names no meeting, so the meeting-derived due day IS its identity"
  );

  for (const clause of [
    "category} = 'follow_up'",
    "relatedType} = 'person'",
    "deletedAt} is null",
  ]) {
    assert.ok(
      predicate.includes(clause),
      `the reconcile read filters on ${clause}; the index must too`
    );
  }
});

test("the generation INSERT is per-row idempotent, not all-or-nothing", () => {
  // The shared boundary owns the physical INSERT now; this call-site option
  // is what preserves meeting generation's two partial-index arbiters.
  const insert = sourceReader(EVENTS_SOURCE, "events.ts").span(
    "insertExactTenantTasks(tasksToCreate",
    "await syncTaskNotificationsFor("
  );

  assert.match(
    insert,
    /onConflictDoNothing:\s*true/,
    "#521: with both kinds of row guarded, a raced top-up must skip the row somebody else wrote and land the rest — aborting the statement drops a late-added first-timer"
  );

  // Comments stripped: the docblock explains the untargeted choice by naming
  // the SQLSTATE, and a module that documents what it forbids fails its own
  // `doesNotMatch` otherwise.
  assert.doesNotMatch(
    stripComments(EVENTS_SOURCE),
    /23505|isUniqueViolation/,
    "no conflict reaches the application any more, so a catch that classified one is dead code"
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
