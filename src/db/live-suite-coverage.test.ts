import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { test } from "node:test";

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

function liveScript(): string {
  const script = (
    JSON.parse(
      readFileSync(path.join(process.cwd(), "package.json"), "utf8")
    ) as {
      scripts: Record<string, string>;
    }
  ).scripts["test:live"];

  assert.ok(script, "package.json has no `test:live` script");
  return script;
}

test("every suite that opts into LIVE_DB_TESTS is in the `test:live` script", () => {
  const script = liveScript();
  const root = process.cwd();

  const optedIn = readdirSync(path.join(root, "src"), {
    recursive: true,
    encoding: "utf8",
  })
    .filter((entry) => entry.endsWith(".test.ts"))
    .map((entry) => ({ entry, file: path.join(root, "src", entry) }))
    .filter(({ file }) =>
      readFileSync(file, "utf8").includes("process.env.LIVE_DB_TESTS")
    )
    .map(({ entry }) => `src/${entry.split(path.sep).join("/")}`)
    // This file names the variable in order to look for it.
    .filter((file) => file !== SELF);

  assert.ok(
    optedIn.length >= 5,
    `expected the known live suites, found ${optedIn.length} — did the opt-in change spelling?`
  );

  const missing = optedIn.filter((file) => !script.includes(file));
  assert.deepEqual(
    missing,
    [],
    `these suites read LIVE_DB_TESTS but no CI job runs them — add them to the \`test:live\` script:\n${missing.join("\n")}`
  );
});

test("`test:live` preloads the endpoint switch, and nothing in src/ does it instead", () => {
  assert.ok(
    liveScript().includes(`--import ${PRELOAD}`),
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
