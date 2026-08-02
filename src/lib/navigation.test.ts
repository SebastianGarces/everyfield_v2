import assert from "node:assert/strict";
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
