import assert from "node:assert/strict";
import { test } from "node:test";

import {
  buildTransitionRow,
  classifyTransition,
  deriveReadiness,
  MAX_PHASE,
  MIN_PHASE,
  transitionPhaseSchema,
} from "./service";
import type { PlantFactSnapshot } from "@/lib/phase-engine/signals";

// ----------------------------------------------------------------------------
// Pure-logic unit tests for the phase transition service (PE-001/002/003/015).
//
// The DB writes (immutable phase_transitions row, churches.current_phase update)
// and `phase.changed` emission are exercised by integration testing against a
// live Postgres + event bus; these unit tests pin the pure contracts: the
// validation surface, direction classification, the audit-row builder, and
// readiness derivation.
// ----------------------------------------------------------------------------

// ============================================================================
// Validation (PE-001 soft-gating: only a valid phase + a non-empty reason)
// ============================================================================

test("accepts a forward transition with a reason", () => {
  const result = transitionPhaseSchema.safeParse({
    toPhase: 2,
    reason: "Ready",
  });
  assert.equal(result.success, true);
});

test("accepts a backward transition (correction) with a reason", () => {
  const result = transitionPhaseSchema.safeParse({
    toPhase: 0,
    reason: "Logged the wrong phase last week",
  });
  assert.equal(result.success, true);
});

test("requires a non-empty reason", () => {
  assert.equal(
    transitionPhaseSchema.safeParse({ toPhase: 1, reason: "" }).success,
    false
  );
  assert.equal(
    transitionPhaseSchema.safeParse({ toPhase: 1, reason: "   " }).success,
    false
  );
});

test("rejects out-of-range phases", () => {
  assert.equal(
    transitionPhaseSchema.safeParse({ toPhase: MIN_PHASE - 1, reason: "x" })
      .success,
    false
  );
  assert.equal(
    transitionPhaseSchema.safeParse({ toPhase: MAX_PHASE + 1, reason: "x" })
      .success,
    false
  );
});

test("rejects a non-integer phase", () => {
  assert.equal(
    transitionPhaseSchema.safeParse({ toPhase: 1.5, reason: "x" }).success,
    false
  );
});

test("trims the reason", () => {
  const result = transitionPhaseSchema.safeParse({
    toPhase: 1,
    reason: "  growth target met  ",
  });
  assert.equal(result.success, true);
  if (result.success) {
    assert.equal(result.data.reason, "growth target met");
  }
});

// ============================================================================
// Direction classification (descriptive only — nothing is ever blocked)
// ============================================================================

test("classifies a forward-by-one move as advance", () => {
  assert.equal(classifyTransition(1, 2), "advance");
});

test("classifies a backward move as regress", () => {
  assert.equal(classifyTransition(3, 1), "regress");
  assert.equal(classifyTransition(1, 0), "regress");
});

test("classifies a forward-by-many move as skip", () => {
  assert.equal(classifyTransition(0, 3), "skip");
  assert.equal(classifyTransition(2, 6), "skip");
});

test("classifies same-phase as noop", () => {
  assert.equal(classifyTransition(4, 4), "noop");
});

// ============================================================================
// Audit-row builder (PE-002 / AC-PE-1: captures snapshot + rubric version)
// ============================================================================

function fakeSnapshot(): PlantFactSnapshot {
  return {
    snapshotVersion: "v1",
    churchId: "church-1",
    currentPhase: 1,
    generatedAt: "2026-06-22T00:00:00.000Z",
    isColdStart: false,
  } as unknown as PlantFactSnapshot;
}

test("builds an immutable audit row carrying from/to, user, reason, snapshot, rubric version", () => {
  const snapshot = fakeSnapshot();
  const row = buildTransitionRow({
    churchId: "church-1",
    fromPhase: 1,
    toPhase: 2,
    initiatedById: "user-1",
    reason: "Core group at target",
    factSnapshot: snapshot,
    rubricVersion: "v0",
  });

  assert.equal(row.churchId, "church-1");
  assert.equal(row.fromPhase, 1);
  assert.equal(row.toPhase, 2);
  assert.equal(row.initiatedById, "user-1");
  assert.equal(row.reason, "Core group at target");
  assert.equal(row.rubricVersion, "v0");
  // The exact deterministic snapshot must be persisted verbatim for audit.
  assert.deepEqual(row.factSnapshot, snapshot);
});

test("preserves a backward (correction) transition in the audit row", () => {
  const row = buildTransitionRow({
    churchId: "c",
    fromPhase: 3,
    toPhase: 1,
    initiatedById: "u",
    reason: "regression",
    factSnapshot: fakeSnapshot(),
    rubricVersion: "v0",
  });
  assert.equal(row.fromPhase, 3);
  assert.equal(row.toPhase, 1);
});

// ============================================================================
// Readiness derivation (PE-015) — advisory, derived from latest assessment
// ============================================================================

function insight(
  over: Partial<{
    category: string;
    audience: string;
    severity: string;
    title: string;
    body: string;
    rank: number;
  }>
) {
  return {
    category: "launch_readiness",
    audience: "planter",
    severity: "info",
    title: "title",
    body: "body",
    rank: 0,
    ...over,
  };
}

test("returns unknown / no-assessment when there is no assessment", () => {
  const r = deriveReadiness(null, []);
  assert.equal(r.hasAssessment, false);
  assert.equal(r.state, "unknown");
  assert.equal(r.assessmentId, null);
});

test("returns unknown when there are no readiness insights", () => {
  const r = deriveReadiness("a-1", [
    insight({ category: "vision_casting", severity: "urgent" }),
  ]);
  assert.equal(r.hasAssessment, true);
  assert.equal(r.state, "unknown");
  assert.equal(r.assessmentId, "a-1");
});

test("maps an urgent readiness insight to not_ready", () => {
  const r = deriveReadiness("a-1", [
    insight({ severity: "urgent", title: "Not enough committed adults" }),
  ]);
  assert.equal(r.state, "not_ready");
  assert.equal(r.headline, "Not enough committed adults");
});

test("maps a watch readiness insight to approaching", () => {
  const r = deriveReadiness("a-1", [insight({ severity: "watch" })]);
  assert.equal(r.state, "approaching");
});

test("maps a positive/info readiness insight to ready", () => {
  assert.equal(
    deriveReadiness("a-1", [insight({ severity: "positive" })]).state,
    "ready"
  );
  assert.equal(
    deriveReadiness("a-1", [insight({ severity: "info" })]).state,
    "ready"
  );
});

test("picks the highest-priority (lowest rank) readiness insight", () => {
  const r = deriveReadiness("a-1", [
    insight({ severity: "info", rank: 5, title: "low priority" }),
    insight({ severity: "urgent", rank: 1, title: "high priority" }),
  ]);
  assert.equal(r.state, "not_ready");
  assert.equal(r.headline, "high priority");
});

test("ignores network-audience readiness insights (planter view only)", () => {
  const r = deriveReadiness("a-1", [
    insight({ audience: "network", severity: "urgent", rank: 0 }),
  ]);
  assert.equal(r.state, "unknown");
});

test("also treats phase_progress as a readiness category", () => {
  const r = deriveReadiness("a-1", [
    insight({ category: "phase_progress", severity: "watch" }),
  ]);
  assert.equal(r.state, "approaching");
});
