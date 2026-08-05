import assert from "node:assert/strict";
import { test } from "node:test";

import {
  filterDirtyOrStale,
  MAX_STALENESS_MS,
  selectionReasonFor,
  type PlantSelectionInput,
} from "@/lib/phase-engine/assessment/dirty";
import type { SelectedPlant } from "@/lib/phase-engine/assessment";

import {
  GET,
  isAuthorized,
  runAssessmentBatch,
  type RunAssessmentBatchDeps,
} from "./route";

// No live DB or LLM here. The selection query and the per-plant generator are
// both injected; the real LLM call inside `generateAssessment` is never reached.

const ONE_DAY = 24 * 60 * 60 * 1000;
const NOW = new Date("2026-06-22T12:00:00.000Z");

// ----------------------------------------------------------------------------
// Secret guard (AC: route rejects requests without the cron secret).
// ----------------------------------------------------------------------------

function reqWithAuth(value: string | null): import("next/server").NextRequest {
  const headers = new Map<string, string>();
  if (value !== null) headers.set("authorization", value);
  // Minimal shape — `isAuthorized` only reads `headers.get`.
  return {
    headers: { get: (k: string) => headers.get(k.toLowerCase()) ?? null },
  } as unknown as import("next/server").NextRequest;
}

test("rejects when no Authorization header is present", () => {
  process.env.CRON_SECRET = "s3cret";
  assert.equal(isAuthorized(reqWithAuth(null)), false);
});

test("rejects a wrong bearer token", () => {
  process.env.CRON_SECRET = "s3cret";
  assert.equal(isAuthorized(reqWithAuth("Bearer wrong")), false);
});

test("rejects a bare token without the Bearer scheme", () => {
  process.env.CRON_SECRET = "s3cret";
  assert.equal(isAuthorized(reqWithAuth("s3cret")), false);
});

test("fails closed when CRON_SECRET is not configured", () => {
  delete process.env.CRON_SECRET;
  assert.equal(isAuthorized(reqWithAuth("Bearer anything")), false);
});

test("accepts a correct Bearer token", () => {
  process.env.CRON_SECRET = "s3cret";
  assert.equal(isAuthorized(reqWithAuth("Bearer s3cret")), true);
});

// ----------------------------------------------------------------------------
// AC (#266): the comparison is constant-time here too, not only on the
// notifications dispatcher.
//
// One CRON_SECRET authorises BOTH scheduled routes (memory/contracts/config.md),
// so a timing oracle on this endpoint leaks the key that opens the other one —
// hardening a single route was worth nothing on its own. `timingSafeEqual`
// throws a RangeError on unequal-length buffers, so the wrong-length cases are
// the proof the lengths are reconciled before the call rather than after a 500.
// The comparison itself is unit-tested in
// `src/lib/security/constant-time.test.ts`; these are the route's own wiring.
// ----------------------------------------------------------------------------

test("a shorter token is refused, not thrown over", () => {
  process.env.CRON_SECRET = "s3cret";
  assert.equal(isAuthorized(reqWithAuth("Bearer s3cre")), false);
  assert.equal(isAuthorized(reqWithAuth("Bearer ")), false);
  assert.equal(isAuthorized(reqWithAuth("")), false);
});

test("a longer token is refused, not thrown over", () => {
  process.env.CRON_SECRET = "s3cret";
  // The correct secret with anything appended: the prefix matches, which is
  // exactly the case a byte-by-byte compare would answer fastest.
  assert.equal(isAuthorized(reqWithAuth("Bearer s3cretX")), false);
  assert.equal(
    isAuthorized(reqWithAuth(`Bearer ${"s3cret".repeat(2000)}`)),
    false
  );
});

test("a token differing only in its last byte is refused", () => {
  // Same length, so the constant-time compare does the deciding.
  process.env.CRON_SECRET = "s3cret";
  assert.equal(isAuthorized(reqWithAuth("Bearer s3creT")), false);
});

test("a long secret still authorises exactly one value", () => {
  const secret = "a".repeat(64);
  process.env.CRON_SECRET = secret;
  assert.equal(isAuthorized(reqWithAuth(`Bearer ${secret}`)), true);
  assert.equal(isAuthorized(reqWithAuth(`Bearer ${"a".repeat(63)}b`)), false);
});

test("an unauthorised GET is refused with 401 and assesses nothing", async () => {
  process.env.CRON_SECRET = "s3cret";

  const response = await GET(reqWithAuth("Bearer nope"));

  assert.equal(response.status, 401);
  assert.deepEqual(await response.json(), { error: "Unauthorized" });
});

// ----------------------------------------------------------------------------
// Batch runner: selects only dirty-or-stale plants and assesses each (AC-PE-8).
// ----------------------------------------------------------------------------

