import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { test } from "node:test";

import { localNeonHttpEndpoint } from "@/db/connection";

// ----------------------------------------------------------------------------
// The one rule that decides whether the neon-http driver talks to Neon or to a
// local proxy (#411). It runs at module scope in `src/db/index.ts`, on every
// request in production, so the property that matters most is the NEGATIVE one:
// a real Neon host must come back `null` and keep the driver's own endpoint.
// ----------------------------------------------------------------------------

const NEON =
  "postgresql://user:pw@ep-cool-name-123456.us-east-2.aws.neon.tech/db?sslmode=require";

test("a real Neon host is left alone — production takes the driver's own endpoint", () => {
  assert.equal(localNeonHttpEndpoint(NEON), null);
});

test("a local host is routed to the proxy that speaks Neon's HTTP protocol", () => {
  assert.equal(
    localNeonHttpEndpoint("postgresql://postgres:postgres@localhost:5432/main"),
    "http://localhost:4444/sql"
  );
  assert.equal(
    localNeonHttpEndpoint("postgresql://postgres:postgres@127.0.0.1:5432/main"),
    "http://127.0.0.1:4444/sql"
  );
  assert.equal(
    localNeonHttpEndpoint(
      "postgresql://postgres:postgres@db.localtest.me:5432/main"
    ),
    "http://db.localtest.me:4444/sql"
  );
});

test("an explicit NEON_HTTP_PROXY_URL wins, for a proxy anywhere", () => {
  assert.equal(
    localNeonHttpEndpoint(NEON, "http://localhost:9999/sql"),
    "http://localhost:9999/sql"
  );
});

test("a missing or malformed URL never throws — the driver owns that error", () => {
  assert.equal(localNeonHttpEndpoint(undefined), null);
  assert.equal(localNeonHttpEndpoint(""), null);
  assert.equal(localNeonHttpEndpoint("not a url"), null);
});

// ----------------------------------------------------------------------------
// §5 — the seam is worth nothing if CI does not run the suites through it.
//
// The `Live DB Race Suites` job runs `pnpm test:live`, which names its files
// explicitly rather than globbing `src/**/*.test.ts`: the full suite also
// carries corpus tests that need a SEEDED database, not just a migrated one.
// An explicit list drifts — a sixth race suite written next month opts into
// `LIVE_DB_TESTS` and is silently never run, which is the whole failure this
// change exists to end. So the list is asserted against the source, not
// trusted.
// ----------------------------------------------------------------------------

const SELF = "src/db/connection.test.ts";

test("§5 every suite that opts into LIVE_DB_TESTS is in the `test:live` script", () => {
  const root = process.cwd();
  const script = (
    JSON.parse(readFileSync(path.join(root, "package.json"), "utf8")) as {
      scripts: Record<string, string>;
    }
  ).scripts["test:live"];

  assert.ok(script, "package.json has no `test:live` script");

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
