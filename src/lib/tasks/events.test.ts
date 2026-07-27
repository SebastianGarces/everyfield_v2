import assert from "node:assert/strict";
import { test } from "node:test";

import {
  isDuplicateGenerationError,
  MEETING_EVALUATION_UNIQUE_INDEX,
} from "./events";

// ----------------------------------------------------------------------------
// MEET-011 — two concurrent finalizes both pass the SELECT guard in
// `handleMeetingAttendanceFinalized`; the partial unique index
// `tasks_meeting_evaluation_unique_idx` is what actually stops the second one.
// The loser's INSERT is rejected as a whole (the evaluation row shares the
// statement with the follow-ups), and the handler treats exactly that error as
// an idempotent no-op.
//
// These tests pin the classification, which is the part that can silently rot:
// too broad and a genuine write failure gets swallowed and the meeting is
// marked finalized with no tasks; too narrow and a normal race becomes a
// user-visible "we couldn't create the follow-up tasks".
// ----------------------------------------------------------------------------

/** Shaped like the NeonDbError the driver raises for a unique violation. */
function uniqueViolation(constraint: string) {
  return Object.assign(
    new Error(`duplicate key value violates unique constraint "${constraint}"`),
    { code: "23505", constraint }
  );
}

test("a unique violation on the evaluation index is the expected race outcome", () => {
  assert.equal(
    isDuplicateGenerationError(
      uniqueViolation(MEETING_EVALUATION_UNIQUE_INDEX)
    ),
    true
  );
});

test("it is found through the wrapper Drizzle puts around driver errors", () => {
  const wrapped = Object.assign(new Error("Failed query: insert into tasks"), {
    cause: uniqueViolation(MEETING_EVALUATION_UNIQUE_INDEX),
  });

  assert.equal(isDuplicateGenerationError(wrapped), true);
});

test("it is recognised from the message when the driver omits `constraint`", () => {
  const bare = Object.assign(
    new Error(
      `duplicate key value violates unique constraint "${MEETING_EVALUATION_UNIQUE_INDEX}"`
    ),
    { code: "23505" }
  );

  assert.equal(isDuplicateGenerationError(bare), true);
});

test("a unique violation on some OTHER constraint still propagates", () => {
  assert.equal(
    isDuplicateGenerationError(uniqueViolation("tasks_pkey")),
    false,
    "swallowing this would finalize a meeting whose tasks never landed"
  );
});

test("an ordinary write failure is not mistaken for a race", () => {
  const failures: unknown[] = [
    new Error("connection terminated unexpectedly"),
    Object.assign(new Error("null value in column violates not-null"), {
      code: "23502",
    }),
    "some string nobody should be throwing",
    null,
    undefined,
  ];

  for (const failure of failures) {
    assert.equal(
      isDuplicateGenerationError(failure),
      false,
      `expected ${String(failure)} to propagate`
    );
  }
});

test("a self-referential cause chain terminates", () => {
  const looping: { message: string; cause?: unknown } = { message: "boom" };
  looping.cause = looping;

  assert.equal(isDuplicateGenerationError(looping), false);
});
