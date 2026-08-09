import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { test } from "node:test";

import { shouldShowOnboarding } from "./steps";

// ----------------------------------------------------------------------------
// Seeded churches are past onboarding (#326, F12 / OB-001).
//
// `shouldShowOnboarding` puts a planter in the wizard whenever their church's
// `onboarding_completed_at` is null. Every seed script inserts churches that are
// fixtures of a plant WITH history — a phase, a launch, a team — so a null stamp
// is not just inconvenient, it is a lie about the row: it lands the seeded
// planter in a four-step wizard instead of the dashboard the fixture exists to
// show, and it silently changes what the phase-engine eval harness renders.
//
// The failure has no type error and no runtime error behind it, so it is pinned
// here: the assertion is on the seed SOURCE, because running a seed needs a
// database and CI has none. Same technique, and the same reason, as
// `src/app/(auth)/login/dev-accounts.test.ts`.
// ----------------------------------------------------------------------------

const ROOT = process.cwd();

/**
 * The two seed scripts that build the fixture somebody then logs into.
 *
 * Scratch harnesses that insert a church to assert against rows — the G3
 * scripts under `scripts/` — are deliberately NOT on this list. They never
 * render a dashboard, so an unstamped church there costs nothing, and pinning
 * them here would make this test fail for a file whose behaviour is fine.
 */
const SEED_SCRIPTS = [
  "scripts/seed-dev-db.ts",
  "scripts/seed-phase-engine-eval.ts",
];

function read(relativePath: string): string {
  return readFileSync(path.join(ROOT, relativePath), "utf8");
}

/**
 * The source of every `db.insert(churches)` call in `source`, each cut at its
 * `.returning(` so one insert's values cannot vouch for the next one's.
 */
function churchInsertSites(source: string): string[] {
  return source
    .split(".insert(churches)")
    .slice(1)
    .map((tail) => {
      const end = tail.indexOf(".returning(");
      return end === -1 ? tail : tail.slice(0, end);
    });
}

test("the rule these seeds have to satisfy", () => {
  // Restating the reason the assertions below matter: an unstamped church is
  // exactly what sends a seeded planter into the wizard.
  const viewer = { role: "planter", churchId: "church-1" };
  assert.equal(
    shouldShowOnboarding({ ...viewer, onboardingCompletedAt: null }),
    true
  );
  assert.equal(
    shouldShowOnboarding({ ...viewer, onboardingCompletedAt: new Date() }),
    false
  );
});

test("every seeded church is stamped as past onboarding", () => {
  for (const file of SEED_SCRIPTS) {
    const sites = churchInsertSites(read(file));

    assert.ok(
      sites.length > 0,
      `${file} is listed as a seed script but inserts no churches — either it moved or this list is stale`
    );

    for (const [index, site] of sites.entries()) {
      assert.match(
        site,
        /onboardingCompletedAt/,
        `${file}: church insert #${index + 1} leaves onboarding_completed_at null, which drops the seeded planter into the onboarding wizard instead of the dashboard`
      );
    }
  }
});

test("the stamp is the row's own creation moment, not a fabricated date", () => {
  // `now()` is evaluated by Postgres inside the same INSERT that fills
  // `created_at` from `DEFAULT now()`, so the two are the same instant. A JS
  // `Date` drifts from `created_at`, and a relative date (`daysAgo(...)`) would
  // assert a history the fixture never had.
  for (const file of SEED_SCRIPTS) {
    const source = read(file);

    assert.match(
      source,
      // The tag is matched loosely: two of these scripts already bind `sql` to
      // the neon client and import drizzle's template under an alias.
      /function onboardingCompletedAtSeedStamp\(\) \{\s*return \w*[sS]ql`now\(\)`;/,
      `${file} must derive the stamp from now() in one place, so every insert in it agrees`
    );

    for (const site of churchInsertSites(source)) {
      assert.match(
        site,
        /onboardingCompletedAt: onboardingCompletedAtSeedStamp\(\)/,
        `${file}: a church insert stamps onboarding_completed_at with something other than the shared now() helper`
      );
    }
  }
});
