import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { test } from "node:test";

import {
  DEDICATED_LIVE_SUITES,
  databaseForSuite,
  DOCUMENTS_WIKI_EFFECT_LIVE_SUITE,
  LIVE_SUITE_PHASES,
  liveSuiteDatabases,
  LIVE_SUITES,
  PARALLEL_LIVE_SUITES,
  PEOPLE_EFFECT_LIVE_SUITE,
  suiteForPath,
} from "../../scripts/live-db-names";
import { preflight } from "../../scripts/live-db-preflight";

// ----------------------------------------------------------------------------
// EVERY SUITE THAT OPTS INTO `LIVE_DB_TESTS` IS ACTUALLY RUN, AND IT IS RUN
// THROUGH THE PROXY (#411).
//
// The `Live DB Race Suites` CI job runs `pnpm test:live`, which names its files
// explicitly rather than globbing `src/**/*.test.ts`: the full suite also
// carries corpus tests that need a SEEDED database, not just a migrated one. An
// explicit list drifts — a sixth race suite written next month opts into
// `LIVE_DB_TESTS` and is silently never run, which is the whole failure this
// change exists to end. So the list is asserted against the source, not trusted.
//
// The script's OTHER half is asserted here too: `--import
// ./scripts/live-db-endpoint.ts`. `@/db` is a neon-http client and cannot talk
// to a plain Postgres over TCP, so without that preload every live suite fails
// to connect (or, worse, reaches whatever `DATABASE_URL` happens to name).
// node:test propagates execArgv to the per-file child processes, so the preload
// lands before any suite imports `@/db`. Drop it and the list below is a list of
// suites that cannot run.
// ----------------------------------------------------------------------------

const SELF = "src/db/live-suite-coverage.test.ts";
const PRELOAD = "./scripts/live-db-endpoint.ts";

/** The helper two ministry-teams suites take their opt-in from. */
const SCRATCH_HELPER = "@/lib/testing/ministry-teams-scratch";

/**
 * Does this suite gate itself on `LIVE_DB_TESTS`?
 *
 * TWO SPELLINGS, because there are two. Most suites read the variable
 * themselves; `leader-sync-live` and `responsibilities-live` import `LIVE_DB`
 * from the shared ministry-teams scratch helper, which reads it for them.
 * Matching only the first missed those two — harmless while the check ran one
 * way, and wrong the moment it runs both.
 */
function optsIn(source: string): boolean {
  return (
    source.includes("process.env.LIVE_DB_TESTS") ||
    (source.includes(SCRATCH_HELPER) && /\bLIVE_DB\b/.test(source))
  );
}

test("every suite that opts into LIVE_DB_TESTS is in LIVE_SUITES", () => {
  const root = process.cwd();

  const optedIn = readdirSync(path.join(root, "src"), {
    recursive: true,
    encoding: "utf8",
  })
    .filter((entry) => entry.endsWith(".test.ts"))
    .map((entry) => ({ entry, file: path.join(root, "src", entry) }))
    .filter(({ file }) => optsIn(readFileSync(file, "utf8")))
    .map(({ entry }) => `src/${entry.split(path.sep).join("/")}`)
    // This file names the variable in order to look for it.
    .filter((file) => file !== SELF);

  assert.ok(
    optedIn.length >= 5,
    `expected the known live suites, found ${optedIn.length} — did the opt-in change spelling?`
  );

  // A LIST AGAINST A LIST (#594). This used to search the `test:live` command
  // string for each path, which made a real invariant rest on string-matching a
  // shell command line. `LIVE_SUITES` is data now, so the comparison is direct
  // — and it runs BOTH ways: a suite that opts in and is not listed never runs,
  // and a listed suite that no longer opts in gets a database created for a
  // file that will never connect to it.
  const missing = optedIn.filter(
    (file) => !(LIVE_SUITES as readonly string[]).includes(file)
  );
  assert.deepEqual(
    missing,
    [],
    `these suites read LIVE_DB_TESTS but nothing runs them — add them to LIVE_SUITES in scripts/live-db-names.ts:\n${missing.join("\n")}`
  );

  const stale = (LIVE_SUITES as readonly string[]).filter(
    (file) => !optedIn.includes(file)
  );
  assert.deepEqual(
    stale,
    [],
    `LIVE_SUITES names files that do not opt into LIVE_DB_TESTS:\n${stale.join("\n")}`
  );
});

