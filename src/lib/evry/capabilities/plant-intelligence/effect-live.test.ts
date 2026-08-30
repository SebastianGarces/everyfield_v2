import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import path from "node:path";
import { before, test } from "node:test";

import { PLANT_INTELLIGENCE_EFFECT_IDENTITIES } from "./catalog";

const LIVE_DB = process.env.LIVE_DB_TESTS === "1";
const LIVE_LAYERS = ["execution", "idempotency", "errors"] as const;
let outcomes: ReadonlySet<string> | null = null;

before(() => {
  if (!LIVE_DB) return;
  const proof = spawnSync(
    process.execPath,
    [
      "--no-warnings",
      "--import",
      "tsx",
      "--import",
      "./scripts/live-db-endpoint.ts",
      path.join(
        process.cwd(),
        "src/lib/evry/capabilities/plant-intelligence/effect-live-proof.ts"
      ),
    ],
    {
      cwd: process.cwd(),
      encoding: "utf8",
      env: process.env,
      timeout: 180_000,
    }
  );
  assert.equal(
    proof.status,
    0,
    `Plant Intelligence live proof failed\nerror: ${proof.error?.message ?? "none"}\nsignal: ${proof.signal ?? "none"}\nstdout:\n${proof.stdout}\nstderr:\n${proof.stderr}`
  );
  assert.match(proof.stdout, /Plant Intelligence effect live proof passed/);
  const encoded = /^EVRY_PLANT_INTELLIGENCE_EFFECT_OUTCOMES=(.+)$/m.exec(
    proof.stdout
  )?.[1];
  assert.ok(encoded, "Plant Intelligence proof returned no outcomes");
  const parsed = JSON.parse(encoded) as unknown;
  assert.ok(Array.isArray(parsed));
  assert.ok(parsed.every((outcome) => typeof outcome === "string"));
  outcomes = new Set(parsed);
});

for (const identity of Object.values(PLANT_INTELLIGENCE_EFFECT_IDENTITIES)) {
  for (const layer of LIVE_LAYERS) {
    test(
      `${identity}:${layer}:live`,
      {
        skip: LIVE_DB
          ? false
          : "opt-in: run `LIVE_DB_TESTS=1 pnpm test:live` — real Postgres is required",
      },
      () => {
        assert.ok(outcomes?.has(`${identity}:${layer}`));
      }
    );
  }
}
