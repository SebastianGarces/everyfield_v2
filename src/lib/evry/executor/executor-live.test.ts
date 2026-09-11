import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { test } from "node:test";

import {
  EXECUTOR_LIVE_PROOF_PHASES,
  EXECUTOR_LIVE_PROOF_PHASE_TIMEOUT_MS,
  executorLiveProofArguments,
  executorLiveProofPhaseMarker,
} from "./executor-live-runner";

const LIVE_DB = process.env.LIVE_DB_TESTS === "1";
const skip = LIVE_DB
  ? false
  : "opt-in: run `LIVE_DB_TESTS=1 pnpm test:live` — real Postgres is required";

test(
  "the execution route survives real Postgres races and replay",
  { skip },
  () => {
    const cwd = process.cwd();
    for (const phase of EXECUTOR_LIVE_PROOF_PHASES) {
      const startedAt = Date.now();
      const proof = spawnSync(
        process.execPath,
        executorLiveProofArguments({ cwd, phase }),
        {
          cwd,
          encoding: "utf8",
          env: process.env,
          timeout: EXECUTOR_LIVE_PROOF_PHASE_TIMEOUT_MS,
        }
      );

      assert.equal(
        proof.status,
        0,
        `live executor ${phase} proof failed\nerror: ${proof.error?.message ?? "none"}\nsignal: ${proof.signal ?? "none"}\nstdout:\n${proof.stdout}\nstderr:\n${proof.stderr}`
      );
      assert.match(
        proof.stdout,
        new RegExp(executorLiveProofPhaseMarker(phase, "started"))
      );
      assert.match(
        proof.stdout,
        new RegExp(executorLiveProofPhaseMarker(phase, "passed"))
      );
      process.stdout.write(
        `Executor ${phase} live proof passed in ${Date.now() - startedAt}ms\n`
      );
    }
  }
);
