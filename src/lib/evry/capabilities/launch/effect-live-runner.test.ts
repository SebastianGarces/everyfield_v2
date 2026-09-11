import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
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
    assert.ok(args.includes("--experimental-test-module-mocks"));
    const routePreload = args.indexOf(
      "./src/lib/evry/capabilities/launch/effect-live-route-runner.ts"
    );
    assert.ok(routePreload > 0 && routePreload < args.length - 2);
    assert.equal(args[routePreload - 1], "--import");
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

test("only the production phase owns the production route scenarios", () => {
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

  assert.match(production, /lateReplay/);
  assert.doesNotMatch(adapter, /applyThroughProduction/);
  assert.doesNotMatch(
    proof,
    /startApplication|node:child_process|live-next-db-endpoint/
  );
});

test("the route runner isolates request cookies and calls real session-first routes without a provider key", () => {
  const result = spawnSync(
    process.execPath,
    [
      "--no-warnings",
      "--experimental-test-module-mocks",
      "--import",
      "tsx",
      "--import",
      "./src/lib/evry/capabilities/launch/effect-live-route-runner.ts",
      "--eval",
      String.raw`
        (async () => {
          const assert = require("node:assert/strict");
          const { launchLiveRequests, launchLiveRoute, launchLiveModel } =
            require("./src/lib/evry/capabilities/launch/effect-live-route-runner.ts");
          const { getSessionToken } = require("./src/lib/auth/cookies.ts");
          const tokens = await Promise.all(["first", "second"].map((token) =>
            launchLiveRequests.run(new Request("http://launch-live.invalid", {
              method: "POST",
              headers: { cookie: "session=" + token },
              body: JSON.stringify({ token }),
            }), async () => {
              await new Promise(resolve => setImmediate(resolve));
              assert.equal(await getSessionToken(), token);
              assert.deepEqual(await launchLiveRequests.getStore().json(), { token });
              return getSessionToken();
            })
          ));
          assert.deepEqual(tokens, ["first", "second"]);
          await assert.rejects(getSessionToken(), /no request context/);
          for (const path of [
            "/api/evry/conversations",
            "/api/evry/plans/invalid/confirm",
            "/api/evry/plans/invalid/execute",
          ]) {
            const response = await launchLiveRoute(new Request(
              "http://launch-live.invalid" + path,
              { method: "POST", body: "invalid json" }
            ));
            assert.equal(response.status, 401, path);
          }
          assert.equal(launchLiveModel.calls.length, 0);
          const { generateEvryModelTurn } =
            require("./src/lib/evry/capabilities/model-turn.ts");
          assert.deepEqual(await generateEvryModelTurn({ context: {}, reads: [] }),
            { kind: "prepare" });
          assert.equal(launchLiveModel.calls.length, 1);
        })().catch(error => { console.error(error); process.exitCode = 1; });
      `,
    ],
    {
      cwd: process.cwd(),
      encoding: "utf8",
      timeout: 60_000,
      env: {
        ...process.env,
        DATABASE_URL: "postgresql://test:test@localhost:1/unused",
        OPENAI_API_KEY: "",
        RESEND_API_KEY: "re_live_test_placeholder",
        LANGFUSE_PUBLIC_KEY: "",
        LANGFUSE_SECRET_KEY: "",
        LANGFUSE_BASE_URL: "",
      },
    }
  );
  assert.equal(
    result.status,
    0,
    `${result.error ?? ""}\n${result.stdout}\n${result.stderr}`
  );
});
