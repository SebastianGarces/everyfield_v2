import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import path from "node:path";
import { test } from "node:test";

const LIVE_DB = process.env.LIVE_DB_TESTS === "1";
const skip = LIVE_DB
  ? false
  : "opt-in: run `LIVE_DB_TESTS=1 pnpm test:live` — real Postgres is required";

// The proof deliberately serializes authority mutations against one session.
// It took 117s on the hosted runner even after its suite was isolated, leaving
// the old 120s deadline no operational margin. Twice that measured hosted time
// remains a deadlock guard without turning ordinary runner variance into a
// false failure.
const LIVE_PROOF_TIMEOUT_MS = 240_000;

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
