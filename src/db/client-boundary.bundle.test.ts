import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import path from "node:path";
import { test } from "node:test";

import {
  SRC,
  chainTo,
  clientClosure,
  clientEntries,
  codeOf,
  rel,
} from "@/lib/testing/client-bundle";

// ============================================================================
// NO "use client" MODULE MAY REACH @/db. Twice now a client component imported
// one innocent value from a module that also imports `@/db`, the whole server
// graph followed it into a client chunk, and `neon(process.env.DATABASE_URL!)`
// threw at module evaluation in the browser — killing /tasks/templates first
// and /phase second (#602). `template-picker.bundle.test.ts` guards the first
// entry by name and documents why the walk beats `import "server-only"`; this
// sweep is the generalization: every client entry, one rule, so the third
// instance of this bug fails in `pnpm test` instead of in a planter's browser.
// ============================================================================

/** The db handle whose module scope calls `neon()`. The thing to stay away from. */
const DB_ENTRY = path.join(SRC, "db/index.ts");

test("the guarded entry exists and still calls neon() at module scope", () => {
  assert.ok(existsSync(DB_ENTRY), `${rel(DB_ENTRY)} moved — repoint this test`);
  assert.match(codeOf(DB_ENTRY), /neon\(/, "db entry no longer calls neon()");
});

test('no "use client" module anywhere in src can reach @/db', () => {
  const entries = clientEntries();

  // Sanity: the enumeration actually enumerated. An app this size has dozens
  // of client modules; a scan that found a handful is scanning the wrong tree.
  assert.ok(
    entries.length >= 20,
    `only ${entries.length} "use client" modules found — the entry scan is broken`
  );

  const offenders: string[] = [];
  for (const entry of entries) {
    const { seen, parents } = clientClosure(entry);
    if (seen.has(DB_ENTRY)) {
      offenders.push(`${rel(entry)}:\n  ${chainTo(DB_ENTRY, parents)}`);
    }
  }

  assert.deepEqual(
    offenders,
    [],
    `a "use client" module can reach @/db — this ships neon() to the browser and the page dies with "No database connection string was provided". Move the value it wants into a db-free module (the planter-checkin-db.ts / templates.ts split):\n\n${offenders.join("\n\n")}`
  );
});
