import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import path from "node:path";
import { before, test } from "node:test";

const LIVE = process.env.LIVE_DB_TESTS === "1";
const identities = [
  "launch.schedule",
  "launch.milestone.complete",
  "launch.milestone.reopen",
  "launch.task.set-completion",
  "launch.outcome.record",
  "launch.outcome.correct",
] as const;
let outcomes: ReadonlySet<string> | Error | null = null;

// The production-route proof consistently completes in ~276s both locally and
// on its Launch-only hosted run. The larger stacked app exceeded the old 420s
// deadline once despite passing all 18 assertions in an isolated reproduction;
// 600s preserves a finite deadlock bound with measured CI variance.
const LIVE_PROOF_TIMEOUT_MS = 600_000;

before(() => {
  if (!LIVE) return;
  const result = spawnSync(
    process.execPath,
    [
      "--no-warnings",
      "--import",
      "tsx",
      "--import",
      "./scripts/live-db-endpoint.ts",
      path.join(
        process.cwd(),
        "src/lib/evry/capabilities/launch/effect-live-proof.ts"
      ),
    ],
    {
      cwd: process.cwd(),
      encoding: "utf8",
      env: process.env,
      timeout: LIVE_PROOF_TIMEOUT_MS,
    }
  );
  if (result.status !== 0) {
    outcomes = new Error(
      `Launch effect live proof failed\n${result.stdout}\n${result.stderr}`
    );
    return;
  }
  const encoded = /^EVRY_LAUNCH_EFFECT_OUTCOMES=(.+)$/m.exec(
    result.stdout
  )?.[1];
  outcomes = encoded
    ? new Set(JSON.parse(encoded) as string[])
    : new Error("Launch effect proof returned no outcomes");
});

for (const identity of identities) {
  for (const layer of ["execution", "idempotency", "errors"] as const) {
    test(
      `${identity}:${layer}:live`,
      { skip: LIVE ? false : "opt-in real PostgreSQL proof" },
      () => {
        assert.ok(outcomes);
        if (outcomes instanceof Error) throw outcomes;
        assert.ok(outcomes.has(`${identity}:${layer}`));
      }
    );
  }
}
