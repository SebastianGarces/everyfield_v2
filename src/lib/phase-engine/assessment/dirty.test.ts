import assert from "node:assert/strict";
import { test } from "node:test";

import {
  filterDirtyOrStale,
  isDirtyOrStale,
  MAX_STALENESS_MS,
  orderByAssessmentAge,
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

// ----------------------------------------------------------------------------
// orderByAssessmentAge (#36): the runner caps the batch and drops the tail, so
// this order is the only thing standing between a fixed set of plants and never
// being assessed at all.
// ----------------------------------------------------------------------------

test("orderByAssessmentAge puts the longest-waiting plant first", () => {
  const out = orderByAssessmentAge([
    input({
      churchId: "yesterday",
      latestAssessmentAt: new Date(NOW.getTime() - ONE_DAY),
    }),
    input({
      churchId: "last-week",
      latestAssessmentAt: new Date(NOW.getTime() - 7 * ONE_DAY),
    }),
    input({
      churchId: "an-hour-ago",
      latestAssessmentAt: new Date(NOW.getTime() - 60 * 60 * 1000),
    }),
  ]);

  assert.deepEqual(
    out.map((p) => p.churchId),
    ["last-week", "yesterday", "an-hour-ago"]
  );
});

test("never-assessed plants sort ahead of every assessed one", () => {
  // Waiting forever beats waiting a long time. A plant with no assessment has
  // nothing to show a planter at all, so it outranks any stale snapshot.
  const out = orderByAssessmentAge([
    input({
      churchId: "ancient",
      latestAssessmentAt: new Date(NOW.getTime() - 400 * ONE_DAY),
    }),
    input({ churchId: "never-b", latestAssessmentAt: null }),
    input({
      churchId: "recent",
      latestAssessmentAt: new Date(NOW.getTime() - ONE_DAY),
    }),
    input({ churchId: "never-a", latestAssessmentAt: null }),
  ]);

  assert.deepEqual(
    out.map((p) => p.churchId),
    ["never-a", "never-b", "ancient", "recent"]
  );
});

test("ties break on churchId, so the order is total and repeatable", () => {
  // Two plants assessed in the same run share a timestamp. Without the
  // tiebreak the cap would drop whichever the DB scan happened to return last,
  // which is stable across runs — i.e. the same plant, every run.
  const sameInstant = new Date(NOW.getTime() - 2 * ONE_DAY);
  const plants = [
    input({ churchId: "c", latestAssessmentAt: sameInstant }),
    input({ churchId: "a", latestAssessmentAt: sameInstant }),
    input({ churchId: "b", latestAssessmentAt: sameInstant }),
  ];

  assert.deepEqual(
    orderByAssessmentAge(plants).map((p) => p.churchId),
    ["a", "b", "c"]
  );
  // Same input in a different scan order gives the same answer.
  assert.deepEqual(
    orderByAssessmentAge([...plants].reverse()).map((p) => p.churchId),
    ["a", "b", "c"]
  );
});

test("orderByAssessmentAge does not mutate its input", () => {
  const plants = [
    input({ churchId: "z", latestAssessmentAt: new Date(NOW.getTime() - 1) }),
    input({ churchId: "a", latestAssessmentAt: null }),
  ];

  orderByAssessmentAge(plants);

  assert.deepEqual(
    plants.map((p) => p.churchId),
    ["z", "a"]
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
