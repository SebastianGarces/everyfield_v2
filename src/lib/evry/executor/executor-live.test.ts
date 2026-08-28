import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import path from "node:path";
import { test } from "node:test";

const LIVE_DB = process.env.LIVE_DB_TESTS === "1";
const skip = LIVE_DB
  ? false
  : "opt-in: run `LIVE_DB_TESTS=1 pnpm test:live` — real Postgres is required";

// The proof deliberately serializes authority mutations against one session
// and takes ~30s against an otherwise idle local proxy. CI runs every live
// suite concurrently against the same Postgres container, so 60s was only a
// 2x contention allowance and #800 exhausted it before the proof could print.
// Four times the measured isolated runtime keeps the timeout a deadlock guard
// without turning ordinary shared-runner contention into a false failure.
const LIVE_PROOF_TIMEOUT_MS = 120_000;

test(
  "the execution route survives real Postgres races and replay",
  { skip },
  () => {
    const proof = spawnSync(
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
          "src/lib/evry/executor/executor-live-proof.ts"
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
      `live executor proof failed\nerror: ${proof.error?.message ?? "none"}\nsignal: ${proof.signal ?? "none"}\nstdout:\n${proof.stdout}\nstderr:\n${proof.stderr}`
    );
    assert.match(proof.stdout, /Evry executor live request proof passed/);
  }
);
