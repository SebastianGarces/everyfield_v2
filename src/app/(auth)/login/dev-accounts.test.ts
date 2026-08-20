import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { test } from "node:test";

import type { SeatFields } from "@/lib/auth/tenancy";

import { groupFor, standingLabel } from "./dev-accounts";

// ----------------------------------------------------------------------------
// Seeded dev logins (#326) — the domain retirement and the things that quote it.
//
// The seeded addresses are not an implementation detail: agents log in with them
// during browser validation, and they are copied into two SKILL.md files that no
// compiler checks. When the domain moved to everyfield.app (ruled 2026-07-31),
// the way this breaks is not a type error — it is a doc that still hands out an
// address which no longer authenticates, discovered halfway through a validation
// run. So the seeds and every doc that quotes them are pinned together here.
//
// None of this needs a database, so it runs in CI.
// ----------------------------------------------------------------------------

const ROOT = process.cwd();

/**
 * The retired placeholder domain, assembled rather than written.
 *
 * This file asserts the literal appears NOWHERE, so it must not contain the
 * literal either — a guard that trips on itself is worthless. The two prose
 * mentions that survive on purpose (`scripts/seed-marketing-church.ts` and
 * `docs/marketing-church-seed.md`, which describe the retirement) are not in the
 * list below.
 */
const RETIRED_DOMAIN = ["everyfield", "dev"].join(".");

/** The domain that replaced it. */
const CURRENT_DOMAIN = "everyfield.app";

/** Files this unit owns, each of which quotes or produces a seeded login. */
const OWNED_FILES = [
  "scripts/seed-dev-db.ts",
  "scripts/seed-phase-engine-eval.ts",
  "src/app/(auth)/login/dev-accounts.ts",
  ".claude/skills/browser-validation/SKILL.md",
  ".claude/skills/validate/SKILL.md",
  "src/app/(auth)/login/dev-accounts.test.ts",
];

function read(relativePath: string): string {
  return readFileSync(path.join(ROOT, relativePath), "utf8");
}

// ----------------------------------------------------------------------------
// The retirement holds
// ----------------------------------------------------------------------------

test("no file that hands out a seeded login mentions the retired domain", () => {
  for (const file of OWNED_FILES) {
    assert.equal(
      read(file).includes(RETIRED_DOMAIN),
      false,
      `${file} still references the retired seed domain — the accounts on it do not exist, so anything quoting it hands out a login that cannot authenticate`
    );
  }
});

test("the dev seed creates every account on the current domain", () => {
  const source = read("scripts/seed-dev-db.ts");

  assert.match(
    source,
    new RegExp(`const DEV_EMAIL_DOMAIN = "${CURRENT_DOMAIN}"`),
    "seed-dev-db.ts must declare the seed domain in one place"
  );
  // Every seeded address must go through that constant rather than hard-coding
  // a domain, which is what keeps the nine accounts from drifting apart.
  const hardCoded = source.match(/email: "[^"]*@[^"]*"/g) ?? [];
  assert.deepEqual(
    hardCoded,
    [],
    "seeded emails must interpolate DEV_EMAIL_DOMAIN, not hard-code a domain"
  );
});

test("the eval seed creates every account on the current domain", () => {
  assert.match(
    read("scripts/seed-phase-engine-eval.ts"),
    new RegExp(
      `const EVAL_EMAIL_DOMAIN = "eval\\.phase-engine\\.${CURRENT_DOMAIN.replace(".", "\\.")}"`
    )
  );
});

// ----------------------------------------------------------------------------
// The cleanup converges an already-seeded database
// ----------------------------------------------------------------------------

test("eval cleanup matches accounts by subdomain, so old-domain rows are swept too", () => {
  const source = read("scripts/seed-phase-engine-eval.ts");

  assert.match(
    source,
    /const EVAL_EMAIL_MARKER = "@eval\.phase-engine\."/,
    "the marker must be the eval SUBDOMAIN — matching the full domain strands every account seeded before the retirement"
  );
  assert.match(
    source,
    /u\.email\.includes\(EVAL_EMAIL_MARKER\)/,
    "the user sweep must filter on the marker, not on EVAL_EMAIL_DOMAIN"
  );
});

