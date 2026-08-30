import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";

import {
  LAUNCH_EFFECT_LIVE_PROOF_PHASES,
  LAUNCH_EFFECT_LIVE_PROOF_PHASE_TIMEOUT_MS,
  launchEffectLiveProofArguments,
  launchEffectLiveProofPhaseMarker,
} from "./effect-live-runner";

const wrapper = readFileSync(
  path.join(__dirname, "effect-live.test.ts"),
  "utf8"
);
const proof = readFileSync(
  path.join(__dirname, "effect-live-proof.ts"),
  "utf8"
);

test("Launch runs production routing and adapter semantics as separate bounded proofs", () => {
  assert.deepEqual(LAUNCH_EFFECT_LIVE_PROOF_PHASES, ["production", "adapter"]);
  assert.equal(LAUNCH_EFFECT_LIVE_PROOF_PHASE_TIMEOUT_MS, 420_000);
  assert.match(
    wrapper,
    /for \(const phase of LAUNCH_EFFECT_LIVE_PROOF_PHASES\)/
  );
  assert.match(wrapper, /launchEffectLiveProofArguments\(\{ cwd, phase \}\)/);
  assert.match(wrapper, /timeout: LAUNCH_EFFECT_LIVE_PROOF_PHASE_TIMEOUT_MS/);
  assert.doesNotMatch(wrapper, /timeout:\s*840_000/);
});

test("each child receives one explicit phase and one observable completion marker", () => {
  for (const phase of LAUNCH_EFFECT_LIVE_PROOF_PHASES) {
    const args = launchEffectLiveProofArguments({ cwd: "/repo", phase });
    assert.equal(args.at(-1), phase);
    assert.equal(
      args.filter((argument) => argument.endsWith("effect-live-proof.ts"))
        .length,
      1
    );
    assert.equal(
      launchEffectLiveProofPhaseMarker(phase),
      `EVRY_LAUNCH_EFFECT_PHASE=${phase}:passed`
    );
  }
});

test("only the production phase owns the Next server and HTTP route scenarios", () => {
  const productionStart = proof.indexOf('if (phase === "production")');
  const adapterStart = proof.indexOf('if (phase === "adapter")');
  const invalidPhaseStart = proof.indexOf(
    "throw new Error(`Unknown Launch effect proof phase"
  );

  assert.ok(productionStart >= 0);
  assert.ok(adapterStart > productionStart);
  assert.ok(invalidPhaseStart > adapterStart);

  const production = proof.slice(productionStart, adapterStart);
  const adapter = proof.slice(adapterStart, invalidPhaseStart);

  assert.match(production, /await startApplication\(\)/);
  assert.match(production, /lateReplay/);
  assert.doesNotMatch(adapter, /startApplication|applyThroughProduction/);
});
