import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";

import { sourceReader } from "@/lib/testing/source-span";

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

// ---------------------------------------------------------------------------
// Atomicity — the attestation and the dirty mark are ONE batched transaction.
//
// AC-PE-3 is "the attestation feeds the NEXT assessment", and the dirty mark is
// the whole of what makes that true. Written as two awaits, a failure between
// them persisted the planter's answer with the plant unmarked, so nothing they
// could see changed until some unrelated material event happened to land.
//
// Source-shaped (the subject is a DB write), anchored on declarations through
// `sourceReader` so a moved anchor throws rather than widening the span.
// ---------------------------------------------------------------------------

test("upsertManualSignal batches the upsert with the dirty mark", () => {
  const source = readFileSync(
    join(process.cwd(), "src/lib/phase-engine/signals/attestation-service.ts"),
    "utf8"
  );
  const body = sourceReader(source, "signals/attestation-service.ts").span(
    "export async function upsertManualSignal(",
    "export async function listManualSignals("
  );

  assert.match(body, /await db\.batch\(\[/);
  assert.equal(/await db\.transaction\(/.test(body), false);
  const writes = body.match(/await db\s*\n?\s*\.(insert|update|delete)\b/g);
  assert.equal(
    writes,
    null,
    `every write belongs to the batch; found ${writes?.join(", ")}`
  );

  // ONE definition of what "dirty" is, spread rather than re-typed. The old
  // hand-written `{ lastMaterialEventAt: now }` silently dropped `updated_at`,
  // which is exactly the drift `plantDirtyColumns` exists to prevent.
  assert.match(body, /plantDirtyColumns\(now\)/);
  assert.equal(
    /lastMaterialEventAt:/.test(body),
    false,
    "the dirty columns are named once, in dirty-handler.ts"
  );
});