// ----------------------------------------------------------------------------
// The dev seed's wipe
//
// Verified for real, since none of it can be proven from source: against a Neon
// branch taken from `development` (79 users, 67 churches, 807 people, a full
// eval corpus), `pnpm db:seed` swept 4451 rows across 50 tables, reseeded, and
// ran again cleanly — with the 96-article wiki corpus and all 96
// `related_article_slugs` untouched. The assertions below pin the properties
// that made that possible.
// ----------------------------------------------------------------------------

test("the dev seed wipes from users and churches, so it needs no email predicate", () => {
  const source = read("scripts/seed-dev-db.ts");

  // Unscoped is the point: whatever domain the existing rows carry, they go. A
  // predicate on either root would reintroduce exactly the drift this unit
  // removed — an account survives by carrying an address the file stopped
  // mentioning.
  assert.match(
    source,
    /const WIPE_ROOTS = \["users", "churches"\] as const;/,
    "the wipe must start at users and churches"
  );
  assert.match(
    source,
    /DELETE FROM \$\{quoteIdentifier\(table\)\}/,
    "the wipe deletes whole tables — no WHERE clause, no email predicate"
  );
});

test("the wipe derives its tables from the live FK graph, not a hand-kept list", () => {
  const source = read("scripts/seed-dev-db.ts");

  // A hand-maintained list is what kept failing: launch journals (#305),
  // launch-prep tasks (#305/LS-003) and answered invitations (#304) each landed
  // a table in the graph that the list did not know about, and each time
  // `pnpm db:seed` died halfway through a partly wiped database. Reading
  // `pg_constraint` is what makes a table added next month arrive on its own.
  assert.match(
    source,
    /FROM pg_constraint con/,
    "cleanDatabase must read the foreign keys from the catalog"
  );
  assert.match(
    source,
    /function planWipe\(keys: ForeignKey\[\]\): string\[\]/,
    "the delete order must be computed from those keys"
  );
  // Reachability from the roots, so nothing outside the fixture is touched.
  assert.match(source, /const covered = new Set<string>\(\);/);
  // A cycle of non-cascading keys must stop the run rather than half-wipe.
  assert.match(source, /Cannot order the wipe/);
});

test("the wipe protects the wiki corpus even though the graph reaches it", () => {
  const source = read("scripts/seed-dev-db.ts");

  // `wiki_articles.church_id` makes the corpus a dependent of `churches`, so
  // reachability alone would delete it. It is content — migrated in (#317),
  // rebuilt by no script — so it is excluded from the walk AND the run aborts
  // before the first DELETE if any article is church-scoped.
  assert.match(
    source,
    /const PROTECTED_TABLES = new Set\(\["wiki_articles", "wiki_sections"\]\);/,
    "the wiki corpus and its sections must be protected by name"
  );
  assert.match(
    source,
    /if \(covered\.has\(child\) \|\| PROTECTED_TABLES\.has\(child\)\) continue;/,
    "protected tables must not be walked through either"
  );
  assert.match(
    source,
    /await assertProtectedTablesAreSafe\(keys, new Set\(order\)\);/,
    "the preflight must run before any DELETE"
  );
  const clean = source.slice(source.indexOf("async function cleanDatabase"));
  assert.ok(
    clean.indexOf("assertProtectedTablesAreSafe") <
      clean.indexOf("DELETE FROM"),
    "the preflight must come before the deletes, not after"
  );
});

test("no seed script touches wiki articles", () => {
  // The corpus and its `related_article_slugs` cross-links (#317) exist only in
  // the database — migrated in, never seeded — so a reseed that deleted them
  // would destroy content no script can rebuild.
  for (const file of [
    "scripts/seed-dev-db.ts",
    "scripts/seed-phase-engine-eval.ts",
  ]) {
    const source = read(file);
    assert.equal(
      /\bwikiArticles\b/.test(source),
      false,
      `${file} must never write or delete wiki articles`
    );
  }
});

// ----------------------------------------------------------------------------
// The login picker groups what it finds
// ----------------------------------------------------------------------------

