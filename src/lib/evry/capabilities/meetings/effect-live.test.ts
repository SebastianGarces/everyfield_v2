import assert from "node:assert/strict";
import { spawnSync, type SpawnSyncReturns } from "node:child_process";
import path from "node:path";
import { before, test } from "node:test";

import { MEETINGS_ACTION_CONTRACTS } from "./catalog";

const LIVE_DB = process.env.LIVE_DB_TESTS === "1";
const LIVE_PROOF_TIMEOUT_MS = 420_000;
const skip = LIVE_DB
  ? false
  : "opt-in: run `LIVE_DB_TESTS=1 pnpm test:live` — real Postgres is required";
let proof: SpawnSyncReturns<string> | null = null;

before(
  () => {
    if (!LIVE_DB) return;
    proof = spawnSync(
      process.execPath,
      [
        "--no-warnings",
        "--experimental-test-module-mocks",
        "--import",
        "tsx",
        "--import",
        "./scripts/live-db-endpoint.ts",
        path.join(
          process.cwd(),
          "src/lib/evry/capabilities/meetings/effect-live-proof.ts"
        ),
      ],
      {
        cwd: process.cwd(),
        encoding: "utf8",
        env: process.env,
        timeout: LIVE_PROOF_TIMEOUT_MS,
      }
    );
    assert.equal(
      proof.status,
      0,
      `Meetings live proof failed\nerror: ${proof.error?.message ?? "none"}\nsignal: ${proof.signal ?? "none"}\nstdout:\n${proof.stdout}\nstderr:\n${proof.stderr}`
    );
    assert.match(proof.stdout, /Meetings atomic effect live proof passed/);
    assert.match(
      proof.stdout,
      /PASS meetings:finalization-repeat-notification-convergence/
    );
    assert.match(
      proof.stdout,
      /PASS meetings:finalization-notification-drift-matrix/
    );
  },
  { timeout: LIVE_PROOF_TIMEOUT_MS + 10_000 }
);

for (const contract of Object.values(MEETINGS_ACTION_CONTRACTS)) {
  for (const layer of [
    "tenancy",
    "permission",
    "execution",
    "idempotency",
    "errors",
  ] as const) {
    test(`${contract.operationId}:${layer}`, { skip }, () => {
      assert.ok(proof);
      assert.match(
        proof.stdout,
        new RegExp(`PASS ${contract.operationId}:${layer}`)
      );
    });
  }
}
