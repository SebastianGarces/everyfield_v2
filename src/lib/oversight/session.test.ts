import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { test } from "node:test";

import type { UserRole } from "@/db/schema";

import { OVERSIGHT_ROLE_LIST, isOversightRole } from "./session";
import { scopeLabelForOrgType, scopeLabelForRole } from "./org-label";

// ============================================================================
// One guard for every /oversight route, and one spelling of the scope label.
//
// Both rules are properties of the SHAPE of the code — "no page carries its own
// copy" cannot be observed from a return value — so they are asserted over the
// route directory the way `read.test.ts` does for the plants surface. The
// directory is WALKED rather than listed, so a seventh oversight route joins
// these checks by existing.
// ============================================================================

const ROOT = process.cwd();
const OVERSIGHT_ROUTES = path.join(
  ROOT,
  "src",
  "app",
  "(dashboard)",
  "oversight"
);

/** Every `page.tsx` under `src/app/(dashboard)/oversight/`, recursively. */
function oversightPages(dir: string = OVERSIGHT_ROUTES): string[] {
  const found: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) found.push(...oversightPages(full));
    else if (entry.name === "page.tsx") found.push(full);
  }
  return found;
}

function read(file: string): string {
  return readFileSync(file, "utf8");
}

/** Source with comments removed — the prose explaining a rule must not satisfy
 *  it. (Same stripper, and same reasoning, as `read.test.ts`.) */
function readCode(file: string): string {
  return read(file)
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/\/\/.*$/gm, "");
}

// ----------------------------------------------------------------------------
// The role list is one list
// ----------------------------------------------------------------------------

test("the guard's role tuple is exactly OVERSIGHT_ROLES", () => {
  // The tuple exists only to give `isOversightRole` a type predicate —
  // `OVERSIGHT_ROLES` (`@/lib/auth/access`) is typed `UserRole[]` and narrows
  // nothing. Two lists of the same two roles is precisely the drift this
  // asserts away.
  //
  // READ FROM SOURCE, not imported. `@/lib/auth/access` pulls in `@/db`, whose
  // module scope calls `neon(process.env.DATABASE_URL!)` — importing it here
  // would make this whole suite need a database to assert a two-element list,
  // and the no-DATABASE_URL seam is the property every other file in this
  // directory is built around.
  const access = readCode(path.join(ROOT, "src", "lib", "auth", "access.ts"));
  const declaration = /OVERSIGHT_ROLES: UserRole\[\] = \[([^\]]*)\]/.exec(
    access
  );
  assert.ok(declaration, "OVERSIGHT_ROLES is no longer declared as a literal");

  const declared = [...declaration[1].matchAll(/"([^"]+)"/g)].map(
    (match) => match[1]
  );
  assert.deepEqual(declared, [...OVERSIGHT_ROLE_LIST]);
});

test("every non-oversight role is refused, and both oversight roles pass", () => {
  const roles: UserRole[] = [
    "planter",
    "coach",
    "team_member",
    "sending_church_admin",
    "network_admin",
  ];
  const admitted = roles.filter(isOversightRole);
  assert.deepEqual(admitted, ["sending_church_admin", "network_admin"]);
});

// ----------------------------------------------------------------------------
// No route re-spells the rule
// ----------------------------------------------------------------------------

test("every oversight route guards through requireOversightUser", () => {
  const pages = oversightPages();
  assert.ok(pages.length >= 6, "the route walker found nothing to check");

  for (const page of pages) {
    const source = readCode(page);
    assert.match(
      source,
      /await requireOversightUser\(\)/,
      `${path.relative(ROOT, page)} does not go through the shared oversight guard`
    );
  }
});

