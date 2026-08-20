import assert from "node:assert/strict";
import { test } from "node:test";

import { PG_UNIQUE_VIOLATION, isUniqueViolation } from "./errors";

// ----------------------------------------------------------------------------
// The canonical "the unique index just did its job" predicate.
//
// The shapes pinned here are the two the drivers actually produce: the raw
// Postgres error at the top, and the same error buried under Drizzle's
// wrapping as a `cause`. Both populate the `constraint` FIELD on the error the
// cause walk reaches, which is why matching on that field alone is enough —
// and why the old `message.includes(...)` fallback was pure attack surface
// (#323 WS1).
// ----------------------------------------------------------------------------

const CONSTRAINT = "users_email_unique";

test("a top-level unique violation naming the constraint matches", () => {
  assert.equal(
    isUniqueViolation(
      { code: PG_UNIQUE_VIOLATION, constraint: CONSTRAINT },
      CONSTRAINT
    ),
    true
  );
});

test("a crafted MESSAGE naming the constraint is not a match (#323 WS1)", () => {
  // The suppression vector this closed: the predicate used to accept
  // `message.includes(constraint)` as good as the field. Postgres writes the
  // offending VALUE into some 23505 messages, so a row carrying an index name
  // in a unique column turned SOMEBODY ELSE'S violation into "our index just
  // did its job" — and every caller of this predicate swallows that as a
  // benign race. For `tasks_meeting_evaluation_unique_idx` the cost is a
  // meeting finalized with zero follow-up tasks, permanently.
  assert.equal(
    isUniqueViolation(
      {
        code: PG_UNIQUE_VIOLATION,
        constraint: "some_other_idx",
        message: `duplicate key value violates unique constraint "some_other_idx": Key (name)=(${CONSTRAINT}) already exists.`,
      },
      CONSTRAINT
    ),
    false,
    "the constraint FIELD decides; error text is not evidence"
  );

  // Not even with no `constraint` field at all — an error that names the index
  // only in prose is one this predicate declines to classify.
  assert.equal(
    isUniqueViolation(
      {
        code: PG_UNIQUE_VIOLATION,
        message: `duplicate key value violates unique constraint "${CONSTRAINT}"`,
      },
      CONSTRAINT
    ),
    false
  );
});

test("a violation wrapped as a cause is still found", () => {
  const wrapped = new Error("Failed query", {
    cause: { code: PG_UNIQUE_VIOLATION, constraint: CONSTRAINT },
  });

  assert.equal(isUniqueViolation(wrapped, CONSTRAINT), true);
});

test("a violation on a DIFFERENT constraint does not match", () => {
  // Narrowness is the point: swallowing someone else's unique violation would
  // turn a real bug into a polite refusal.
  assert.equal(
    isUniqueViolation(
      { code: PG_UNIQUE_VIOLATION, constraint: "other_index" },
      CONSTRAINT
    ),
    false
  );
});

test("a non-unique-violation error never matches, whatever it mentions", () => {
  assert.equal(
    isUniqueViolation(
      { code: "23503", message: `fk mentions ${CONSTRAINT}` },
      CONSTRAINT
    ),
    false
  );
});

test("garbage shapes are refused, not crashed on", () => {
  for (const value of [null, undefined, "boom", 42, new Error("plain")]) {
    assert.equal(isUniqueViolation(value, CONSTRAINT), false, String(value));
  }
});

test("the cause walk is bounded — a cycle cannot hang it", () => {
  const cyclic: { cause?: unknown } = {};
  cyclic.cause = cyclic;

  assert.equal(isUniqueViolation(cyclic, CONSTRAINT), false);
});
