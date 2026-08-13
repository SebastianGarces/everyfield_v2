import assert from "node:assert/strict";
import path from "node:path";
import { test } from "node:test";

import {
  SRC,
  codeOf,
  resolveModule,
  staticValueSpecifiers,
} from "@/lib/auth/server-action-surface";

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
// THE WALKER IS IMPORTED, NOT WRITTEN AGAIN. `@/lib/auth/server-action-surface`
// is the repo's static reader — a normal module, not a `.test.ts`, expressly so
// a second caller imports it instead of copying it — and it reaches only node
// builtins, so it costs this seam nothing. The copy that used to live here read
// `^import\s+(?!type\b)[^;]*?from\s+"(@\/[^"]+)"`, which caught ONE of the five
// ways to reach `@/db` at module scope: not a single-quoted specifier, not an
// indented import, not `import "@/db"`, and not `export { db } from "@/db"` —
// the re-export that is precisely the failure `register-path.ts` was written
// about. `staticValueSpecifiers` closes all four, and those four shapes are
// pinned ONCE, in `src/lib/auth/server-action-surface.test.ts`, beside the
// function itself — a re-spelling of the pattern breaks one function, so one
// suite catching it is the point of sharing it. What is local to THIS file, and
// all it asserts, is the seam: neither seam module reaches `@/db` statically.
//
// It is still a STATIC walk and says so: a specifier built at runtime, or a
// re-export barrel it cannot resolve, is outside what it can see. It shares
// that limitation with `src/lib/meetings/client-boundary.test.ts`, which names
// it too. `import()` is excluded on purpose — deferring `@/db` into the call is
// what SATISFIES this rule, so counting the dynamic form would fail the fix.
// ============================================================================

/** Modules whose header promises the seam. */
const SEAM_MODULES = ["read.ts", "sending-churches.ts"] as const;

/** Specifiers that ARE the database client, or are known to open with it. */
const DB_SPECIFIERS = new Set(["@/db"]);

test("no oversight read imports the database client at module scope", () => {
  for (const name of SEAM_MODULES) {
    const file = path.join(SRC, "lib", "oversight", name);
    const imports = staticValueSpecifiers(codeOf(file));
    assert.ok(imports.length > 0, `${name}: the import scan found nothing`);

    for (const specifier of imports) {
      assert.ok(
        !DB_SPECIFIERS.has(specifier),
        `${name} imports ${specifier} at module scope — defer it into the read`
      );

      const resolved = resolveModule(file, specifier);
      if (!resolved) continue;
      for (const hop of staticValueSpecifiers(codeOf(resolved))) {
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
  const source = codeOf(path.join(SRC, "lib", "oversight", "read.ts"));
  assert.match(
    source,
    /await import\("@\/lib\/launch\/queries"\)/,
    "the launch-date read is neither imported at the top nor deferred into the body"
  );
  assert.match(source, /await import\("@\/db"\)/);
  assert.match(source, /await import\("@\/lib\/auth\/access"\)/);
});
