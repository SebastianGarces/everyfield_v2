import assert from "node:assert/strict";
import { test } from "node:test";

import { resolveGuideEntry, wikiGuideConfig } from "./guide-config";
import { wikiHref } from "./href";

// ============================================================================
// The guide config is the contract between a route and the articles its panel
// offers. Two things about it are load-bearing and neither is visible from the
// type, so both are pinned here.
//
// 1. A SLUG THAT DOES NOT RESOLVE IS A VISIBLE ERROR, NOT A NO-OP.
//    Unlike the insight card — which resolves stored slugs against the
//    published set and silently drops the stale ones
//    (`components/phase-engine/focus-presentation.ts` → `buildArticleLinks`) —
//    this config is trusted verbatim: the provider fetches `slugs[0]` and the
//    panel renders "Article not found" when the read layer returns 404
//    (`wiki-guide-panel.tsx`). `getArticleBySlug` filters `status = "published"`,
//    so an unpublished article fails exactly like a missing one.
//
//    The published set lives in the database, and this harness is pure — no
//    test here opens a connection. So publication cannot be ASSERTED here; it
//    is verified out of band and pinned below, which is the point of
//    `LAUNCH_GUIDE_SLUGS`: editing the config without re-verifying fails this
//    file rather than shipping an error panel.
//
// 2. THE PANEL'S LINKS ARE BUILT WITH `wikiHref`, SO THE CONFIG MUST HOLD RAW
//    SLUGS. The header link and footer link both call `wikiHref(slug)` (#310).
//    A pre-encoded or `/wiki/`-prefixed entry would be encoded twice and 404.
// ============================================================================

/**
 * The Launch Sunday list, verified published against the wiki read layer on
 * 2026-08-08 (`getAllPublishedArticles`, `status = "published"`, global
 * articles). Order is the panel's: `slugs[0]` is what opens by default.
 *
 * If you change `/launch` in the config, re-run that check and update this
 * list — do not just make the test green.
 */
const LAUNCH_GUIDE_SLUGS = [
  "launch-sunday/launch-day-guide",
  "launch-sunday/5-priority-details",
  "pre-launch/final-checklist-review",
  "pre-launch/operations-setup-teardown",
  "pre-launch/launch-team-spiritual-preparation",
  "pre-launch/the-promotion-plan",
];

test("/launch resolves to the Launch Sunday guide entry", () => {
  const entry = resolveGuideEntry("/launch");

  assert.ok(entry, "/launch has no guide entry — the panel button never shows");
  assert.equal(entry.label, "Launch Sunday Guide");
  assert.deepEqual(entry.slugs, LAUNCH_GUIDE_SLUGS);
});

test("the Launch Sunday entry opens on the day itself", () => {
  // The provider fetches `slugs[0]` when the panel opens, so the first slug is
  // a UI decision, not list order: a planter opening the guide from the
  // countdown gets the launch day overview, not a pre-launch sub-topic.
  const entry = resolveGuideEntry("/launch");
  assert.equal(entry?.slugs[0], "launch-sunday/launch-day-guide");
});

test("the Launch Sunday entry names each of the board's readiness areas", () => {
  // The three areas the milestone board renders
  // (`src/lib/launch/milestone-areas.ts`). Each one has an article behind it,
  // so the panel answers the question the board raises.
  const entry = resolveGuideEntry("/launch");
  const slugs = entry?.slugs ?? [];

  for (const area of [
    "pre-launch/operations-setup-teardown",
    "pre-launch/launch-team-spiritual-preparation",
    "pre-launch/the-promotion-plan",
  ]) {
    assert.ok(slugs.includes(area), `readiness area unrepresented: ${area}`);
  }
});

test("/launch does not swallow deeper or sibling routes", () => {
  // `matchPattern` compares segment counts, so a bare "/launch" pattern must
  // not claim a nested route that will want its own entry later.
  assert.equal(resolveGuideEntry("/launch/settings"), null);
  assert.equal(resolveGuideEntry("/launches"), null);
  assert.equal(resolveGuideEntry("/dashboard"), null);
});

test("/launch still matches when the URL carries unrelated search params", () => {
  // Pattern params are a subset test — a pattern with no params must match
  // whatever the page happens to carry, or a stray `?ref=` hides the button.
  const entry = resolveGuideEntry("/launch", { ref: "email", tab: "anything" });
  assert.equal(entry?.label, "Launch Sunday Guide");
});

// ----------------------------------------------------------------------------
// Whole-config invariants — cheap, and they catch a bad paste into any entry.
// ----------------------------------------------------------------------------

test("every configured slug is raw, so wikiHref encodes it exactly once", () => {
  for (const [pattern, entry] of Object.entries(wikiGuideConfig)) {
    for (const slug of entry.slugs) {
      assert.ok(
        !slug.startsWith("/"),
        `${pattern}: slug must not be a path: ${slug}`
      );
      assert.ok(
        !slug.startsWith("wiki/"),
        `${pattern}: slug must not carry the route prefix: ${slug}`
      );
      // Already-encoded entries would survive `wikiHref` visually but resolve
      // to a different stored slug once Next decodes the route param.
      assert.equal(
        wikiHref(slug),
        `/wiki/${slug}`,
        `${pattern}: slug needs escaping, so it is not a stored slug: ${slug}`
      );
    }
  }
});

test("no entry is empty or repeats a slug", () => {
  for (const [pattern, entry] of Object.entries(wikiGuideConfig)) {
    // `isAvailable` is false for an empty list, so the entry would be dead
    // config that reads as working.
    assert.ok(entry.slugs.length > 0, `${pattern}: has no slugs`);
    assert.ok(entry.label.trim().length > 0, `${pattern}: has no label`);
    assert.equal(
      new Set(entry.slugs).size,
      entry.slugs.length,
      `${pattern}: repeats a slug, which renders a duplicate related-article row`
    );
  }
});