const PLANT = "11111111-1111-4111-8111-111111111111";

/** An account with the given seat and tenancy, as the switcher projects it. */
function account(overrides: Partial<SeatFields> = {}): SeatFields {
  return {
    seat: null,
    churchId: null,
    sendingChurchId: null,
    sendingNetworkId: null,
    ...overrides,
  };
}

const PLANT_OWNER = account({ seat: "owner", churchId: PLANT });

test("eval accounts group as eval whatever domain they were seeded on", () => {
  assert.equal(
    groupFor(
      `planter-dayspring@eval.phase-engine.${CURRENT_DOMAIN}`,
      PLANT_OWNER
    ),
    "Phase Engine eval"
  );
  // A corpus seeded before the retirement is still an eval corpus. Grouping it
  // as "Planters" would be a wrong label with no error behind it.
  assert.equal(
    groupFor(
      `planter-dayspring@eval.phase-engine.${RETIRED_DOMAIN}`,
      PLANT_OWNER
    ),
    "Phase Engine eval"
  );
});

test("ordinary accounts group by tenancy, and by the Owner seat inside a plant", () => {
  assert.equal(
    groupFor(
      `admin@${CURRENT_DOMAIN}`,
      account({ seat: "owner", sendingNetworkId: "n-1" })
    ),
    "Oversight"
  );
  assert.equal(
    groupFor(
      `sender@${CURRENT_DOMAIN}`,
      account({ seat: "owner", sendingChurchId: "sc-1" })
    ),
    "Oversight"
  );
  assert.equal(groupFor(`planter1@${CURRENT_DOMAIN}`, PLANT_OWNER), "Planters");
  assert.equal(
    groupFor(
      `team1@${CURRENT_DOMAIN}`,
      account({ seat: "member", churchId: PLANT })
    ),
    "Other"
  );
  assert.equal(
    groupFor(`coach1@${CURRENT_DOMAIN}`, account({ churchId: PLANT })),
    "Other"
  );
});

test("the standing label names the tenancy AND the seat, never one alone", () => {
  // `owner` of what? The switcher's right-hand column is the pair, because the
  // seat alone means nothing across three tenancies.
  assert.equal(standingLabel(PLANT_OWNER), "Plant owner");
  assert.equal(
    standingLabel(account({ seat: "member", churchId: PLANT })),
    "Plant member"
  );
  assert.equal(
    standingLabel(account({ seat: "owner", sendingNetworkId: "n-1" })),
    "Network owner"
  );
  assert.equal(
    standingLabel(account({ seat: "owner", sendingChurchId: "sc-1" })),
    "Sending church owner"
  );
  assert.equal(standingLabel(account({ churchId: PLANT })), "Plant · no seat");
  assert.equal(standingLabel(account()), "Coach / no seat");
});

// ----------------------------------------------------------------------------
// The docs that hand an agent a login
// ----------------------------------------------------------------------------

test("browser-validation's login table quotes the seeded addresses", () => {
  const skill = read(".claude/skills/browser-validation/SKILL.md");

  for (const address of [
    `planter1@${CURRENT_DOMAIN}`,
    `admin@${CURRENT_DOMAIN}`,
    `coach1@${CURRENT_DOMAIN}`,
    `planter-dayspring@eval.phase-engine.${CURRENT_DOMAIN}`,
    `planter-evergreen@eval.phase-engine.${CURRENT_DOMAIN}`,
  ]) {
    assert.ok(
      skill.includes(address),
      `browser-validation/SKILL.md must list ${address}`
    );
  }

  // The local parts must be ones the seeds actually create.
  const devSeed = read("scripts/seed-dev-db.ts");
  for (const localPart of ["planter1", "admin", "coach1"]) {
    assert.match(
      devSeed,
      new RegExp(`email: \`${localPart}@`),
      `browser-validation/SKILL.md hands out ${localPart}@… but seed-dev-db.ts does not create it`
    );
  }
});

test("validate points at a planter the dev seed creates", () => {
  assert.ok(
    read(".claude/skills/validate/SKILL.md").includes(
      `planter1@${CURRENT_DOMAIN}`
    )
  );
});
