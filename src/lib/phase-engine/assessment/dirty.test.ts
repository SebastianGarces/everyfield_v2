import assert from "node:assert/strict";
import { test } from "node:test";

import {
  filterDirtyOrStale,
  isDirtyOrStale,
  MAX_STALENESS_MS,
  selectionReasonFor,
  type PlantSelectionInput,
} from "./dirty";

// ----------------------------------------------------------------------------
// Pure dirty/stale selection (AC-PE-8). No DB, no clock — `now` is injected.
// ----------------------------------------------------------------------------

const NOW = new Date("2026-06-22T12:00:00.000Z");
const ONE_DAY = 24 * 60 * 60 * 1000;

function input(
  overrides: Partial<PlantSelectionInput> = {}
): PlantSelectionInput {
  return {
    churchId: "church-1",
    lastMaterialEventAt: null,
    latestAssessmentAt: new Date(NOW.getTime() - ONE_DAY), // recent
    ...overrides,
  };
}

test("never-assessed plants are always selected", () => {
  const p = input({ latestAssessmentAt: null });
  assert.equal(selectionReasonFor(p, NOW), "never-assessed");
  assert.equal(isDirtyOrStale(p, NOW), true);
});

test("a quiet, recently-assessed plant is excluded", () => {
  const p = input({
    lastMaterialEventAt: new Date(NOW.getTime() - 2 * ONE_DAY), // before last assessment
    latestAssessmentAt: new Date(NOW.getTime() - ONE_DAY),
  });
  assert.equal(selectionReasonFor(p, NOW), null);
  assert.equal(isDirtyOrStale(p, NOW), false);
});

test("a material event after the last assessment marks the plant dirty", () => {
  const p = input({
    latestAssessmentAt: new Date(NOW.getTime() - 2 * ONE_DAY),
    lastMaterialEventAt: new Date(NOW.getTime() - ONE_DAY), // after last assessment
  });
  assert.equal(selectionReasonFor(p, NOW), "dirty");
});

test("a material event exactly at the assessment time does NOT mark dirty (strict >)", () => {
  const at = new Date(NOW.getTime() - ONE_DAY);
  const p = input({ latestAssessmentAt: at, lastMaterialEventAt: at });
  assert.equal(selectionReasonFor(p, NOW), null);
});

test("a plant past the max-staleness window is selected as stale", () => {
  const p = input({
    lastMaterialEventAt: null,
    latestAssessmentAt: new Date(NOW.getTime() - MAX_STALENESS_MS - ONE_DAY),
  });
  assert.equal(selectionReasonFor(p, NOW), "stale");
});

test("a plant exactly at the staleness boundary is NOT yet stale", () => {
  const p = input({
    lastMaterialEventAt: null,
    latestAssessmentAt: new Date(NOW.getTime() - MAX_STALENESS_MS),
  });
  assert.equal(selectionReasonFor(p, NOW), null);
});

test("dirty takes precedence over staleness in the reason", () => {
  const p = input({
    latestAssessmentAt: new Date(
      NOW.getTime() - MAX_STALENESS_MS - 5 * ONE_DAY
    ),
    lastMaterialEventAt: new Date(NOW.getTime() - ONE_DAY),
  });
  assert.equal(selectionReasonFor(p, NOW), "dirty");
});

test("filterDirtyOrStale keeps only selectable plants, preserving order", () => {
  const quiet = input({
    churchId: "quiet",
    lastMaterialEventAt: new Date(NOW.getTime() - 3 * ONE_DAY),
    latestAssessmentAt: new Date(NOW.getTime() - ONE_DAY),
  });
  const dirty = input({
    churchId: "dirty",
    latestAssessmentAt: new Date(NOW.getTime() - 2 * ONE_DAY),
    lastMaterialEventAt: new Date(NOW.getTime() - ONE_DAY),
  });
  const fresh = input({ churchId: "fresh", latestAssessmentAt: null });

  const out = filterDirtyOrStale([quiet, dirty, fresh], NOW);
  assert.deepEqual(
    out.map((p) => p.churchId),
    ["dirty", "fresh"]
  );
});

test("a custom max-staleness window is honored", () => {
  const p = input({
    lastMaterialEventAt: null,
    latestAssessmentAt: new Date(NOW.getTime() - 2 * ONE_DAY),
  });
  // 1-day window → 2-day-old assessment is stale.
  assert.equal(selectionReasonFor(p, NOW, ONE_DAY), "stale");
  // 3-day window → not yet stale.
  assert.equal(selectionReasonFor(p, NOW, 3 * ONE_DAY), null);
});