test("`test:live` preloads the endpoint switch, and nothing in src/ does it instead", () => {
  const runner = readFileSync(
    path.join(process.cwd(), "scripts", "live-db-run.ts"),
    "utf8"
  );

  assert.ok(
    runner.includes("--import") && runner.includes(PRELOAD),
    "#411 round 1: without the preload the neon-http client has no proxy to talk to, so every suite in the list above fails to connect"
  );

  assert.ok(
    readFileSync(
      path.join(process.cwd(), "scripts", "live-db-endpoint.ts"),
      "utf8"
    ).includes("neonConfig.fetchEndpoint"),
    "the preload's whole job is moving `neonConfig.fetchEndpoint`"
  );

  // THE NEGATIVE HALF, which is the point of the move: a test-only endpoint
  // switch must not sit in the request path. `src/db/index.ts` ran
  // `neonConfig.fetchEndpoint = …` at module scope — on every production
  // request — behind a hostname allowlist, so a `NEON_HTTP_PROXY_URL` set by
  // accident in the deployment environment would have redirected live traffic.
  const offenders = readdirSync(path.join(process.cwd(), "src"), {
    recursive: true,
    encoding: "utf8",
  })
    .filter((entry) => entry.endsWith(".ts") || entry.endsWith(".tsx"))
    .filter((entry) =>
      readFileSync(path.join(process.cwd(), "src", entry), "utf8").includes(
        "neonConfig"
      )
    )
    .map((entry) => `src/${entry.split(path.sep).join("/")}`)
    .filter((file) => file !== SELF);

  assert.deepEqual(
    offenders,
    [],
    "#411 round 1: `neonConfig` belongs to the test runner's preload, never to a module the app imports on a request"
  );
});

// ----------------------------------------------------------------------------
// AND EACH OF THOSE SUITES OWNS ITS OWN DATABASE (#594).
//
// The list above says every opted-in suite RUNS. These say no two of them run
// against the same database — which is the property that stopped
// `seat-owner-uniqueness`'s whole-table census going red on a row a sibling
// process had committed and not yet swept.
//
// The derivation is asserted here rather than the NAMES, deliberately: a
// checked-in list of fourteen database names would be a second source of truth
// for exactly the thing `scripts/live-db-names.ts` exists to be the only source
// of. What matters is that the function is total over the real suite list, that
// it separates them, and that both consumers actually call it.
// ----------------------------------------------------------------------------

test("every live suite derives its own database, and no two collide", () => {
  const files: readonly string[] = LIVE_SUITES;
  const databases = liveSuiteDatabases();

  assert.equal(
    databases.length,
    files.length,
    "the derivation is not total over the `test:live` list"
  );

  const byDatabase = new Map<string, string[]>();
  for (const [index, database] of databases.entries()) {
    byDatabase.set(database, [
      ...(byDatabase.get(database) ?? []),
      files[index],
    ]);
  }

  const collisions = [...byDatabase.entries()].filter(
    ([, sharing]) => sharing.length > 1
  );

  assert.deepEqual(
    collisions,
    [],
    `these suites would share one database, which is the #594 race exactly:\n${collisions
      .map(([database, sharing]) => `${database}: ${sharing.join(", ")}`)
      .join("\n")}`
  );

  // Postgres truncates past 63 bytes, and two names that truncate alike are a
  // shared database wearing two names. `databaseForSuite` throws rather than
  // let that happen; this proves the real list is clear of it.
  for (const file of files) {
    assert.doesNotThrow(
      () => databaseForSuite(file),
      `${file} has no database`
    );
  }

  // …and that the guard is real rather than merely present. A deeply nested
  // suite added next year gets a loud error here instead of a name Postgres
  // quietly shortens into a sibling's.
  assert.throws(
    () =>
      databaseForSuite(
        `src/lib/${"deeply-nested-domain/".repeat(4)}some-race.test.ts`
      ),
    /identifier limit/,
    "a path whose database name overruns 63 bytes must be refused, not truncated"
  );

  assert.throws(
    () => databaseForSuite("scripts/not-a-suite.ts"),
    /not a live suite path/,
    "only suites under src/ get a database"
  );
});

test("the monolithic effect proofs own the first phase without dropping a live suite", () => {
  assert.deepEqual(DEDICATED_LIVE_SUITES, [
    PEOPLE_EFFECT_LIVE_SUITE,
    DOCUMENTS_WIKI_EFFECT_LIVE_SUITE,
  ]);
  for (const suite of DEDICATED_LIVE_SUITES) {
    assert.equal(PARALLEL_LIVE_SUITES.includes(suite), false);
  }

  const phased = LIVE_SUITE_PHASES.flat();
  assert.deepEqual(phased.toSorted(), [...LIVE_SUITES].toSorted());
  assert.equal(new Set(phased).size, LIVE_SUITES.length);

  const runner = readFileSync(
    path.join(process.cwd(), "scripts", "live-db-run.ts"),
    "utf8"
  );
  assert.match(runner, /for \(const suites of LIVE_SUITE_PHASES\)/);
});

