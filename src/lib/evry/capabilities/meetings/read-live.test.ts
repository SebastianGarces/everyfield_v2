import assert from "node:assert/strict";
import { spawnSync, type SpawnSyncReturns } from "node:child_process";
import path from "node:path";
import { before, test } from "node:test";

import { MEETINGS_READ_OPERATION_IDENTITIES } from "./registrations";

const LIVE_DB = process.env.LIVE_DB_TESTS === "1";
const skip = LIVE_DB
  ? false
  : "opt-in: run `LIVE_DB_TESTS=1 pnpm test:live` because real PostgreSQL is required";
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
          "src/lib/evry/capabilities/meetings/read-live-proof.ts"
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
      `Meetings read proof failed\nerror: ${proof.error?.message ?? "none"}\nsignal: ${proof.signal ?? "none"}\nstdout:\n${proof.stdout}\nstderr:\n${proof.stderr}`
    );
    assert.match(proof.stdout, /Meetings read live proof passed/);
  },
  { timeout: 190_000 }
);

for (const identity of MEETINGS_READ_OPERATION_IDENTITIES) {
  for (const layer of [
    "tenancy",
    "permission",
    "execution",
    "idempotency",
    "errors",
    "ui_artifact",
  ] as const) {
    test(`${identity}:${layer}`, { skip }, () => {
      assert.ok(proof);
      assert.match(proof.stdout, new RegExp(`PASS ${identity}:${layer}`));
    });
  }
}
