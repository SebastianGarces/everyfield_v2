// ============================================================================
// `pnpm test:live` — THE WHOLE LANE, IN ONE ENTRY POINT (#594).
//
// It does two things in order: refuse to start unless every per-suite database
// answers, then run the suites.
//
// WHY THE LANE IS A SCRIPT AND NOT A package.json STRING. It used to be one
// 1,400-character command line carrying two `tsx` invocations, an `&&`, an
// `--import` and fourteen quoted paths — and three consumers read it BACK as
// text to recover facts from it, one of them by regex. That made real
// invariants rest on string matching: swapping the `&&` for a `;` would have
// discarded the preflight's exit code and restored the silent green it exists
// to prevent, while every assertion about the script still passed.
//
// So the list and its ordered execution phases are data
// (`LIVE_SUITE_PHASES`), the ordering is control flow, and the coverage test
// compares lists directly.
//
// WHY IT SPAWNS node:test RATHER THAN IMPORTING IT. Each suite needs its own
// CHILD PROCESS — that is what makes the fixtures of one invisible to the
// others — and it needs `scripts/live-db-endpoint.ts` preloaded BEFORE it
// imports `@/db`. node:test's own file runner does both, propagating execArgv
// to the children it forks, so the job here is to hand it the right argv and
// pass its exit code through.
//
// WHY PHASES. The proof wrappers that spawn another Node or Next process each
// get a singleton phase, so the small GitHub runner and neon-http proxy cannot
// starve their child deadlines. Ordinary suites retain file-level parallelism;
// every suite still owns a separate database, and concurrency inside each
// proof still exercises the intended PostgreSQL races.
// ============================================================================

import { spawnSync } from "node:child_process";
import path from "node:path";

import { LIVE_SUITE_PHASES, REPO_ROOT } from "./live-db-names";
import { preflight } from "./live-db-preflight";

async function main(): Promise<number> {
  const failure = await preflight();
  if (failure) {
    console.error(`\n${failure}\n`);
    return 1;
  }

  for (const suites of LIVE_SUITE_PHASES) {
    const status = runSuites(suites);
    if (status !== 0) return status;
  }
  return 0;
}

function runSuites(suites: readonly string[]): number {
  // `--import` (not `--require`): node:test propagates it to the per-file child
  // processes, so the endpoint switch and the DATABASE_URL rewrite land before
  // any suite imports `@/db`.
  const result = spawnSync(
    process.execPath,
    [
      path.join(REPO_ROOT, "node_modules", "tsx", "dist", "cli.mjs"),
      "--env-file-if-exists=.env.local",
      "--import",
      "./scripts/live-db-endpoint.ts",
      "--test",
      ...suites,
    ],
    { cwd: REPO_ROOT, stdio: "inherit" }
  );

  if (result.error) throw result.error;

  // A signalled child reports a null status; treat that as failure rather than
  // letting `?? 0` read a killed run as a pass.
  return result.status ?? 1;
}

main().then(
  (code) => {
    process.exitCode = code;
  },
  (error: unknown) => {
    console.error(error);
    process.exitCode = 1;
  }
);
