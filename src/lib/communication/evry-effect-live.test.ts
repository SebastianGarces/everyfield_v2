import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import path from "node:path";
import { test } from "node:test";

const LIVE_DB = process.env.LIVE_DB_TESTS === "1";

test(
  "Communication effects converge across concurrency, retries, and response loss",
  {
    skip: LIVE_DB
      ? false
      : "opt-in: run `LIVE_DB_TESTS=1 pnpm test:live` — real Postgres is required",
  },
  () => {
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
          "src/lib/communication/evry-effect-live-proof.ts"
        ),
      ],
      {
        cwd: process.cwd(),
        encoding: "utf8",
        env: process.env,
        timeout: 60_000,
      }
    );
    assert.equal(
      proof.status,
      0,
      `Communication effect live proof failed\nerror: ${proof.error?.message ?? "none"}\nsignal: ${proof.signal ?? "none"}\nstdout:\n${proof.stdout}\nstderr:\n${proof.stderr}`
    );
    assert.match(proof.stdout, /Communication effect live proof passed/);
  }
);
