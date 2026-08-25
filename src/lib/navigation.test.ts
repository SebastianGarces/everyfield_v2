import assert from "node:assert/strict";
import { readdirSync } from "node:fs";
import path from "node:path";
import { test } from "node:test";

import type { NavItem } from "./navigation";
import {
  isPathWithin,
  mainNavItems,
  networkAdminNavItems,
  resolveActiveNavHref,
  resolveTenancyShell,
  sendingChurchNavItems,
} from "./navigation";

test("the authenticated shell names each tenancy and its home", () => {
  assert.deepEqual(resolveTenancyShell("church"), {
    label: "Church Planting",
    homeHref: "/dashboard",
  });
  assert.deepEqual(resolveTenancyShell("sending_church"), {
    label: "Sending Church",
    homeHref: "/oversight",
  });
  assert.deepEqual(resolveTenancyShell("network"), {
    label: "Sending Network",
    homeHref: "/oversight",
  });
});

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
// Every nav item points at a page that exists
//
// #260: the two oversight nav sets shipped items for /oversight/plants,
// /oversight/sending-churches, /oversight/invitations and /oversight/settings
// while only the index and health pages existed. An oversight admin sees ONLY
// this sidebar, so a dead item is a 404 with no way back — worse than a
// missing feature. This test reads the App Router tree so the guard cannot go
// stale: it fails when someone adds a nav href before its page.tsx, and stops
// failing the moment the page lands.
//
// #272 extends the same guard to `mainNavItems`. `wikiNavSections` stays OUT of
// it: its hrefs are served by the catch-all `/wiki/[...slug]`, and the walker
// below skips dynamic segments by design, so every wiki item would read as
// missing.
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

/**
 * Items a user can actually click: an href, and not greyed out. A disabled row
 * renders `pointer-events-none` with a COMING SOON label (`nav-main.tsx`), so it
 * is a promise rather than a dead link — the guard below judges links only.
 */
function navigableItems(items: NavItem[]): { title: string; href: string }[] {
  return items.flatMap((item) => [
    ...(item.href && !item.isDisabled
      ? [{ title: item.title, href: item.href }]
      : []),
    ...navigableItems(item.items ?? []),
  ]);
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

test("every main nav item resolves to a real page", () => {
  // #272: the church-role sidebar gets the #260 guard too. It differs in one
  // way, and only one: an unbuilt feature MAY stay visible here as a disabled
  // COMING SOON row (the oversight sets must drop the item instead), so the
  // guard checks the items that are actually clickable.
  const routes = new Set(collectStaticRoutes(APP_DIR));
  // Sanity-check the walker itself before trusting its verdict.
  assert.ok(routes.has("/dashboard"), "walker should find /dashboard");

  for (const item of navigableItems(mainNavItems)) {
    assert.ok(
      routes.has(item.href),
      `mainNavItems → "${item.title}" links to ${item.href}, which has no page.tsx — ship the page in the same change, or mark the item isDisabled until it lands (#272)`
    );
  }
});

test("a COMING SOON row is exempt from the main-nav page-exists guard", () => {
  // The nav-family split, pinned: `mainNavItems` may keep an unbuilt feature as
  // a disabled row, so the guard passes over it. The oversight sets have no
  // such escape — the test below asserts they carry no disabled item at all.
  assert.deepEqual(
    navigableItems([
      { title: "Financial", href: "/financial", isDisabled: true },
      { title: "Tasks", href: "/tasks" },
    ]).map((item) => item.href),
    ["/tasks"]
  );
});

test("only the built routes are back in the sidebar", () => {
  // #260 hid four oversight items whose pages did not exist. Each comes back
  // in the change that builds its page — #23 for Invitations, #303 for Church
  // Plants and Sending Churches — which is the rule the test above enforces.
  // This asserts each un-hiding stayed surgical rather than becoming a blanket
  // revert.
  for (const items of [sendingChurchNavItems, networkAdminNavItems]) {
    const hrefs = items.map((item) => item.href);
    assert.ok(
      hrefs.includes("/oversight/invitations"),
      "/oversight/invitations ships with #23"
    );
    assert.ok(
      hrefs.includes("/oversight/plants"),
      "/oversight/plants ships with #303 (OV-001/OV-002)"
    );
    assert.ok(
      // NOT merely unbuilt: dropped from alpha by ruling (oversight FRD
      // non-goals, board #185). A page appearing does not re-admit this one.
      !hrefs.includes("/oversight/settings"),
      "/oversight/settings must stay hidden (#260)"
    );
  }
});

test("the sending-churches roster is offered to network admins alone", () => {
  // OV-009: the roster is network-admins-only and its page answers a
  // sending-church admin with `notFound()`. A nav item they can see but not
  // open is the #260 failure in a new costume — the two halves of the rule are
  // asserted together so neither can drift.
  assert.ok(
    networkAdminNavItems
      .map((item) => item.href)
      .includes("/oversight/sending-churches"),
    "/oversight/sending-churches ships with #303 (OV-009) for network admins"
  );
  assert.ok(
    !sendingChurchNavItems
      .map((item) => item.href)
      .includes("/oversight/sending-churches"),
    "a sending-church admin is refused the roster, so must not be offered it"
  );
});

// ----------------------------------------------------------------------------
// Launch (LS-004) — a church-role entry, and only that
// ----------------------------------------------------------------------------

test("Launch is in the church-role nav, with a page behind it", () => {
  const launch = mainNavItems.find((item) => item.href === "/launch");
  assert.ok(
    launch,
    "/launch must be reachable from the planter sidebar (LS-004)"
  );
  // Same rule #260 wrote for the oversight lists, applied to the item this
  // change adds: the nav item and its page.tsx ship together.
  assert.ok(
    new Set(collectStaticRoutes(APP_DIR)).has("/launch"),
    "/launch is in the nav, so src/app/(dashboard)/launch/page.tsx must exist"
  );
  // A launch belongs to a plant. Without a church there is nothing to count
  // down to, and the page redirects — so the sidebar says CHURCH REQUIRED
  // rather than offering a link that bounces.
  assert.equal(launch.requiresChurch, true);
  assert.notEqual(launch.isDisabled, true);
});

test("Launch is offered to church roles alone, never to oversight", () => {
  // `/launch` is the plant's own surface: it admits planter/coach/team_member
  // and redirects everyone else. An oversight admin sees ONLY their own
  // sidebar, so a link that redirects them is the #260 failure in a new
  // costume. Their launch date comes from /oversight/plants — the same entity,
  // a different surface.
  for (const items of [sendingChurchNavItems, networkAdminNavItems]) {
    assert.ok(
      !items.map((item) => item.href).includes("/launch"),
      "oversight navs must not offer /launch"
    );
  }
});

test("the launch page lights Launch, not Dashboard", () => {
  assert.deepEqual(activeTitles("/launch", mainNavItems), ["Launch"]);
});

test("the plants directory and its detail route light the same nav item", () => {
  // The detail page is a child route, not a sibling nav item: landing on it
  // must keep "Church Plants" lit rather than falling back to the oversight
  // index (the #260/#261 failure mode this resolver exists for).
  for (const items of [sendingChurchNavItems, networkAdminNavItems]) {
    assert.deepEqual(
      activeTitles(
        "/oversight/plants/6f1c0f9e-0000-4000-8000-000000000000",
        items
      ),
      ["Church Plants"]
    );
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
