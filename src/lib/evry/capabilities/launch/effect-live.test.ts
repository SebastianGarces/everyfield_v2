import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { before, test } from "node:test";

import {
  LAUNCH_EFFECT_LIVE_PROOF_PHASES,
  LAUNCH_EFFECT_LIVE_PROOF_PHASE_TIMEOUT_MS,
  launchEffectLiveProofArguments,
  launchEffectLiveProofPhaseMarker,
} from "./effect-live-runner";

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

before(() => {
  if (!LIVE) return;
  const cwd = process.cwd();
  let adapterOutput = "";
  for (const phase of LAUNCH_EFFECT_LIVE_PROOF_PHASES) {
    const startedAt = Date.now();
    const result = spawnSync(
      process.execPath,
      launchEffectLiveProofArguments({ cwd, phase }),
      {
        cwd,
        encoding: "utf8",
        env: process.env,
        timeout: LAUNCH_EFFECT_LIVE_PROOF_PHASE_TIMEOUT_MS,
      }
    );
    if (result.status !== 0) {
      outcomes = new Error(
        [
          `Launch ${phase} live proof failed`,
          `error: ${result.error?.message ?? "none"}`,
          `signal: ${result.signal ?? "none"}`,
          result.stdout,
          result.stderr,
        ].join("\n")
      );
      return;
    }
    if (!result.stdout.includes(launchEffectLiveProofPhaseMarker(phase))) {
      outcomes = new Error(
        `Launch ${phase} live proof returned no completion marker\n${result.stdout}\n${result.stderr}`
      );
      return;
    }
    process.stdout.write(
      `Launch ${phase} live proof passed in ${Date.now() - startedAt}ms\n`
    );
    if (phase === "adapter") adapterOutput = result.stdout;
  }
  const encoded = /^EVRY_LAUNCH_EFFECT_OUTCOMES=(.+)$/m.exec(
    adapterOutput
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
