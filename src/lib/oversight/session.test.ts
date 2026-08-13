import assert from "node:assert/strict";
import { readdirSync } from "node:fs";
import path from "node:path";
import { test } from "node:test";

import type { UserRole } from "@/db/schema";
// The ONE declaration of the oversight role pair, imported rather than parsed
// out of another module's source. `@/lib/auth/roles` is an import-free leaf, so
// this costs the suite no database — which is precisely why the pair can live
// in one place now (`@/lib/auth/access` opens with `@/db`).
import { OVERSIGHT_ROLES, isOversightRole } from "@/lib/auth/roles";
// The repo's static reader, imported rather than re-written: `codeOf` is the
// comment stripper this file used to keep a copy of, and `staticValueSpecifiers`
// is the import scan the leaf guard below used to spell as a bare
// `^import\s+(?!type\b)` — a pattern blind to `export … from`, which is the one
// shape the leaf rule exists to forbid. It reaches only node builtins.
import {
  codeOf,
  staticValueSpecifiers,
} from "@/lib/auth/server-action-surface";

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

/** Source with comments removed — the prose explaining a rule must not satisfy
 *  it. `codeOf` is the repo's one stripper; this file used to carry a copy. */
const readCode = codeOf;

// ----------------------------------------------------------------------------
// The role list is one list
// ----------------------------------------------------------------------------

test("the guard declares no role of its own", () => {
  // `session.ts` used to hold `OVERSIGHT_ROLE_LIST` — a second `as const` tuple
  // of the same two roles as `OVERSIGHT_ROLES` (`@/lib/auth/access`),
  // reconciled by a regex over THAT module's source text. Two implementations
  // of one authority policy, with a drift guard pointed backwards: declaring
  // `OVERSIGHT_ROLES` `as const`, the one change that removes the reason for
  // the copy, was the change that failed the guard.
  //
  // The pair is now declared once, in the import-free leaf `@/lib/auth/roles`,
  // which BOTH sites import — `roles.test.ts` asserts that `access.ts` serves
  // the leaf's own object rather than a copy of it, by identity. What this
  // guard owes is that no third copy grows back here.
  const guard = readCode(
    path.join(ROOT, "src", "lib", "oversight", "session.ts")
  );
  for (const role of ["sending_church_admin", "network_admin"]) {
    assert.ok(
      !guard.includes(role),
      `session.ts names "${role}" — the role pair belongs to @/lib/auth/roles`
    );
  }
  assert.match(guard, /from "@\/lib\/auth\/roles"/);
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
  // Compared against the DECLARATION, not against a third spelling of the pair.
  assert.deepEqual(admitted, [...OVERSIGHT_ROLES]);
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

  // …and the leaf really is one: no static VALUE edge at all — import,
  // side-effect import, or `export … from`. The scan is the shared one, not the
  // `^import\s+(?!type\b)` this file used to carry: that pattern could not see
  // `export { db } from "@/db"`, which is the exact shape the rule forbids.
  assert.deepEqual(
    staticValueSpecifiers(
      readCode(path.join(ROOT, "src", "lib", "oversight", "org-label.ts"))
    ),
    [],
    "org-label.ts gained a value import — it is no longer safe in a client bundle"
  );

  assert.equal(
    scopeLabelForRole("network_admin"),
    scopeLabelForOrgType("network")
  );
});

test("the leaf guard sees a re-export, which is the shape it exists to forbid", () => {
  // `register-path.ts` did not fail on an `import`; it failed on
  // `export { INVITATION_REGISTER_PATH, invitationRegisterPath } from …`, which
  // makes the heavy path type-check and work (memory/invariants.md →
  // Multi-Tenancy). A leaf guard blind to that shape is a guard pointed away
  // from its own failure.
  for (const [shape, line] of [
    [
      "re-export",
      'export { scopeLabelForRole } from "@/lib/oversight/presentation";',
    ],
    [
      "indented import",
      '  import { STATUS_LABELS } from "@/lib/people/status.shared";',
    ],
    ["side effect", 'import "@/db/schema";'],
    ["single quotes", "import { db } from '@/db';"],
  ] as const) {
    assert.notDeepEqual(
      staticValueSpecifiers(line),
      [],
      `the leaf guard cannot see a ${shape} — org-label.ts could gain one and still pass`
    );
  }

  // A type import is erased and is what the leaf legitimately holds two of.
  assert.deepEqual(
    staticValueSpecifiers('import type { UserRole } from "@/db/schema";'),
    []
  );
});
