import assert from "node:assert/strict";
import { test } from "node:test";

import {
  deltaFieldLabel,
  readBooleanSignals,
  readDelta,
  readinessMeta,
  severityMeta,
  slugToLabel,
  transitionDirectionLabel,
} from "./focus-presentation";

// ----------------------------------------------------------------------------
// readDelta — the stored what-changed delta (PE-016).
// ----------------------------------------------------------------------------

test("readDelta returns the persisted _delta from the stored snapshot", () => {
  const delta = {
    isFirstAssessment: false,
    changed: [
      {
        path: "coreGroup.committedCount",
        previous: 7,
        current: 10,
        delta: 3,
      },
    ],
  };

  const result = readDelta({ snapshotVersion: "1", _delta: delta });
  assert.deepEqual(result, delta);
});

test("readDelta returns null when no delta is present", () => {
  assert.equal(readDelta({ snapshotVersion: "1" }), null);
  assert.equal(readDelta(null), null);
  assert.equal(readDelta(undefined), null);
  assert.equal(readDelta("not an object"), null);
});

test("readDelta tolerates a present-but-undefined _delta", () => {
  assert.equal(readDelta({ _delta: undefined }), null);
});

// ----------------------------------------------------------------------------
// readBooleanSignals — manual self-attestations (PE-005).
// ----------------------------------------------------------------------------

test("readBooleanSignals keeps only boolean attestations, keyed by signal key", () => {
  const values = readBooleanSignals([
    { signalKey: "values_documented", value: true },
    { signalKey: "financial_base_established", value: false },
    { signalKey: "note", value: "free text is ignored" },
    { signalKey: "count", value: 3 },
  ]);

  assert.deepEqual(values, {
    values_documented: true,
    financial_base_established: false,
  });
});

test("readBooleanSignals returns an empty map for no signals", () => {
  assert.deepEqual(readBooleanSignals([]), {});
});

// ----------------------------------------------------------------------------
// Severity presentation (PE-009) — plain language, never a raw enum.
// ----------------------------------------------------------------------------

test("severityMeta maps every DB severity to a plain-language label + variant", () => {
  assert.equal(severityMeta("critical").badgeVariant, "destructive");
  assert.equal(severityMeta("high").badgeVariant, "destructive");
  assert.equal(severityMeta("medium").badgeVariant, "outline");
  assert.equal(severityMeta("low").badgeVariant, "secondary");
  assert.equal(severityMeta("info").label, "Going well");
});

// ----------------------------------------------------------------------------
// Readiness presentation (PE-015) — advisory only.
// ----------------------------------------------------------------------------

test("readinessMeta maps each readiness state to a label + variant", () => {
  assert.equal(readinessMeta("ready").badgeVariant, "secondary");
  assert.equal(readinessMeta("approaching").badgeVariant, "outline");
  assert.equal(readinessMeta("not_ready").badgeVariant, "destructive");
  assert.equal(readinessMeta("unknown").label, "Readiness unknown");
});

// ----------------------------------------------------------------------------
// What-changed field labels (PE-016).
// ----------------------------------------------------------------------------

test("deltaFieldLabel humanizes known paths and falls back to the raw path", () => {
  assert.equal(deltaFieldLabel("coreGroup.committedCount"), "Core group");
  assert.equal(deltaFieldLabel("launch.daysUntilLaunch"), "Days until launch");
  assert.equal(deltaFieldLabel("unknown.path"), "unknown.path");
});

// ----------------------------------------------------------------------------
// Transition direction labels (PE-001) — advance / regress / correct.
// ----------------------------------------------------------------------------

test("transitionDirectionLabel describes advance, jump, regress, and noop", () => {
  assert.equal(transitionDirectionLabel(1, 2), "advance to");
  assert.equal(transitionDirectionLabel(1, 4), "jump to");
  assert.equal(transitionDirectionLabel(3, 1), "move back to");
  assert.equal(transitionDirectionLabel(2, 2), "stay in");
});

// ----------------------------------------------------------------------------
// Wiki slug labels (PE-008).
// ----------------------------------------------------------------------------

test("slugToLabel produces a readable label from a slug", () => {
  assert.equal(slugToLabel("core-group"), "Core group");
  assert.equal(slugToLabel("phases/launch_team"), "Launch team");
  assert.equal(slugToLabel("vision"), "Vision");
});
