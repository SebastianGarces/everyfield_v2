import assert from "node:assert/strict";
import { test } from "node:test";
import { setManualSignalSchema } from "./attestation-service";

// ----------------------------------------------------------------------------
// Validation contract for manual self-attestation (PE-005 / AC-PE-3).
//
// The DB upsert + dirty-mark are covered by integration testing against a live
// Postgres; these unit tests pin the input contract that gates every write.
// ----------------------------------------------------------------------------

test("accepts a boolean toggle attestation", () => {
  const result = setManualSignalSchema.safeParse({
    signalKey: "values_documented",
    value: true,
  });
  assert.equal(result.success, true);
  assert.deepEqual(result.success && result.data, {
    signalKey: "values_documented",
    value: true,
  });
});

test("accepts string and numeric attestation values", () => {
  assert.equal(
    setManualSignalSchema.safeParse({ signalKey: "k", value: "in_place" })
      .success,
    true
  );
  assert.equal(
    setManualSignalSchema.safeParse({ signalKey: "k", value: 3 }).success,
    true
  );
});

test("trims the signal key", () => {
  const result = setManualSignalSchema.safeParse({
    signalKey: "  systems_tested  ",
    value: false,
  });
  assert.equal(result.success && result.data.signalKey, "systems_tested");
});

test("rejects an empty signal key", () => {
  assert.equal(
    setManualSignalSchema.safeParse({ signalKey: "   ", value: true }).success,
    false
  );
});

test("rejects a signal key over 100 chars", () => {
  assert.equal(
    setManualSignalSchema.safeParse({ signalKey: "x".repeat(101), value: true })
      .success,
    false
  );
});

test("rejects a non-scalar value", () => {
  assert.equal(
    setManualSignalSchema.safeParse({
      signalKey: "k",
      value: { nested: true },
    }).success,
    false
  );
});
