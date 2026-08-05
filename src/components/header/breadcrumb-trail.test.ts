import assert from "node:assert/strict";
import { test } from "node:test";

import {
  FALLBACK_BREADCRUMB_LABEL,
  resolveBreadcrumbTrail,
} from "./breadcrumb-trail";

// ----------------------------------------------------------------------------
// The bug (#261): the current-page crumb named a DIFFERENT page.
// ----------------------------------------------------------------------------

test("a page that declares its name is named by it, not by the fallback", () => {
  const trail = resolveBreadcrumbTrail([{ label: "Plant Health" }]);

  assert.deepEqual(trail, [{ label: "Plant Health", isCurrent: true }]);
  assert.notEqual(trail[0].label, FALLBACK_BREADCRUMB_LABEL);
});

test("only a page that declares nothing gets the Dashboard fallback", () => {
  assert.deepEqual(resolveBreadcrumbTrail([]), [
    { label: FALLBACK_BREADCRUMB_LABEL, isCurrent: true },
  ]);
});

test("the fallback crumb is the current page, so it is never a link", () => {
  const [crumb] = resolveBreadcrumbTrail([]);

  assert.equal(crumb.isCurrent, true);
  assert.equal(crumb.href, undefined);
});

// ----------------------------------------------------------------------------
// Existing trails must render exactly as before (AC: other pages unchanged).
// ----------------------------------------------------------------------------

test("a declared trail keeps its order, links its ancestors and ends on the page", () => {
  assert.deepEqual(
    resolveBreadcrumbTrail([
      { label: "Ministry Teams", href: "/teams" },
      { label: "Health Dashboard" },
    ]),
    [
      { label: "Ministry Teams", href: "/teams", isCurrent: false },
      { label: "Health Dashboard", isCurrent: true },
    ]
  );
});

test("exactly one crumb is current, and it is the last one", () => {
  const trail = resolveBreadcrumbTrail([
    { label: "People & CRM", href: "/people" },
    { label: "John Doe", href: "/people/1" },
    { label: "Activity" },
  ]);

  assert.deepEqual(
    trail.map((crumb) => crumb.isCurrent),
    [false, false, true]
  );
});

test("the current page is not a link to itself even when an href is supplied", () => {
  const trail = resolveBreadcrumbTrail([
    { label: "Settings", href: "/settings" },
    { label: "Sharing", href: "/settings/sharing" },
  ]);

  assert.equal(trail[0].href, "/settings");
  assert.equal(trail[1].href, undefined);
});

test("an ancestor without an href stays plain text rather than a dead link", () => {
  const trail = resolveBreadcrumbTrail([
    { label: "Admin" },
    { label: "Feedback" },
  ]);

  assert.deepEqual(trail, [
    { label: "Admin", isCurrent: false },
    { label: "Feedback", isCurrent: true },
  ]);
});

test("resolving does not mutate or alias the caller's items", () => {
  const items = [{ label: "Tasks", href: "/tasks" }, { label: "New task" }];
  const snapshot = structuredClone(items);

  const trail = resolveBreadcrumbTrail(items);

  assert.deepEqual(items, snapshot);
  assert.notEqual(trail[0], items[0]);
});
