import assert from "node:assert/strict";
import path from "node:path";
import { test } from "node:test";

import type { UserRole } from "@/db/schema";

import { CHURCH_LEVEL_ROLES, OVERSIGHT_ROLES, isOversightRole } from "./roles";
// The one comment stripper, the one static import scan and the one export-shape
// reader, imported rather than re-spelled. The copy this file used to carry
// (`^import\s+(?!type\b)`) could not see `export … from`, so `roles.ts` could
// have re-served `@/db` from the leaf and still passed the guard that exists to
// stop exactly that. What the scan itself can see is asserted once, in
// `./server-action-surface.test.ts`; what is local to this file is the LEAF,
// and that is all it asserts below.
import {
  TS_FILES,
  codeOf,
  rel,
  resolveModule,
  staticValueSpecifiers,
  valueExportStatements,
} from "./server-action-surface";

// ============================================================================
// One declaration of each role policy, and ONE import path to it.
//
// `OVERSIGHT_ROLES` was declared twice — in `./access` (as
// `OVERSIGHT_ROLES: UserRole[]`) and again in `@/lib/oversight/session` as an
// `as const` tuple, because `UserRole[]` narrows nothing and `isOversightRole`
// needed a type predicate. The two were reconciled by a regex over `access.ts`'s
// source text, which failed closed but pointed backwards: the single change that
// removed the reason for the copy — declaring the pair `as const` — was the
// change that made the guard fail with "OVERSIGHT_ROLES is no longer declared as
// a literal".
//
// The declaration now lives in `./roles`, an import-free leaf, so a route guard
// that only wants to know WHICH ROLES a rule names can import it without paying
// for `@/db`. What is asserted below is the PROPERTY, not one instance of it:
// exactly ONE module under `src/` exports either symbol.
//
// A LEAF WHOSE CONTENTS ARE ALSO SERVED FROM THE TRUNK IS NOT A LEAF. `access.ts`
// briefly re-exported the pair "so every existing consumer's import path is
// unchanged" — the `register-path.ts` failure verbatim (`memory/invariants.md`
// → Multi-Tenancy): a second, blessed import path to one authority policy,
// through a module whose first statement is `import { db } from "@/db"`. It
// bought five unchanged import lines and cost an identity test that could only
// police that one wrapper, plus a `DATABASE_URL` requirement in the auth suite
// for no reason but that test. The guard below points forwards instead: it fails
// on the next re-export, wherever it is written.
// ============================================================================

const THE_ONE_DECLARATION = path.join(
  process.cwd(),
  "src",
  "lib",
  "auth",
  "roles.ts"
);

const ROLE_POLICY_SYMBOLS = ["CHURCH_LEVEL_ROLES", "OVERSIGHT_ROLES"] as const;

test("roles.ts is the ONLY module that exports the role policy", () => {
  // Not "nothing imports `@/lib/auth/access` for the pair", which is a property
  // about today's call sites: ONE declaration, ONE export, everywhere in `src/`.
  // Any alias is a second import path, and a second import path through a module
  // with `@/db` at the top of it is the leaf rule broken by re-export.
  //
  // Suites are skipped for the reason the sibling guard skips them
  // (`register-path.test.ts` §2): nothing imports a `*.test.ts`, so no bundle or
  // seam edge can come from one, and a suite has to be able to quote the shape
  // it forbids.
  const doors: string[] = [];

  for (const file of TS_FILES) {
    if (file === THE_ONE_DECLARATION) continue;
    if (/\.test\.tsx?$/.test(file)) continue;

    for (const statement of valueExportStatements(codeOf(file))) {
      // Either shape is a door: an export statement that NAMES a symbol
      // (`export { OVERSIGHT_ROLES }`, `export const OVERSIGHT_ROLES = …`,
      // `export { CHURCH_LEVEL_ROLES } from "@/lib/auth/roles"`), or one that
      // re-serves the leaf wholesale (`export * from "@/lib/auth/roles"`),
      // which names nothing and would otherwise read as innocent.
      const names = ROLE_POLICY_SYMBOLS.some((symbol) =>
        new RegExp(`\\b${symbol}\\b`).test(statement)
      );
      const reservesTheLeaf = staticValueSpecifiers(statement).some(
        (specifier) => resolveModule(file, specifier) === THE_ONE_DECLARATION
      );

      if (names || reservesTheLeaf) doors.push(`${rel(file)} → ${statement}`);
    }
  }

  assert.deepEqual(
    doors,
    [],
    `the role policy is exported from somewhere other than the leaf — a second import path to one authority policy, and through a module with imports of its own (\`access.ts\` opens with \`@/db\`) it is the import-free leaf broken by re-export:\n  ${doors.join("\n  ")}`
  );

  // …and the leaf really does still export both, so the check above is not
  // vacuously true of a policy that has been renamed out from under it.
  const leaf = codeOf(THE_ONE_DECLARATION);
  assert.match(leaf, /export const CHURCH_LEVEL_ROLES\b/);
  assert.match(leaf, /export const OVERSIGHT_ROLES\b/);
});

test("the leaf reaches no database, which is what lets every site import it", () => {
  // `./access` opens with `import { db } from "@/db"`. A value edge here puts
  // that back one hop away and forces the copy this file exists to prevent.
  assert.deepEqual(
    staticValueSpecifiers(codeOf(THE_ONE_DECLARATION)),
    [],
    "roles.ts gained a value import — it is no longer reachable from a no-database module"
  );
});

test("the two policies partition every role, with no role in both", () => {
  const every: UserRole[] = [
    "planter",
    "coach",
    "team_member",
    "sending_church_admin",
    "network_admin",
  ];
  const declared = [...CHURCH_LEVEL_ROLES, ...OVERSIGHT_ROLES];
  assert.deepEqual([...declared].sort(), [...every].sort());
  assert.equal(
    new Set(declared).size,
    declared.length,
    "a role is in both lists"
  );
});

test("isOversightRole admits exactly the declared pair", () => {
  const every: UserRole[] = [
    "planter",
    "coach",
    "team_member",
    "sending_church_admin",
    "network_admin",
  ];
  assert.deepEqual(every.filter(isOversightRole), [...OVERSIGHT_ROLES]);
});
