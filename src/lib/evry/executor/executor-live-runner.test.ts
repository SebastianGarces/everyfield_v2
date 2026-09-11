import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";

import {
  EXECUTOR_LIVE_PROOF_PHASES,
  EXECUTOR_LIVE_PROOF_PHASE_TIMEOUT_MS,
  executorLiveProofArguments,
  executorLiveProofPhaseMarker,
  parseExecutorLiveProofPhase,
} from "./executor-live-runner";

const wrapper = readFileSync(
  path.join(__dirname, "executor-live.test.ts"),
  "utf8"
);
const proof = readFileSync(
  path.join(__dirname, "executor-live-proof.ts"),
  "utf8"
);

test("Executor owns three independently bounded live proof families", () => {
  assert.deepEqual(EXECUTOR_LIVE_PROOF_PHASES, [
    "replay",
    "communication",
    "authority",
  ]);
  assert.equal(EXECUTOR_LIVE_PROOF_PHASE_TIMEOUT_MS, 120_000);
  assert.match(wrapper, /for \(const phase of EXECUTOR_LIVE_PROOF_PHASES\)/);
  assert.match(wrapper, /executorLiveProofArguments\(\{ cwd, phase \}\)/);
  assert.match(wrapper, /timeout: EXECUTOR_LIVE_PROOF_PHASE_TIMEOUT_MS/);
  assert.doesNotMatch(wrapper, /timeout:\s*(?:240|360)_000/);
});

test("each child receives one exact phase and observable lifecycle markers", () => {
  for (const phase of EXECUTOR_LIVE_PROOF_PHASES) {
    const args = executorLiveProofArguments({ cwd: "/repo", phase });
    assert.equal(args.at(-1), phase);
    assert.equal(
      args.filter((argument) => argument.endsWith("executor-live-proof.ts"))
        .length,
      1
    );
    assert.equal(parseExecutorLiveProofPhase(phase), phase);
    assert.equal(
      executorLiveProofPhaseMarker(phase, "started"),
      `EVRY_EXECUTOR_LIVE_PHASE=${phase}:started`
    );
    assert.equal(
      executorLiveProofPhaseMarker(phase, "passed"),
      `EVRY_EXECUTOR_LIVE_PHASE=${phase}:passed`
    );
  }
  assert.throws(() => parseExecutorLiveProofPhase(undefined), /Unknown/);
  assert.throws(() => parseExecutorLiveProofPhase("aggregate"), /Unknown/);
});

test("every phase is dispatched exactly once and communication owns the expiry wait", () => {
  for (const phase of EXECUTOR_LIVE_PROOF_PHASES) {
    assert.equal(
      proof.match(new RegExp(`if \\(PROOF_PHASE === "${phase}"\\)`, "g"))
        ?.length,
      1
    );
  }

  const replay = proof.slice(
    proof.indexOf('if (PROOF_PHASE === "replay")'),
    proof.indexOf('if (PROOF_PHASE === "communication")')
  );
  const communication = proof.slice(
    proof.indexOf('if (PROOF_PHASE === "communication")'),
    proof.indexOf('if (PROOF_PHASE === "authority")')
  );
  const authority = proof.slice(
    proof.indexOf('if (PROOF_PHASE === "authority")')
  );

  assert.match(replay, /doubleClick/);
  assert.match(replay, /crashPlan/);
  assert.match(communication, /untilExpired/);
  assert.match(communication, /markerRaceTrigger/);
  assert.doesNotMatch(replay, /untilExpired/);
  assert.doesNotMatch(authority, /untilExpired/);
  assert.match(authority, /authorityChange/);
  assert.match(authority, /lifecycle/);
  assert.match(authority, /expiredPlan/);
});
