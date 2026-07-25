import assert from "node:assert/strict";
import { test } from "node:test";
import { InsightNotFoundError, submitInsightFeedbackSchema } from "./service";

// ----------------------------------------------------------------------------
// Validation contract for insight feedback (PE-014 / AC-PE-10).
//
// The DB upsert + denormalization of (assessment, church, rubric version) and
// the (insight, user) uniqueness are covered by integration testing against a
// live Postgres; these unit tests pin the input contract + error surface.
// ----------------------------------------------------------------------------

const VALID_UUID = "11111111-1111-4111-8111-111111111111";

test("accepts a useful rating with no comment", () => {
  const result = submitInsightFeedbackSchema.safeParse({
    insightId: VALID_UUID,
    rating: "useful",
  });
  assert.equal(result.success, true);
});

test("accepts a not_useful rating with a comment", () => {
  const result = submitInsightFeedbackSchema.safeParse({
    insightId: VALID_UUID,
    rating: "not_useful",
    comment: "Did not match our context",
  });
  assert.equal(result.success, true);
});

test("rejects an unknown rating", () => {
  assert.equal(
    submitInsightFeedbackSchema.safeParse({
      insightId: VALID_UUID,
      rating: "meh",
    }).success,
    false
  );
});

test("rejects a non-uuid insight id", () => {
  assert.equal(
    submitInsightFeedbackSchema.safeParse({
      insightId: "not-a-uuid",
      rating: "useful",
    }).success,
    false
  );
});

test("rejects a comment over 2000 chars", () => {
  assert.equal(
    submitInsightFeedbackSchema.safeParse({
      insightId: VALID_UUID,
      rating: "useful",
      comment: "x".repeat(2001),
    }).success,
    false
  );
});

test("InsightNotFoundError is identifiable for church-scope rejection", () => {
  const err = new InsightNotFoundError();
  assert.ok(err instanceof InsightNotFoundError);
  assert.ok(err instanceof Error);
  assert.equal(err.name, "InsightNotFoundError");
});
