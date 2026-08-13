import assert from "node:assert/strict";
import { existsSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { test } from "node:test";

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
// ============================================================================

const SRC = path.join(process.cwd(), "src");
const PICKER = path.join(SRC, "components/tasks/template-picker.tsx");

/** The db handle whose module scope calls `neon()`. The thing to stay away from. */
const DB_ENTRY = path.join(SRC, "db/index.ts");

const CODE_CACHE = new Map<string, string>();

/** A module with its comments removed — this file's own prose names `@/db`. */
function codeOf(file: string): string {
  const cached = CODE_CACHE.get(file);
  if (cached !== undefined) return cached;

  const code = readFileSync(file, "utf8")
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/(^|\s)\/\/.*$/gm, "$1");
  CODE_CACHE.set(file, code);
  return code;
}

/**
 * Specifiers whose module is actually EMITTED: value imports, side-effect
 * imports, re-exports and `import()`. `import type` is skipped because
 * TypeScript erases it — which is precisely why `templates.ts` may keep its
 * `import type { TaskCategory } from "@/db/schema/tasks"` and still be safe to
 * reach from the browser.
 */
function valueSpecifiers(code: string): string[] {
  const statement =
    /^\s*(?:import|export)\s+(?!type\b)[^;]*?\bfrom\s*["']([^"']+)["']/gm;
  const sideEffect = /^\s*import\s*["']([^"']+)["']/gm;
  const dynamic = /\bimport\(\s*["']([^"']+)["']\s*\)/g;

  return [statement, sideEffect, dynamic].flatMap((pattern) =>
    [...code.matchAll(pattern)].map(([, specifier]) => specifier)
  );
}

/** The file a specifier names, or `null` for a bare package. */
function resolveModule(from: string, specifier: string): string | null {
  const base = specifier.startsWith("@/")
    ? path.join(SRC, specifier.slice(2))
    : specifier.startsWith(".")
      ? path.resolve(path.dirname(from), specifier)
      : null;
  if (base === null) return null;

  for (const candidate of [
    base,
    `${base}.ts`,
    `${base}.tsx`,
    path.join(base, "index.ts"),
    path.join(base, "index.tsx"),
  ]) {
    if (existsSync(candidate) && statSync(candidate).isFile()) return candidate;
  }
  return null;
}

/**
 * A module's directive prologue — the run of string literals at the top.
 * Anchored there so `"use server"` inside an array or a regex further down
 * cannot be mistaken for a directive, and written without requiring the
 * semicolon: `"use server"` without one is the same directive (#265 r2).
 */
const PROLOGUE = /^(?:\s*(?:"[^"\n]*"|'[^'\n]*')\s*;?)*/;

function declaresDirective(code: string, directive: string): boolean {
  const prologue = PROLOGUE.exec(code)?.[0] ?? "";
  return new RegExp(`["']${directive}["']`).test(prologue);
}

const rel = (full: string) => path.relative(process.cwd(), full);

/**
 * Every module the browser would load for `entry`, with the parent that pulled
 * each one in so a failure can print the chain rather than just the verdict.
 *
 * A `"use server"` module is a BOUNDARY, not an import: the client receives a
 * reference and the body stays on the server. So picker →
 * `app/(dashboard)/tasks/actions.ts` → `@/db` is not a bundle path, and
 * traversing it would make this test fail on correct code.
 */
function clientClosure(entry: string): {
  seen: Set<string>;
  parents: Map<string, string>;
} {
  const seen = new Set<string>();
  const parents = new Map<string, string>();
  const queue = [entry];

  while (queue.length > 0) {
    const full = queue.pop()!;
    if (seen.has(full)) continue;
    seen.add(full);

    if (full !== entry && declaresDirective(codeOf(full), "use server")) {
      continue;
    }

    for (const specifier of valueSpecifiers(codeOf(full))) {
      const resolved = resolveModule(full, specifier);
      if (resolved === null || seen.has(resolved)) continue;
      parents.set(resolved, full);
      queue.push(resolved);
    }
  }

  return { seen, parents };
}

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

  /** picker → … → target, so a failure names the edge to delete. */
  const chain = (target: string): string => {
    const steps = [target];
    let at = parents.get(target);
    while (at !== undefined && !steps.includes(at)) {
      steps.push(at);
      at = parents.get(at);
    }
    return steps.reverse().map(rel).join("\n  → ");
  };

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
