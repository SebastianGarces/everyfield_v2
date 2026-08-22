import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import path from "node:path";
import { test } from "node:test";

import {
  SRC,
  codeOf,
  declaresDirective,
  rel,
} from "@/lib/auth/server-action-surface";
import { chainTo, clientClosure } from "@/lib/testing/client-bundle";

// ============================================================================
// WHAT THIS FILE EXISTS TO CATCH, and why the sibling suite could not.
//
// `template-picker.test.ts` renders the component with `renderToStaticMarkup`
// and asserts the catalog, the copy and the Cursor Pointer Rule. Every one of
// those assertions passed while /tasks/templates was DEAD in a browser:
// the picker is a `"use client"` module, it imported one string
// (`TEMPLATE_REIMPORT_NOTE`) from `@/lib/tasks/import`, that module imports
// `@/db`, and `src/db/index.ts` calls `neon(process.env.DATABASE_URL!)` at
// module scope. So the whole server module — drizzle,
// `@neondatabase/serverless`, the schema, 222 KB — was emitted into a client
// chunk which threw
//
//   Error: No database connection string was provided to `neon()`
//
// while it evaluated, before React could hydrate. The page rendered the
// Next.js error boundary and nothing else. A test renderer cannot see this:
// it runs in node, where `process.env.DATABASE_URL` is set, so the import
// succeeds and the markup is perfect. The shipped page is not the static
// markup.
//
// The rail this replaces is `import "server-only"`, which would make the same
// mistake a build failure. It is NOT usable on `@/lib/tasks/import`, for the
// reason already documented on `src/lib/invitations/core.ts`
// (`src/lib/invitations/service.test.ts:849`): the package's default entry is
// a bare `throw` and resolves to the empty file only under the `react-server`
// condition, so `import.test.ts`, `import-live.test.ts` and both phase-prompt
// suites — bare node processes that import those modules directly — would fail
// at load. This walk is the replacement, and it is the stronger half of the
// pair anyway: it is TRANSITIVE, so it also fails on the second-hop version of
// the bug (picker → some innocent helper → `@/db`), which `server-only` on one
// named file would miss.
//
// It runs in `pnpm test`, a required CI step, so the class of bug now fails
// before a preview exists rather than in a planter's browser.
//
// The walk itself lives in `@/lib/testing/client-bundle` since the same class
// recurred on /phase (#602), and `src/db/client-boundary.bundle.test.ts`
// sweeps EVERY `"use client"` entry with it. This file keeps the
// track-specific rules: the named server modules and the re-export shape.
// ============================================================================

const PICKER = path.join(SRC, "components/tasks/template-picker.tsx");

/** The db handle whose module scope calls `neon()`. The thing to stay away from. */
const DB_ENTRY = path.join(SRC, "db/index.ts");

// ----------------------------------------------------------------------------

test("the template picker is a client entry, so this walk is the right walk", () => {
  // The premise. If the picker ever stops being `"use client"` the leak stops
  // mattering — and so does this test, which must then say so out loud rather
  // than quietly pass on a file it is no longer describing.
  assert.ok(
    declaresDirective(codeOf(PICKER), "use client"),
    `${rel(PICKER)} is no longer a "use client" module`
  );
  assert.ok(existsSync(DB_ENTRY), `${rel(DB_ENTRY)} moved — repoint this test`);
  assert.match(codeOf(DB_ENTRY), /neon\(/, "db entry no longer calls neon()");
});

test("no client-bundle path from the template picker reaches the database", () => {
  const { seen, parents } = clientClosure(PICKER);

  // Sanity: the walk actually walked. A resolver that silently returns null for
  // everything would make the assertion below vacuously true.
  assert.ok(
    seen.has(path.join(SRC, "lib/tasks/templates.ts")),
    "the walk did not even reach templates.ts — the resolver is broken"
  );

  const chain = (target: string): string => chainTo(target, parents);

  assert.ok(
    !seen.has(DB_ENTRY),
    `a "use client" module can reach @/db — this ships neon() to the browser and /tasks/templates dies with "No database connection string was provided":\n  ${chain(DB_ENTRY)}`
  );

  // The specific server modules of this track, named so a failure says WHICH
  // rule was broken rather than only that some path exists.
  for (const serverModule of [
    "lib/tasks/import.ts",
    "lib/tasks/phase-prompt.ts",
  ]) {
    const full = path.join(SRC, serverModule);
    assert.ok(
      !seen.has(full),
      `${serverModule} imports @/db and must never be in a client bundle:\n  ${chain(full)}`
    );
  }
});

test("the strings the picker renders come from the db-free module", () => {
  // The fix, stated as a rule rather than as a path: the picker may not import
  // from `@/lib/tasks/import` at all. Cheaper to read than the walk above, and
  // it fails on the exact edit that caused the outage.
  assert.doesNotMatch(
    codeOf(PICKER),
    /from\s*["']@\/lib\/tasks\/import["']/,
    "template-picker.tsx must import its copy from @/lib/tasks/templates"
  );

  // And the re-export that lets the server callers keep their old path, so the
  // move did not fork the copy into two definitions.
  const IMPORT_MODULE = path.join(SRC, "lib/tasks/import.ts");
  assert.match(
    codeOf(IMPORT_MODULE),
    /export\s*\{[^}]*TEMPLATE_REIMPORT_NOTE[^}]*\}\s*from\s*["']\.\/templates["']/,
    "import.ts must re-export the copy rather than redefine it"
  );
});
