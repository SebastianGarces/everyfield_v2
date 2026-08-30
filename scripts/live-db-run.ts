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
// So the list is data (`LIVE_SUITES`), the ordering is control flow, and the
// coverage test compares a list against a list.
//
// WHY IT SPAWNS node:test RATHER THAN IMPORTING IT. Each suite needs its own
// CHILD PROCESS — that is what makes the fixtures of one invisible to the
// others — and it needs `scripts/live-db-endpoint.ts` preloaded BEFORE it
// imports `@/db`. node:test's own file runner does both, propagating execArgv
// to the children it forks, so the job here is to hand it the right argv and
// pass its exit code through.
//
// WHY THE FILES RUN ONE AT A TIME. Their databases are separate, but their
// GitHub job still shares one small runner and one neon-http proxy. Letting
// node:test choose CPU-wide concurrency made the longest effect proofs starve
// behind the rest of the lane until their child-process deadlines expired.
// Serial files keep each proof's timeout about the proof itself, while the
// assertions inside a proof still exercise the intended PostgreSQL races.
// ============================================================================

import { spawnSync } from "node:child_process";
import path from "node:path";

import { LIVE_SUITES, REPO_ROOT } from "./live-db-names";
import { preflight } from "./live-db-preflight";

async function main(): Promise<number> {
  const failure = await preflight();
  if (failure) {
    console.error(`\n${failure}\n`);
    return 1;
  }

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
      "--test-concurrency=1",
      ...LIVE_SUITES,
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
