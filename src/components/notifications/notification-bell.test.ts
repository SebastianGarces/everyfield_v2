import assert from "node:assert/strict";
import { test } from "node:test";

import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";

import { parseElements } from "@/lib/testing/rendered-markup";

import {
  NotificationBell,
  UNCOUNTED_BELL_LABEL,
  type UnreadCount,
  unreadBellLabel,
} from "./notification-bell";

// ----------------------------------------------------------------------------
// The bell has THREE states and only one of them is a count (#308 WS2, from
// #232; #528).
//
// The defect these tests pin: both non-count states arrived as the number the
// FAILURE path returned — `0` — so the first paint of every dashboard route,
// and every render after a failed read, announced "Notifications, none unread"
// to a screen reader. One number was standing for three different facts: "none
// unread", "we could not read it" and "we have not read it yet".
//
// The fix is the TYPE, which is why there are no source-grep tests here any
// more. `UnreadCount = number | "loading" | "unavailable"` makes the two
// non-answers unspellable as counts, so the compiler refuses what a grep for a
// constant name used to have to notice.
//
// `renderToStaticMarkup` gives the exact markup the browser parses, so what is
// asserted here is the rendered element, not the JSX that produced it.
// ----------------------------------------------------------------------------

/** The bell's own anchor, read off the rendered markup. */
function bellLink(unreadCount: UnreadCount) {
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
// 1. Neither non-answer asserts anything about the count
// ----------------------------------------------------------------------------

test("neither uncounted bell claims unread state, in the name or in data", () => {
  for (const state of ["loading", "unavailable"] as const) {
    const { link, html } = bellLink(state);

    assert.equal(link.attrs["aria-label"], UNCOUNTED_BELL_LABEL);
    // The specific string this replaced. It is an assertion about unread state,
    // and the shell has no count to make it with.
    assert.notEqual(
      link.attrs["aria-label"],
      unreadBellLabel(0),
      `the ${state} bell told the reader they have nothing unread`
    );

    assert.equal(
      link.attrs["data-unread-count"],
      undefined,
      `the ${state} bell claimed a count a test could read as the answer`
    );
    assert.equal(link.attrs["data-unread-state"], state);
    assert.ok(
      !html.includes("notification-unread-badge"),
      `the ${state} bell rendered a badge`
    );
  }
});

test("aria-busy is what separates the two — an answer is coming, or it is not", () => {
  // `aria-busy` promises the value is about to change. On a read that has
  // already finished failing, that promise is a second thing the shell has not
  // earned; the render is otherwise identical.
  assert.equal(bellLink("loading").link.attrs["aria-busy"], "true");
  assert.equal(bellLink("unavailable").link.attrs["aria-busy"], undefined);
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
  // Neither non-answer is "zero by another name". A viewer who genuinely has
  // nothing unread gets told so, which is the whole reason the three states
  // could not share a representation.
  const { link, html } = bellLink(0);

  assert.equal(link.attrs["aria-label"], unreadBellLabel(0));
  assert.equal(link.attrs["data-unread-count"], "0");
  assert.equal(link.attrs["data-unread-state"], "ready");
  assert.ok(!html.includes("notification-unread-badge"));
});
