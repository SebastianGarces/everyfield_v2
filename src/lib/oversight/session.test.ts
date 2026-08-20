import assert from "node:assert/strict";
import { readdirSync } from "node:fs";
import path from "node:path";
import { test } from "node:test";

// The ONE declaration of "which org does this row's tenancy name", imported
// rather than parsed out of another module's source. `@/lib/auth/tenancy` is an
// import-free leaf, so this costs the suite no database — which is precisely
// why the decision can live in one place now (`@/lib/auth/access` opens with
// `@/db`).
import { oversightOrgOf, type TenancyFields } from "@/lib/auth/tenancy";
// The repo's static reader, imported rather than re-written: `codeOf` is the
// comment stripper this file used to keep a copy of, and `staticValueSpecifiers`
// is the import scan the leaf guard below used to spell as a bare
// `^import\s+(?!type\b)` — a pattern blind to `export … from`, which is the one
// shape the leaf rule exists to forbid. It reaches only node builtins.
import {
  codeOf,
  staticValueSpecifiers,
} from "@/lib/auth/server-action-surface";

import { scopeLabelForOrgType } from "./org-label";

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
// The tenancy decision is made in one place
// ----------------------------------------------------------------------------

test("the guard names no tenancy column of its own", () => {
  // `session.ts` used to hold `OVERSIGHT_ROLE_LIST` — a second `as const` tuple
  // of the two oversight roles — reconciled by a regex over another module's
  // source text: two implementations of one authority policy, with a drift
  // guard pointed backwards. The decision is now made once, by `oversightOrgOf`
  // in the import-free leaf `@/lib/auth/tenancy`, and `tenancy.test.ts` asserts
  // no other module in `src/` exports it. What this guard owes is that no third
  // copy grows back here — including the FK-reading form the predicate replaced.
  const guard = readCode(
    path.join(ROOT, "src", "lib", "oversight", "session.ts")
  );
  for (const column of ["sendingChurchId", "sendingNetworkId"]) {
    assert.ok(
      !guard.includes(column),
      `session.ts reads "${column}" — resolving a tenancy belongs to @/lib/auth/tenancy`
    );
  }
  assert.match(guard, /from "@\/lib\/auth\/tenancy"/);
});

test("a church-level tenancy is refused and both oversight tenancies pass", () => {
  const base: TenancyFields = {
    churchId: null,
    sendingChurchId: null,
    sendingNetworkId: null,
  };
  // The same predicate the guard calls, over the shapes the guard sees.
  assert.equal(oversightOrgOf({ ...base, churchId: "c" }), null, "a plant");
  assert.equal(oversightOrgOf(base), null, "a coach — no tenancy at all");
  assert.equal(
    oversightOrgOf({ ...base, sendingChurchId: "s" })?.type,
    "sending_church"
  );
  assert.equal(
    oversightOrgOf({ ...base, sendingNetworkId: "n" })?.type,
    "network"
  );
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

test("no oversight route resolves the caller's tenancy itself", () => {
  // Six pages used to open with the identical
  // `user.role !== "sending_church_admin" && user.role !== "network_admin"`.
  // A rule written six times is a rule that can be weakened in one of them. The
  // seat model's version of that copy is a page reading an org FK off the
  // session row instead of taking the org the guard already resolved.
  for (const page of oversightPages()) {
    const source = readCode(page);
    assert.ok(
      !/user\.sendingChurchId|user\.sendingNetworkId/.test(source),
      `${path.relative(ROOT, page)} resolves the caller's org itself instead of using the guard's`
    );
    assert.ok(
      !/getCurrentSession\(\)/.test(source),
      `${path.relative(ROOT, page)} reads the session itself instead of through the guard`
    );
  }
});

test("the one refusal it owns is /dashboard, and it is not a 404", () => {
  // A church-level tenancy → /dashboard (they have a home). `notFound()` is
  // reserved for the one page whose EXISTENCE is the disclosure, and it stays
  // at that page.
  //
  // The signed-out refusal is NOT this guard's to make (#503). It used to spell
  // its own `redirect("/login")`, which named no destination to come back to,
  // and it sat behind two bounces that do — the proxy's, and the `(dashboard)`
  // layout's. Asserting its ABSENCE is the point: a third copy growing back is
  // how a reader ends up somewhere with no way back to the page they wanted.
  const guard = readCode(
    path.join(ROOT, "src", "lib", "oversight", "session.ts")
  );
  assert.match(guard, /redirect\("\/dashboard"\)/);
  assert.ok(
    !/redirect\("\/login"\)/.test(guard),
    "the oversight guard bounces to /login itself — that belongs to the (dashboard) layout, which carries the return path"
  );
  assert.ok(
    !guard.includes("notFound"),
    "the shared guard 404s, which would hide /dashboard from a planter who has one"
  );

  const roster = readCode(
    path.join(OVERSIGHT_ROUTES, "sending-churches", "page.tsx")
  );
  assert.match(
    roster,
    /org\.type !== "network"\s*\)\s*\{\s*notFound\(\);/,
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
      `${path.relative(ROOT, file)} re-derives the scope label inline`
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
  for (const symbol of ["scopeLabelForOrgType"]) {
    assert.ok(
      !presentation.includes(symbol),
      `presentation.ts serves ${symbol}, which puts @/db/schema one import from a client component`
    );
  }

  // …and the leaf really is one: no static VALUE edge at all — import,
  // side-effect import, or `export … from`. The scan is the shared one, not the
  // `^import\s+(?!type\b)` this file used to carry: that pattern could not see
  // `export { db } from "@/db"`, which is the exact shape the rule forbids.
  // Which shapes the shared scan sees is asserted once, where it lives
  // (`src/lib/auth/server-action-surface.test.ts`); the leaf is what is local
  // here.
  assert.deepEqual(
    staticValueSpecifiers(
      readCode(path.join(ROOT, "src", "lib", "oversight", "org-label.ts"))
    ),
    [],
    "org-label.ts gained a value import — it is no longer safe in a client bundle"
  );

  assert.equal(scopeLabelForOrgType("network"), "network");
  assert.equal(scopeLabelForOrgType("sending_church"), "sending church");
});