test("the preload repoints exactly the listed suites, from any working directory", () => {
  // MEMBERSHIP IS THE LIST, and this is the test that keeps it that way. The
  // preload once decided with a shape test — `src/….test.ts` — which fails in
  // both directions:
  //
  //   too wide: some 250 files match, including live suites deliberately left
  //   out of the lane. One of those would be handed a database nobody created,
  //   find it unreachable, SKIP, and pass.
  //
  //   too narrow: the shape was tested against `process.cwd()`, so a run
  //   started from a subdirectory matched nothing, left every child on the
  //   shared base URL, and restored the #594 race with the lane green.
  for (const suite of LIVE_SUITES) {
    assert.equal(
      suiteForPath(path.join(process.cwd(), suite)),
      suite,
      `${suite} is in LIVE_SUITES but the preload would not repoint it`
    );
  }

  // A live suite that is NOT in the lane — it gates on reachability alone and
  // needs a seeded corpus, so it is left out deliberately. It must not be
  // handed a database.
  assert.equal(
    suiteForPath(
      path.join(process.cwd(), "src/lib/tasks/phase-prompt-live.test.ts")
    ),
    null,
    "a suite outside LIVE_SUITES must keep the base DATABASE_URL, not get one nobody created"
  );

  assert.equal(
    suiteForPath(path.join(process.cwd(), "scripts/live-db-run.ts")),
    null,
    "the runner is not a suite"
  );

  // The cwd half, stated as its own claim: the answer comes from the repo root
  // this module resolves for itself, so where the command was typed is not part
  // of it.
  const cwd = process.cwd();
  try {
    process.chdir(path.join(cwd, "src"));
    assert.equal(
      suiteForPath(path.join(cwd, LIVE_SUITES[0])),
      LIVE_SUITES[0],
      "running from a subdirectory must not stop the preload repointing a suite"
    );
  } finally {
    process.chdir(cwd);
  }
});

test("`test:live` will not start the runner unless the databases answer", async () => {
  // WHY THIS IS LOAD-BEARING AND NOT BELT-AND-BRACES. Every live suite skips
  // itself when `databaseReachable()` is false — right for a laptop with no
  // Postgres, and a silent green for a CI job whose per-suite databases were
  // never created. The preflight turns that into a non-zero exit before a
  // single suite gets the chance to skip.
  //
  // ASSERTED BY RUNNING IT, not by reading the command line for an `&&`. The
  // earlier spelling of this test checked that the preflight appeared before
  // `--test` in a shell string, which stayed true if the `&&` became a `;` —
  // the preflight would run, run first, and have its exit code discarded.
  // `preflight()` is a function now, so the property can be exercised: point it
  // at a server that is not there and it must report rather than pass.
  const base = process.env.DATABASE_URL;
  process.env.DATABASE_URL =
    "postgresql://nobody:nobody@127.0.0.1:1/live_db_preflight_probe";

  try {
    const failure = await preflight();
    assert.ok(
      failure,
      "#594: the preflight must refuse an unreachable server — without it the lane SKIPS every suite and reports success"
    );
  } finally {
    if (base === undefined) delete process.env.DATABASE_URL;
    else process.env.DATABASE_URL = base;
  }
});

test("the lane runs the preflight before it runs any suite", () => {
  const runner = readFileSync(
    path.join(process.cwd(), "scripts", "live-db-run.ts"),
    "utf8"
  );

  assert.ok(
    runner.indexOf("preflight()") < runner.indexOf("spawnSync("),
    "the preflight has to gate the runner, not sit beside it"
  );
});

test("CI builds those databases from the same derivation the runner reads", () => {
  const workflow = readFileSync(
    path.join(process.cwd(), ".github/workflows/pull-request-checks.yml"),
    "utf8"
  );

  // The job used to apply migrations to one database with an inline psql loop.
  // A second inline loop naming the per-suite databases would be a hand-kept
  // copy of `live-db-names.ts`, and a copy that drifts leaves a suite pointed
  // at a database nobody made — so the workflow calls the script instead.
  assert.ok(
    workflow.includes("scripts/live-db-prepare.sh"),
    "#594: the Live DB job must prepare the per-suite databases through the shared script"
  );
});
