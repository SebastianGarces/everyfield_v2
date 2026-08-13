import assert from "node:assert/strict";
import { test } from "node:test";

import type { PlantInsight } from "@/db/schema";

import {
  attestationSignalKey,
  findSnapshotRowIndex,
  readSnapshotFact,
  resolveCitedFactSignals,
} from "./snapshot-fact";

// ----------------------------------------------------------------------------
// Reading a persisted snapshot BY PATH, when the path is untrusted input.
//
// The judge writes `plant_insights.cited_facts`, so a segment may be
// `constructor`, `valueOf`, `toString` or `__proto__` (memory/invariants.md →
// Phase Engine). The phrase vocabularies were made `Map`s for exactly that
// reason; the WALK that feeds them used `segment in record`, which answers for
// the prototype chain, so `coreGroup.constructor` resolved as `present: true`
// and the exit-criteria drill-down rendered a native function's slot as a
// verified reading of the plant's own snapshot.
//
// These tests pin the walk itself rather than one caller's symptom.
// ----------------------------------------------------------------------------

const SNAPSHOT = {
  coreGroup: { committedCount: 12, isEmpty: false },
  ministryRoles: {
    roles: [
      { key: "worship", filled: true },
      { key: "childrens", filled: false },
    ],
  },
  launch: { launchDate: null },
  manual: {
    byKey: { values_documented: true },
    attestations: [
      { signalKey: "values_documented", value: true, attestedAt: "2026-01-01" },
    ],
  },
};

const PROTOTYPE_SEGMENTS = [
  "constructor",
  "toString",
  "valueOf",
  "hasOwnProperty",
  "__proto__",
];

test("a real path resolves, with its scalar as a string", () => {
  assert.deepEqual(readSnapshotFact(SNAPSHOT, "coreGroup.committedCount"), {
    path: "coreGroup.committedCount",
    present: true,
    value: "12",
  });
});

test("a stored null is present with a null value — a real reading", () => {
  assert.deepEqual(readSnapshotFact(SNAPSHOT, "launch.launchDate"), {
    path: "launch.launchDate",
    present: true,
    value: null,
  });
});

test("an Object.prototype member is NOT a fact of the snapshot", () => {
  for (const segment of PROTOTYPE_SEGMENTS) {
    const fact = readSnapshotFact(SNAPSHOT, `coreGroup.${segment}`);
    assert.equal(
      fact.present,
      false,
      `coreGroup.${segment} must not resolve — the judge wrote that path`
    );
    assert.equal(fact.value, null);
  }
});

test("a prototype member at the ROOT of the snapshot does not resolve either", () => {
  for (const segment of PROTOTYPE_SEGMENTS) {
    assert.equal(readSnapshotFact(SNAPSHOT, segment).present, false);
  }
});

test("a prototype member cannot be walked THROUGH to reach a deeper path", () => {
  assert.equal(
    readSnapshotFact(SNAPSHOT, "coreGroup.constructor.name").present,
    false
  );
  assert.equal(
    readSnapshotFact(SNAPSHOT, "__proto__.coreGroup.committedCount").present,
    false
  );
});

test("bracketed and dotted indices reach the same row", () => {
  assert.equal(
    readSnapshotFact(SNAPSHOT, "ministryRoles.roles[0].filled").value,
    "true"
  );
  assert.equal(
    readSnapshotFact(SNAPSHOT, "ministryRoles.roles.1.filled").value,
    "false"
  );
});

test("findSnapshotRowIndex locates a row and refuses a missing one", () => {
  assert.equal(
    findSnapshotRowIndex(SNAPSHOT, "ministryRoles.roles", "key", "childrens"),
    1
  );
  assert.equal(
    findSnapshotRowIndex(SNAPSHOT, "ministryRoles.roles", "key", "prayer"),
    null
  );
  // The array itself is reached by the hardened walk, so a prototype path is
  // not an array either.
  assert.equal(
    findSnapshotRowIndex(SNAPSHOT, "ministryRoles.constructor", "key", "x"),
    null
  );
});

// ----------------------------------------------------------------------------
// Resolving a whole cited-facts column.
// ----------------------------------------------------------------------------

function insight(citedFacts: unknown): PlantInsight {
  return { id: "i1", citedFacts } as unknown as PlantInsight;
}

test("the array spelling of an attestation resolves to its signal", () => {
  assert.equal(
    attestationSignalKey("manual.attestations.0.value", SNAPSHOT),
    "values_documented"
  );
  assert.deepEqual(
    resolveCitedFactSignals(
      insight(["manual.attestations.0.value=true", "coreGroup.committedCount"]),
      SNAPSHOT
    ),
    { "manual.attestations.0.value": "values_documented" }
  );
});

test("an unresolvable attestation row contributes no entry", () => {
  assert.equal(
    attestationSignalKey("manual.attestations.9.value", SNAPSHOT),
    null
  );
  assert.equal(
    attestationSignalKey("manual.attestations.x.value", SNAPSHOT),
    null
  );
  assert.deepEqual(
    resolveCitedFactSignals(
      insight(["manual.attestations.9.value=true"]),
      SNAPSHOT
    ),
    {}
  );
});

test("a citation named after an Object.prototype member is not deduped away", () => {
  // `path in signals` answered true for `toString` before this map was read
  // with `Object.hasOwn`, so a citation the judge wrote was silently dropped
  // from the resolution pass.
  const signals = resolveCitedFactSignals(
    insight(["toString=x", "constructor=y", "manual.attestations.0.value"]),
    SNAPSHOT
  );
  assert.deepEqual(signals, {
    "manual.attestations.0.value": "values_documented",
  });
  assert.equal(Object.hasOwn(signals, "toString"), false);
});