test("no oversight route keeps its own copy of the role pair", () => {
  // Six pages used to open with the identical
  // `user.role !== "sending_church_admin" && user.role !== "network_admin"`.
  // A rule written six times is a rule that can be weakened in one of them.
  for (const page of oversightPages()) {
    const source = readCode(page);
    assert.ok(
      !/user\.role !== "sending_church_admin"/.test(source),
      `${path.relative(ROOT, page)} re-spells the oversight role pair`
    );
    assert.ok(
      !/getCurrentSession\(\)/.test(source),
      `${path.relative(ROOT, page)} reads the session itself instead of through the guard`
    );
  }
});

test("the two refusals stay different, and neither is a 404", () => {
  // No session → /login (signing in is what is missing); a church-level role →
  // /dashboard (they have a home). `notFound()` is reserved for the one page
  // whose EXISTENCE is the disclosure, and it stays at that page.
  const guard = readCode(
    path.join(ROOT, "src", "lib", "oversight", "session.ts")
  );
  assert.match(guard, /redirect\("\/login"\)/);
  assert.match(guard, /redirect\("\/dashboard"\)/);
  assert.ok(
    !guard.includes("notFound"),
    "the shared guard 404s, which would hide /dashboard from a planter who has one"
  );

  const roster = readCode(
    path.join(OVERSIGHT_ROUTES, "sending-churches", "page.tsx")
  );
  assert.match(
    roster,
    /user\.role !== "network_admin"\s*\)\s*\{\s*notFound\(\);/,
    "the network-only refusal is this page's own rule and must stay on it"
  );
});

test("the guard is not a 'use server' module", () => {
  // Every export of a `"use server"` module is a POSTable endpoint
  // (memory/invariants.md → Authentication). This is a helper the pages call.
  // Comments stripped: the docblock QUOTES the directive to explain why it is
  // absent, the way `resend.ts` quotes the sentence it forbids.
  const guard = readCode(
    path.join(ROOT, "src", "lib", "oversight", "session.ts")
  );
  assert.ok(!guard.includes('"use server"'));
});

// ----------------------------------------------------------------------------
// One scope-label vocabulary, and the leaf stays a leaf
// ----------------------------------------------------------------------------

test("no oversight surface re-derives the scope label inline", () => {
  const surfaces = [
    ...oversightPages(),
    ...readdirSync(path.join(ROOT, "src", "components", "oversight")).map(
      (name) => path.join(ROOT, "src", "components", "oversight", name)
    ),
  ].filter((file) => !file.endsWith(".test.ts"));

  for (const file of surfaces) {
    const source = readCode(file);
    assert.ok(
      !/\?\s*"network"\s*:\s*"sending church"/.test(source),
      `${path.relative(ROOT, file)} re-derives the scope label from the role`
    );
    assert.ok(
      !/sending_church:\s*"sending church"/.test(source),
      `${path.relative(ROOT, file)} keeps a private org-kind label table`
    );
  }
});

test("presentation.ts does not re-serve the import-free leaf", () => {
  // `remove-plant-dialog.tsx` is `"use client"`, and `presentation.ts` reaches
  // `@/db/schema` through `STATUS_LABELS`. A re-export would make the heavy
  // path type-check and work — the `register-path.ts` failure, verbatim
  // (memory/invariants.md → Multi-Tenancy).
  const presentation = readCode(
    path.join(ROOT, "src", "lib", "oversight", "presentation.ts")
  );
  for (const symbol of ["scopeLabelForRole", "scopeLabelForOrgType"]) {
    assert.ok(
      !presentation.includes(symbol),
      `presentation.ts serves ${symbol}, which puts @/db/schema one import from a client component`
    );
  }

  // …and the leaf really is one: no VALUE import at all.
  const leaf = readCode(
    path.join(ROOT, "src", "lib", "oversight", "org-label.ts")
  );
  const valueImports = [...leaf.matchAll(/^import\s+(?!type\b)/gm)];
  assert.deepEqual(
    valueImports.map((match) => match[0]),
    [],
    "org-label.ts gained a value import — it is no longer safe in a client bundle"
  );

  assert.equal(
    scopeLabelForRole("network_admin"),
    scopeLabelForOrgType("network")
  );
});
