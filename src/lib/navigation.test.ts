import assert from "node:assert/strict";
import { readdirSync } from "node:fs";
import path from "node:path";
import { test } from "node:test";

import {
  isPathWithin,
  mainNavItems,
  networkAdminNavItems,
  resolveActiveNavHref,
  sendingChurchNavItems,
} from "./navigation";

// ----------------------------------------------------------------------------
// One active item per route
//
// The regression this guards is a plain `pathname.startsWith(item.href)`: an
// index route is a prefix of every sibling under it, so on /oversight/health
// both "Network Overview" (/oversight) and "Plant Health" lit up at once.
// ----------------------------------------------------------------------------

function activeTitles(pathname: string, items: typeof mainNavItems) {
  const activeHref = resolveActiveNavHref(pathname, items);
  return items
    .filter((item) => item.href !== undefined && item.href === activeHref)
    .map((item) => item.title);
}

test("isPathWithin respects the segment boundary", () => {
  assert.equal(isPathWithin("/oversight", "/oversight"), true);
  assert.equal(isPathWithin("/oversight/health", "/oversight"), true);
  assert.equal(isPathWithin("/oversight-archive", "/oversight"), false);
  assert.equal(isPathWithin("/oversightly", "/oversight"), false);
});

test("an index route does not share activation with its children", () => {
  assert.deepEqual(activeTitles("/oversight/health", networkAdminNavItems), [
    "Plant Health",
  ]);
  assert.deepEqual(activeTitles("/oversight", networkAdminNavItems), [
    "Network Overview",
  ]);
  assert.deepEqual(activeTitles("/oversight/health", sendingChurchNavItems), [
    "Plant Health",
  ]);
  assert.deepEqual(activeTitles("/oversight", sendingChurchNavItems), [
    "Portfolio",
  ]);
});

test("a detail route activates its section, not the dashboard", () => {
  assert.deepEqual(activeTitles("/people/abc-123", mainNavItems), [
    "People & CRM",
  ]);
  assert.deepEqual(activeTitles("/dashboard", mainNavItems), ["Dashboard"]);
  assert.deepEqual(activeTitles("/wiki/journey/phase-1", mainNavItems), [
    "Wiki",
  ]);
});

test("every nav route lights exactly one item, never two", () => {
  const navs = [mainNavItems, sendingChurchNavItems, networkAdminNavItems];
  for (const items of navs) {
    for (const item of items) {
      if (!item.href) continue;
      for (const pathname of [item.href, `${item.href}/nested/detail`]) {
        assert.deepEqual(
          activeTitles(pathname, items),
          [item.title],
          `${pathname} should activate only ${item.title}`
        );
      }
    }
  }
});

test("an unmatched route activates nothing", () => {
  assert.equal(resolveActiveNavHref("/settings", mainNavItems), null);
  assert.deepEqual(activeTitles("/notifications", mainNavItems), []);
});

// ----------------------------------------------------------------------------
// Every oversight nav item points at a page that exists
//
// #260: the two oversight nav sets shipped items for /oversight/plants,
// /oversight/sending-churches, /oversight/invitations and /oversight/settings
// while only the index and health pages existed. An oversight admin sees ONLY
// this sidebar, so a dead item is a 404 with no way back — worse than a
// missing feature. This test reads the App Router tree so the guard cannot go
// stale: it fails when someone adds a nav href before its page.tsx, and stops
// failing the moment the page lands.
// ----------------------------------------------------------------------------

const APP_DIR = path.join(process.cwd(), "src", "app");

/** Static route paths in the App Router tree, route groups stripped. */
function collectStaticRoutes(dir: string, route = ""): string[] {
  const routes: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (entry.isFile()) {
      if (/^page\.tsx?$/.test(entry.name)) routes.push(route || "/");
      continue;
    }
    if (!entry.isDirectory()) continue;
    // Route groups `(x)` and private folders `_x` add no URL segment; skip
    // dynamic (`[slug]`) and parallel (`@slot`) segments — no nav item uses one.
    if (entry.name.startsWith("[") || entry.name.startsWith("@")) continue;
    const isTransparent =
      entry.name.startsWith("(") || entry.name.startsWith("_");
    routes.push(
      ...collectStaticRoutes(
        path.join(dir, entry.name),
        isTransparent ? route : `${route}/${entry.name}`
      )
    );
  }
  return routes;
}

test("every oversight nav item resolves to a real page", () => {
  const routes = new Set(collectStaticRoutes(APP_DIR));
  // Sanity-check the walker itself before trusting its verdict.
  assert.ok(routes.has("/oversight"), "walker should find /oversight");

  for (const [name, items] of [
    ["sendingChurchNavItems", sendingChurchNavItems],
    ["networkAdminNavItems", networkAdminNavItems],
  ] as const) {
    for (const item of items) {
      if (!item.href) continue;
      assert.ok(
        routes.has(item.href),
        `${name} → "${item.title}" links to ${item.href}, which has no page.tsx — hide the item until the page exists (#260)`
      );
    }
  }
});

test("oversight index and health stay reachable from the sidebar", () => {
  for (const items of [sendingChurchNavItems, networkAdminNavItems]) {
    const hrefs = items.map((item) => item.href);
    assert.ok(hrefs.includes("/oversight"), "/oversight must stay in the nav");
    assert.ok(
      hrefs.includes("/oversight/health"),
      "/oversight/health must stay in the nav"
    );
    // Nothing hidden may linger as a disabled/COMING SOON row either — an
    // oversight admin has no other navigation to fall back on.
    assert.deepEqual(
      items.filter((item) => item.isDisabled).map((item) => item.title),
      []
    );
  }
});