/** Drive the runner off the real pure selection logic over fixture plants. */
function depsFor(
  plants: PlantSelectionInput[],
  calls: string[],
  overrides: Partial<RunAssessmentBatchDeps> = {}
): RunAssessmentBatchDeps {
  return {
    maxBatch: 25,
    async selectPlantsForAssessment(): Promise<SelectedPlant[]> {
      return filterDirtyOrStale(plants, NOW, MAX_STALENESS_MS).map((p) => ({
        churchId: p.churchId,
        reason: selectionReasonFor(p, NOW, MAX_STALENESS_MS)!,
      }));
    },
    async generateAssessment(churchId: string) {
      calls.push(churchId);
      // Shape is irrelevant to the runner; it ignores the return value.
      return {} as Awaited<
        ReturnType<
          typeof import("@/lib/phase-engine/assessment").generateAssessment
        >
      >;
    },
    ...overrides,
  };
}

test("invokes generateAssessment once for each selected plant (AC-PE-8)", async () => {
  const calls: string[] = [];
  const plants: PlantSelectionInput[] = [
    // dirty: material event after last assessment
    {
      churchId: "dirty",
      lastMaterialEventAt: new Date(NOW.getTime() - 1 * ONE_DAY),
      latestAssessmentAt: new Date(NOW.getTime() - 2 * ONE_DAY),
    },
    // never assessed
    {
      churchId: "fresh-plant",
      lastMaterialEventAt: null,
      latestAssessmentAt: null,
    },
  ];

  const summary = await runAssessmentBatch(depsFor(plants, calls));

  assert.deepEqual(calls.sort(), ["dirty", "fresh-plant"]);
  assert.equal(summary.selected, 2);
  assert.equal(summary.assessed, 2);
  assert.equal(summary.failed, 0);
});

test("PE-010: quiet plant is skipped, max-stale plant is re-assessed", async () => {
  const calls: string[] = [];
  const plants: PlantSelectionInput[] = [
    // quiet + fresh: material event BEFORE last assessment, assessed yesterday → skip
    {
      churchId: "quiet",
      lastMaterialEventAt: new Date(NOW.getTime() - 3 * ONE_DAY),
      latestAssessmentAt: new Date(NOW.getTime() - 1 * ONE_DAY),
    },
    // stale: last assessment older than the staleness window → re-assess
    {
      churchId: "stale",
      lastMaterialEventAt: null,
      latestAssessmentAt: new Date(NOW.getTime() - MAX_STALENESS_MS - ONE_DAY),
    },
  ];

  const summary = await runAssessmentBatch(depsFor(plants, calls));

  // Only the stale plant is assessed; the quiet one never reaches the generator.
  assert.deepEqual(calls, ["stale"]);
  assert.equal(summary.selected, 1);
  assert.equal(summary.assessed, 1);
  assert.ok(!calls.includes("quiet"));
});

test("caps the batch and defers the rest", async () => {
  const calls: string[] = [];
  // Five never-assessed plants, cap of 2 → only 2 assessed, 3 skipped.
  const plants: PlantSelectionInput[] = Array.from({ length: 5 }, (_, i) => ({
    churchId: `p${i}`,
    lastMaterialEventAt: null,
    latestAssessmentAt: null,
  }));

  const summary = await runAssessmentBatch(
    depsFor(plants, calls, { maxBatch: 2 })
  );

  assert.equal(summary.selected, 5);
  assert.equal(summary.attempted, 2);
  assert.equal(summary.assessed, 2);
  assert.equal(summary.skipped, 3);
  assert.equal(calls.length, 2);
});

test("a failing plant is recorded but does not abort the run", async () => {
  const calls: string[] = [];
  const plants: PlantSelectionInput[] = [
    { churchId: "ok-1", lastMaterialEventAt: null, latestAssessmentAt: null },
    { churchId: "boom", lastMaterialEventAt: null, latestAssessmentAt: null },
    { churchId: "ok-2", lastMaterialEventAt: null, latestAssessmentAt: null },
  ];

  const deps = depsFor(plants, calls, {
    async generateAssessment(churchId: string) {
      calls.push(churchId);
      if (churchId === "boom") throw new Error("openai exploded");
      return {} as Awaited<
        ReturnType<
          typeof import("@/lib/phase-engine/assessment").generateAssessment
        >
      >;
    },
  });

  const summary = await runAssessmentBatch(deps);

  assert.equal(summary.attempted, 3);
  assert.equal(summary.assessed, 2);
  assert.equal(summary.failed, 1);
  assert.equal(calls.length, 3); // every plant attempted despite the failure
  const failed = summary.outcomes.find((o) => o.status === "failed");
  assert.equal(failed?.churchId, "boom");
  assert.match(failed?.error ?? "", /openai exploded/);
});
