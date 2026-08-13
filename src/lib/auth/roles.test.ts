import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { test } from "node:test";

import type { UserRole } from "@/db/schema";

import { CHURCH_LEVEL_ROLES, OVERSIGHT_ROLES, isOversightRole } from "./roles";
import * as access from "./access";

// ============================================================================
// One declaration of each role policy, reconciled BY IMPORT.
//
// `OVERSIGHT_ROLES` was declared twice — here (as `OVERSIGHT_ROLES: UserRole[]`
// in `./access`) and again in `@/lib/oversight/session` as an `as const` tuple,
// because `UserRole[]` narrows nothing and `isOversightRole` needed a type
// predicate. The two were reconciled by a regex over `access.ts`'s source text,
// which failed closed but pointed backwards: the single change that removed the
// reason for the copy — declaring the pair `as const` — was the change that
// made the guard fail with "OVERSIGHT_ROLES is no longer declared as a literal".
//
// The declaration now lives in `./roles`, an import-free leaf, so the guard can
// import it without paying for `@/db`. What is asserted below is IDENTITY: the
// array `./access` serves is the leaf's own object, not a copy that happens to
// hold the same strings today. A copy passes every value comparison and is
// exactly the drift the regex existed to catch.
//
// This file imports `./access`, so it needs a DATABASE_URL to be PRESENT —
// `@/db`'s module scope calls `neon(process.env.DATABASE_URL!)`. `pnpm test`
// and CI both supply one (the same requirement
// `src/lib/dev-seed/seed-account-writes.test.ts` names). That is why the
// identity check lives here and not in the oversight suite, which is built
// around running with no database at all.
// ============================================================================

const ROOT = process.cwd();

test("access.ts serves the leaf's own array, not a second copy of it", () => {
  assert.equal(
    access.OVERSIGHT_ROLES,
    OVERSIGHT_ROLES,
    "@/lib/auth/access re-declares the oversight pair instead of re-exporting it"
  );
  assert.equal(
    access.CHURCH_LEVEL_ROLES,
    CHURCH_LEVEL_ROLES,
    "@/lib/auth/access re-declares the church-level roles instead of re-exporting it"
  );
});

test("the leaf reaches no database, which is what lets both sites import it", () => {
  // `./access` opens with `import { db } from "@/db"`. A value import here puts
  // that back one hop away and forces the copy this file exists to prevent.
  const source = readFileSync(
    path.join(ROOT, "src", "lib", "auth", "roles.ts"),
    "utf8"
  )
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/\/\/.*$/gm, "");
  const valueImports = [...source.matchAll(/^import\s+(?!type\b)/gm)];
  assert.deepEqual(
    valueImports.map((match) => match[0]),
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
