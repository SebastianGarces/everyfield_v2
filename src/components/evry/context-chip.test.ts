import assert from "node:assert/strict";
import { test } from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";

import { EvryContextChip } from "./conversation-surface";

test("the visible page context chip names its source and offers removal", () => {
  const html = renderToStaticMarkup(
    createElement(EvryContextChip, {
      context: {
        key: "person:person-1",
        label: "Alex Rivera",
        wire: { kind: "person", recordId: "person-1" },
      },
      onRemove() {},
    })
  );

  assert.match(html, /aria-label="Page context"/);
  assert.match(html, />Alex Rivera</);
  assert.match(html, /aria-label="Remove Alex Rivera context"/);
  assert.match(html, /<button[^>]*type="button"/);
});

test("an insight source renders with the same removable context control", () => {
  const html = renderToStaticMarkup(
    createElement(EvryContextChip, {
      context: {
        key: "plant_insight:10000000-0000-4000-8000-000000000001",
        label: "Observation: Volunteer onboarding is unclear",
        wire: {
          kind: "plant_insight",
          recordId: "10000000-0000-4000-8000-000000000001",
        },
      },
      onRemove() {},
    })
  );

  assert.match(html, />Observation: Volunteer onboarding is unclear</);
  assert.match(
    html,
    /aria-label="Remove Observation: Volunteer onboarding is unclear context"/
  );
});
