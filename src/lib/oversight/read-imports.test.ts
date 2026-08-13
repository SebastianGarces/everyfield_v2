import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { test } from "node:test";

// ============================================================================
// The no-DATABASE_URL seam, enforced instead of described.
//
// `read.ts` and `sending-churches.ts` both open with a paragraph promising that
// every value import reaching `@/db` is deferred into the async read that needs
// it, so the module can be imported and its contract asserted without a
// database. The promise was FALSE in `read.ts`: `getLaunchDatesForChurches`
// (`@/lib/launch/queries`, whose first line is `@/db`) sat at the top of the
// file, so `read.test.ts` needed a live connection string to assert a SQL
// predicate and a handful of string labels — and any run without one failed the
// whole file, not one case.
//
// A comment cannot notice that. This walks the STATIC import list of each
// module and refuses anything that reaches `@/db`, one hop out, so the next
// convenient top-level import fails here rather than quietly costing the suite
// its seam.
//
// It is a STATIC walk and says so: it reads `import ... from "..."` lines, so a
// specifier built at runtime or a re-export barrel it cannot resolve is outside
// what it can see. It shares that limitation with
// `src/lib/meetings/client-boundary.test.ts`, which names it too.
// ============================================================================

const ROOT = process.cwd();
const SRC = path.join(ROOT, "src");

/** Modules whose header promises the seam. */
const SEAM_MODULES = ["read.ts", "sending-churches.ts"] as const;

/** Specifiers that ARE the database client, or are known to open with it. */
const DB_SPECIFIERS = new Set(["@/db"]);

function read(file: string): string {
  return readFileSync(file, "utf8");
}

/** Every `@/...` specifier statically imported for its VALUES. */
function valueImports(source: string): string[] {
  const withoutComments = source
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/\/\/.*$/gm, "");
  return [
    ...withoutComments.matchAll(
      /^import\s+(?!type\b)[^;]*?from\s+"(@\/[^"]+)"/gm
    ),
  ].map((match) => match[1]);
}

function resolve(specifier: string): string | null {
  const base = path.join(SRC, specifier.slice("@/".length));
  for (const candidate of [
    `${base}.ts`,
    `${base}.tsx`,
    path.join(base, "index.ts"),
  ]) {
    try {
      readFileSync(candidate, "utf8");
      return candidate;
    } catch {
      // Not this shape — try the next.
    }
  }
  return null;
}

test("no oversight read imports the database client at module scope", () => {
  for (const name of SEAM_MODULES) {
    const file = path.join(SRC, "lib", "oversight", name);
    const imports = valueImports(read(file));
    assert.ok(imports.length > 0, `${name}: the import scan found nothing`);

    for (const specifier of imports) {
      assert.ok(
        !DB_SPECIFIERS.has(specifier),
        `${name} imports ${specifier} at module scope — defer it into the read`
      );

      const resolved = resolve(specifier);
      if (!resolved) continue;
      const reached = valueImports(read(resolved));
      for (const hop of reached) {
        assert.ok(
          !DB_SPECIFIERS.has(hop),
          `${name} imports ${specifier} at module scope, which opens with ${hop} — defer it into the read`
        );
      }
    }
  }
});

test("the deferred import is still made, inside the read that needs it", () => {
  // Deleting the top-level import without adding the dynamic one would pass the
  // scan above and fail at runtime, so both halves are asserted.
  const source = read(path.join(SRC, "lib", "oversight", "read.ts"));
  assert.match(
    source,
    /await import\("@\/lib\/launch\/queries"\)/,
    "the launch-date read is neither imported at the top nor deferred into the body"
  );
  assert.match(source, /await import\("@\/db"\)/);
  assert.match(source, /await import\("@\/lib\/auth\/access"\)/);
});
