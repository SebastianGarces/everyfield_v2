import assert from "node:assert/strict";
import { test } from "node:test";

import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";

import type { Capability } from "@/lib/auth/seat-rules";

import { QuickActions } from "./quick-actions";

function render(capabilities: readonly Capability[]): string {
  return renderToStaticMarkup(createElement(QuickActions, { capabilities }));
}

test("Quick Actions promotes columns from its card container, not the viewport", () => {
  const twoActions = render([]);
  const threeActions = render(["people.write"]);
  const fourActions = render(["people.write", "meetings.write"]);

  assert.match(
    twoActions,
    /bg-card @container rounded-xl border p-6 shadow-sm/,
    "the card establishes the container that decides its action layout"
  );
  assert.match(
    twoActions,
    /grid grid-cols-2 gap-3/,
    "a narrow card starts with the readable two-column layout"
  );
  assert.match(
    threeActions,
    /@sm:grid-cols-3/,
    "three tiles wait for enough card content width before becoming three columns"
  );
  assert.match(
    fourActions,
    /@sm:grid-cols-3 @lg:grid-cols-4/,
    "four tiles step through three columns before using four at the wider container threshold"
  );
  assert.doesNotMatch(
    fourActions,
    /(?:^|\s)sm:grid-cols-[34]/,
    "viewport breakpoints must not decide a component nested in a narrow dashboard column"
  );
});

test("the marketing Quick Actions embed stays inert", () => {
  const html = renderToStaticMarkup(
    createElement(QuickActions, { linkStatic: true })
  );

  assert.doesNotMatch(html, /<a\b|\bhref=/, "the embed has no destinations");
  assert.doesNotMatch(
    html,
    /\btabindex=/i,
    "the static tiles do not enter keyboard focus order"
  );
  assert.match(
    html,
    /<span[^>]*>[\s\S]*Add Person/,
    "the visual action copy remains"
  );
});
