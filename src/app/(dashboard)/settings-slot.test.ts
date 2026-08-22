import assert from "node:assert/strict";
import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { test } from "node:test";

// ============================================================================
// ONE SETTINGS MODAL, BY TOPOLOGY (#640, #646).
//
// WHY THIS FILE EXISTS. #632 made settings a modal with two route halves: an
// intercepting one in the `@settings` slot for an in-app opening, and a
// non-intercepting one under the layout's `children` for a cold load. Parallel
// slots render BESIDE `children`, so both halves could be on screen at once,
// and a rule inside the component compared the address bar against the path its
// own copy was rendered for to decide which one stood down.
//
// That rule re-evaluated every render instead of latching, so it un-stood: after
// a cold load at `/settings/church`, leaving the section and coming back made
// the pinned `children` copy match its own path again, and the reader got two
// dialogs, two focus traps and two Close buttons (#646).
//
// The fix is not a better rule. It is moving the cold-load half INTO the slot,
// where it is the interceptor's sibling: a slot holds at most one match, so two
// copies stop being something to rule out and become something that cannot be
// built. This file is what holds that shape — a `/settings/*` page reappearing
// under `children` is exactly the regression, and it is invisible in a diff
// because it looks like an ordinary page.
//
// The runtime half of the proof is `scripts/prove-settings-slot.ts`, which walks
// all five arrivals against a real server and counts the modals in the wire.
// ============================================================================

const SRC = path.join(process.cwd(), "src");
const GROUP = path.join(SRC, "app", "(dashboard)");

/** Every `page.tsx` under the `(dashboard)` group, as a group-relative path. */
function pagesUnder(dir: string): string[] {
  return readdirSync(dir).flatMap((entry) => {
    const full = path.join(dir, entry);
    if (statSync(full).isDirectory()) return pagesUnder(full);
    return entry === "page.tsx" ? [path.relative(GROUP, full)] : [];
  });
}

/** The pages that draw the settings modal, whatever route they sit at. */
const MODAL_PAGES = pagesUnder(GROUP).filter((page) =>
  readFileSync(path.join(GROUP, page), "utf8").includes("<SettingsSurface")
);

test("every route that draws the settings modal is in the @settings slot", () => {
  // The whole guarantee, in one assertion. A `/settings/*` page under `children`
  // is a second copy of the modal on every cold load — #646 — and no amount of
  // care inside the component can make two rendered dialogs into one.
  const strays = MODAL_PAGES.filter(
    (page) => !page.startsWith(`@settings${path.sep}`)
  );
  assert.deepEqual(
    strays,
    [],
    "a settings page outside the @settings slot renders a SECOND modal beside the slot's"
  );
});

test("each settings URL has both an intercepted and a cold-load route", () => {
  // Deleting either half is a silent break rather than a failure: without the
  // interceptor an in-app opening unmounts the screen behind the modal, and
  // without its twin a pasted URL renders no modal at all — an intercepting
  // route is bypassed on a full page load.
  assert.deepEqual(MODAL_PAGES.toSorted(), [
    path.join("@settings", "(.)settings", "[section]", "page.tsx"),
    path.join("@settings", "(.)settings", "page.tsx"),
    path.join("@settings", "settings", "[section]", "page.tsx"),
    path.join("@settings", "settings", "page.tsx"),
  ]);
});

test("only the intercepting half claims an overlay", () => {
  // `overlaid` is the ONE argument the four routes differ in, and it decides the
  // one thing they disagree about: whether Close goes back to a live screen or
  // to the account's home. The interceptor matched means a screen is behind.
  for (const page of MODAL_PAGES) {
    const source = readFileSync(path.join(GROUP, page), "utf8");
    const intercepting = page.includes("(.)settings");
    assert.ok(
      source.includes(`overlaid={${intercepting}}`),
      `${page} must pass overlaid={${intercepting}}`
    );
  }
});

test("the modal never decides whether to render from the address bar", () => {
  // THE #646 DEFECT ITSELF. `if (!overlaid && pathname !== ownPath) return null`
  // was the stand-down rule, and a rule is what the topology above replaced. A
  // component that can render nothing depending on the URL is a component that
  // can render TWICE depending on the URL.
  const modal = readFileSync(
    path.join(SRC, "components", "settings", "settings-modal.tsx"),
    "utf8"
  );
  assert.ok(
    !modal.includes("usePathname"),
    "the settings modal reads the pathname again — the stand-down rule is back"
  );
});
