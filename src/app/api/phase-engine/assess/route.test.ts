import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { test } from "node:test";

import {
  filterDirtyOrStale,
  MAX_STALENESS_MS,
  orderByAssessmentAge,
  selectionReasonFor,
  type PlantSelectionInput,
} from "@/lib/phase-engine/assessment/dirty";
import type { SelectedPlant } from "@/lib/phase-engine/assessment";
import { SchemaRejectionError } from "@/lib/phase-engine/judge/schema-rejection";

import {
  GET,
  isAuthorized,
  maxDuration,
  RUN_BUDGET_MS,
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
      // Mirrors the real `selectPlantsForAssessment` (assessment/queries.ts)
      // exactly: filter, THEN order oldest-assessed-first, and only then hand
      // the list to the runner, which slices it. A stub that skipped the
      // ordering would make the starvation test below prove nothing.
      return orderByAssessmentAge(
        filterDirtyOrStale(plants, NOW, MAX_STALENESS_MS)
      ).map((p) => ({
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

// ----------------------------------------------------------------------------
// Anti-starvation (#36): the cap drops the TAIL, so the order the selection
// arrives in decides who is dropped — and it must never be the same plants.
// ----------------------------------------------------------------------------

test("the batch takes the longest-waiting plants, not the first rows scanned", async () => {
  const calls: string[] = [];
  // Deliberately handed to the runner newest-first, i.e. the worst possible
  // scan order: unordered, the cap would assess the two FRESHEST plants and the
  // oldest would never be reached at all.
  const plants: PlantSelectionInput[] = [
    {
      churchId: "assessed-1d-ago",
      lastMaterialEventAt: new Date(NOW.getTime() - 1),
      latestAssessmentAt: new Date(NOW.getTime() - 1 * ONE_DAY),
    },
    {
      churchId: "assessed-3d-ago",
      lastMaterialEventAt: new Date(NOW.getTime() - 1),
      latestAssessmentAt: new Date(NOW.getTime() - 3 * ONE_DAY),
    },
    {
      churchId: "never-assessed",
      lastMaterialEventAt: null,
      latestAssessmentAt: null,
    },
  ];

  const summary = await runAssessmentBatch(
    depsFor(plants, calls, { maxBatch: 2 })
  );

  // Never-assessed first — waiting forever beats waiting three days — then the
  // oldest timestamp. The plant assessed yesterday is the one that rolls over.
  assert.deepEqual(calls, ["never-assessed", "assessed-3d-ago"]);
  assert.equal(summary.skipped, 1);
  assert.deepEqual(
    summary.outcomes.map((o) => o.churchId),
    ["never-assessed", "assessed-3d-ago"]
  );
});

test("a plant dropped by the cap is first in line once the leaders are assessed", async () => {
  // The rollover half of the guarantee: assessing a plant moves it to the back,
  // so the tail of one run is the head of the next. Without that, ordering
  // would just starve a different fixed set.
  const calls: string[] = [];
  const plants: PlantSelectionInput[] = [
    {
      churchId: "was-dropped",
      lastMaterialEventAt: new Date(NOW.getTime() - 1),
      latestAssessmentAt: new Date(NOW.getTime() - 1 * ONE_DAY),
    },
    // The two that won the first run, now carrying a just-written timestamp.
    {
      churchId: "assessed-3d-ago",
      lastMaterialEventAt: new Date(NOW.getTime() - 1),
      latestAssessmentAt: new Date(NOW.getTime() - 1000),
    },
    {
      churchId: "never-assessed",
      lastMaterialEventAt: new Date(NOW.getTime() - 1),
      latestAssessmentAt: new Date(NOW.getTime() - 1000),
    },
  ];

  await runAssessmentBatch(depsFor(plants, calls, { maxBatch: 1 }));

  assert.deepEqual(calls, ["was-dropped"]);
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

// ----------------------------------------------------------------------------
// A judge that would not follow its own rule reads differently from a provider
// that would not talk to us (#605, AC-3).
//
// `failed` had one meaning and one sentence. It now has a third reading, and it
// is the only one that says what to CHANGE: a run reporting
// `planter_first_pairing` on four plants is telling you the rubric teaches that
// rule badly, which no amount of re-running will fix. So the rule has to reach
// the summary and the log, not just the row an operator would have to go and
// query.
// ----------------------------------------------------------------------------

test("a plant whose every draft was rejected names the rule in the summary and the log", async () => {
  const calls: string[] = [];
  const plants: PlantSelectionInput[] = [
    { churchId: "ok-1", lastMaterialEventAt: null, latestAssessmentAt: null },
    {
      churchId: "stubborn",
      lastMaterialEventAt: null,
      latestAssessmentAt: null,
    },
  ];

  const errors: string[] = [];
  const realError = console.error;
  console.error = (...args: unknown[]) => void errors.push(args.join(" "));

  let summary;
  try {
    summary = await runAssessmentBatch(
      depsFor(plants, calls, {
        async generateAssessment(churchId: string, _deps, run) {
          calls.push(churchId);
          if (churchId !== "stubborn") {
            return {} as Awaited<
              ReturnType<
                typeof import("@/lib/phase-engine/assessment").generateAssessment
              >
            >;
          }
          // Two drafts re-prompted, the third exhausting the ladder — the
          // sequence the runner has to render as one failure and two retries.
          for (const attempt of [1, 2, 3]) {
            run?.onSchemaRejection?.({
              label: churchId,
              attempt,
              maxAttempts: 3,
              rules: ["planter_first_pairing"],
              issues: [
                { rule: "planter_first_pairing", message: "unpaired: prayer" },
              ],
              exhausted: attempt === 3,
            });
          }
          throw new SchemaRejectionError(
            churchId,
            3,
            {
              issues: [
                { rule: "planter_first_pairing", message: "unpaired: prayer" },
              ],
              rules: ["planter_first_pairing"],
            },
            new Error("no object generated")
          );
        },
      })
    );
  } finally {
    console.error = realError;
  }

  // Still a failure, and still not fatal to the run.
  assert.equal(summary.assessed, 1);
  assert.equal(summary.failed, 1);
  assert.equal(summary.attempted, 2);

  // …but a failure that says WHICH rule, and how much the ladder was carrying.
  assert.equal(summary.schemaRejected, 1);
  // Two, not three: the exhausting draft was rejected and never re-prompted.
  assert.equal(summary.schemaRetried, 2);

  const failed = summary.outcomes.find((o) => o.status === "failed");
  assert.deepEqual(failed?.schemaRules, ["planter_first_pairing"]);
  assert.equal(failed?.truncatedByDeadline, false);

  assert.ok(
    errors.some((line) => /planter_first_pairing/.test(line)),
    "the rejecting rule must be in the log line, or a `failed` row can only be read by reproducing the run"
  );
});

test("a rejection the run's clock cut short warns instead of paging", async () => {
  const calls: string[] = [];
  const plants: PlantSelectionInput[] = [
    {
      churchId: "out-of-time",
      lastMaterialEventAt: null,
      latestAssessmentAt: null,
    },
  ];

  const warns: string[] = [];
  const errors: string[] = [];
  const realWarn = console.warn;
  const realError = console.error;
  console.warn = (...args: unknown[]) => void warns.push(args.join(" "));
  console.error = (...args: unknown[]) => void errors.push(args.join(" "));

  let summary;
  try {
    summary = await runAssessmentBatch(
      depsFor(plants, calls, {
        async generateAssessment(churchId: string) {
          calls.push(churchId);
          throw new SchemaRejectionError(
            churchId,
            1,
            {
              issues: [{ rule: "observation_budget", message: "over budget" }],
              rules: ["observation_budget"],
            },
            new Error("no object generated"),
            "run_budget"
          );
        },
      })
    );
  } finally {
    console.warn = realWarn;
    console.error = realError;
  }

  // The status stays `failed` — the provider answered and the answer broke a
  // rule, whatever stopped the ladder (the 2026-08-10 ruling, #374/#375). Only
  // the CHANNEL differs, so a run truncated by its own clock never pages.
  assert.equal(summary.failed, 1);
  assert.equal(summary.outcomes[0].truncatedByDeadline, true);
  assert.deepEqual(errors, []);
  assert.ok(warns.some((line) => /observation_budget/.test(line)));
});

// ----------------------------------------------------------------------------
// The schedule has to exist, or no plant is ever re-assessed — and it has to
// live somewhere the plan will actually accept (#36, ruled 2026-08-09).
// ----------------------------------------------------------------------------

// The workflow is read as text rather than parsed: `yaml` is only a transitive
// dependency here, and the facts under test are literal schedule lines and a
// literal URL. All of them break loudly if the file is restructured.
function readAssessWorkflow(): string {
  return readFileSync(
    path.join(process.cwd(), ".github/workflows/phase-engine-assess.yml"),
    "utf8"
  );
}

function readVercelCrons(): { path: string; schedule: string }[] {
  const config = JSON.parse(
    readFileSync(path.join(process.cwd(), "vercel.json"), "utf8")
  ) as { crons?: { path: string; schedule: string }[] };
  return config.crons ?? [];
}

test("a GitHub Actions schedule ticks the assessment run twice a day", () => {
  const workflow = readAssessWorkflow();

  // Two ticks is the ruling, not a detail: MAX_BATCH=10 against a ~10-15 plant
  // cohort cannot clear the cohort on one tick a day.
  assert.match(
    workflow,
    /- cron: "0 7 \* \* \*"/,
    "the morning tick is missing from the assess workflow"
  );
  assert.match(
    workflow,
    /- cron: "0 19 \* \* \*"/,
    "the evening tick is missing — one tick a day cannot clear the cohort at MAX_BATCH=10"
  );
  assert.match(
    workflow,
    /\/api\/phase-engine\/assess/,
    "the workflow does not call the assess route"
  );
  // Without the bearer the route fails closed and every tick 401s.
  assert.match(
    workflow,
    /Authorization: Bearer \$CRON_SECRET/,
    "the workflow does not send the CRON_SECRET bearer"
  );
});

test("vercel.json does NOT also schedule the assessment run", () => {
  // Not a style preference. Hobby rejects a sub-daily cron outright and fails
  // the whole deployment with it, which is why the twice-daily schedule cannot
  // live here — and leaving the old daily entry behind would give the route TWO
  // drivers, doubling the OpenAI spend and racing the pacer's TPM window.
  assert.equal(
    readVercelCrons().find((cron) => cron.path === "/api/phase-engine/assess"),
    undefined,
    "the assess route is scheduled twice — vercel.json and GitHub Actions"
  );
});

test("the run budget sits under the declared function timeout", () => {
  // The run stands its remaining plants down and returns a summary rather than
  // being killed mid-plant, which would strand a `pending` row nobody flips.
  assert.ok(
    RUN_BUDGET_MS < maxDuration * 1000,
    `budget ${RUN_BUDGET_MS}ms must be under ${maxDuration}s`
  );
});
