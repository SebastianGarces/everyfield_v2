import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { test } from "node:test";

import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";

import { parseElements } from "@/lib/testing/rendered-markup";

import {
  LOADING_BELL_LABEL,
  NotificationBell,
  unreadBellLabel,
} from "./notification-bell";

// ----------------------------------------------------------------------------
// The bell has THREE states, and loading is one of them (#308 WS2, from #232).
//
// The defect these tests pin: the layout's Suspense fallback rendered the bell
// with `DEGRADED_UNREAD_COUNT` — the value the count degrades to when the query
// FAILS — so the first paint of every dashboard route announced "Notifications,
// none unread" to a screen reader and then corrected itself to "1 unread" when
// the real count arrived. One constant was standing for two different facts:
// "we could not read it" and "we have not read it yet".
//
// `renderToStaticMarkup` gives the exact markup the browser parses, so what is
// asserted here is the rendered element, not the JSX that produced it. The
// source-shaped tests at the bottom are the other half: the render can only
// stay honest while the layout keeps passing the loading value, and the failure
// constant is one import away.
// ----------------------------------------------------------------------------

const DASHBOARD = path.join(process.cwd(), "src/app/(dashboard)");

/** The bell's own anchor, read off the rendered markup. */
function bellLink(unreadCount: number | "loading") {
  const html = renderToStaticMarkup(
    createElement(NotificationBell, { unreadCount })
  );
  const link = parseElements(html).find(
    (element) => element.attrs["data-testid"] === "notification-bell"
  );

  assert.ok(link, "the bell rendered no element carrying its test id");
  return { link, html };
}

// ----------------------------------------------------------------------------
// 1. Loading asserts nothing about the count
// ----------------------------------------------------------------------------

test("the loading bell has a NEUTRAL name and is marked busy", () => {
  const { link } = bellLink("loading");

  assert.equal(link.attrs["aria-label"], LOADING_BELL_LABEL);
  assert.equal(link.attrs["aria-busy"], "true");

  // The specific string this replaced. It is an assertion about unread state,
  // and the shell has not read one yet.
  assert.notEqual(link.attrs["aria-label"], unreadBellLabel(0));
});

test("the loading bell publishes no count, in the DOM or in data", () => {
  const { link, html } = bellLink("loading");

  assert.equal(
    link.attrs["data-unread-count"],
    undefined,
    "the loading bell claimed a count a test could read as the answer"
  );
  assert.equal(link.attrs["data-unread-state"], "loading");
  assert.ok(
    !html.includes("notification-unread-badge"),
    "the loading bell rendered a badge"
  );
});

test("resolving to a real count replaces every one of those", () => {
  // The other side of the boundary: once the count is known the bell says so,
  // in the name and in the data, and drops `aria-busy` entirely rather than
  // leaving a permanent `aria-busy="false"` for a screen reader to step over.
  const { link, html } = bellLink(3);

  assert.equal(link.attrs["aria-label"], unreadBellLabel(3));
  assert.equal(link.attrs["aria-busy"], undefined);
  assert.equal(link.attrs["data-unread-count"], "3");
  assert.equal(link.attrs["data-unread-state"], "ready");
  assert.ok(html.includes("notification-unread-badge"));
});

test("a real ZERO still says 'none unread' — it is an answer, not a placeholder", () => {
  // Loading is not "zero by another name". A viewer who genuinely has nothing
  // unread gets told so, which is the whole reason the two states could not
  // share a representation.
  const { link, html } = bellLink(0);

  assert.equal(link.attrs["aria-label"], unreadBellLabel(0));
  assert.equal(link.attrs["data-unread-count"], "0");
  assert.equal(link.attrs["data-unread-state"], "ready");
  assert.ok(!html.includes("notification-unread-badge"));
});

// ----------------------------------------------------------------------------
// 2. The failure constant is failure-only, and the layout does not reach for it
// ----------------------------------------------------------------------------

test("the Suspense fallback does not reference the failure constant", () => {
  const layout = readFileSync(path.join(DASHBOARD, "layout.tsx"), "utf8");

  // Comments stripped first: the fallback's own comment NAMES the constant to
  // say why it is not used, and a naive substring search would read that
  // explanation as the mistake it exists to prevent.
  const code = layout
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/(^|\s)\/\/.*$/gm, "$1");

  assert.ok(
    !code.includes("DEGRADED_UNREAD_COUNT"),
    "the dashboard layout is reaching for the failure constant again"
  );
  assert.match(
    layout,
    /<NotificationBell unreadCount="loading" \/>/,
    "the fallback is no longer the bell's loading state"
  );
});

test("DEGRADED_UNREAD_COUNT is still documented as the FAILURE value", () => {
  const badge = readFileSync(
    path.join(DASHBOARD, "notification-badge.ts"),
    "utf8"
  );

  assert.match(
    badge,
    /What the badge shows when the count could not be read\./,
    "the failure constant lost the docblock that says what it is for"
  );
  assert.match(
    badge,
    /FAILURE ONLY\./,
    "the docblock no longer rules out reusing it as the loading state"
  );
  assert.ok(
    badge.includes("export const DEGRADED_UNREAD_COUNT = 0;"),
    "the failure value is no longer zero, or no longer declared here"
  );
});
