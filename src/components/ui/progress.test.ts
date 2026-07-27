import assert from "node:assert/strict";
import { test } from "node:test";

import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";

import { PersonTrainingProgress } from "@/components/people/person-training-progress";
import type { PersonTrainingItem } from "@/lib/ministry-teams/service";

import { Progress } from "./progress";

// ----------------------------------------------------------------------------
// A tiny markup reader. `renderToStaticMarkup` gives us the exact DOM the
// browser receives, so asserting on the parsed attributes of that markup is a
// real assertion about the rendered element — no jsdom needed for a component
// whose entire contract is attributes and an inline style.
// ----------------------------------------------------------------------------

interface RenderedElement {
  tag: string;
  attrs: Record<string, string>;
}

function parseElements(html: string): RenderedElement[] {
  const elements: RenderedElement[] = [];
  const tagPattern = /<([a-zA-Z][\w-]*)((?:\s+[\w:.-]+="[^"]*")*)\s*\/?>/g;
  const attrPattern = /([\w:.-]+)="([^"]*)"/g;

  for (const match of html.matchAll(tagPattern)) {
    const attrs: Record<string, string> = {};
    for (const attr of (match[2] ?? "").matchAll(attrPattern)) {
      attrs[attr[1]] = attr[2];
    }
    elements.push({ tag: match[1], attrs });
  }

  return elements;
}

function bySlot(html: string, slot: string): RenderedElement {
  const found = parseElements(html).find(
    (el) => el.attrs["data-slot"] === slot
  );
  assert.ok(found, `expected an element with data-slot="${slot}" in: ${html}`);
  return found;
}

/** The root + indicator pair of the first Progress in the markup. */
function renderProgress(props: Parameters<typeof Progress>[0] = {}) {
  const html = renderToStaticMarkup(createElement(Progress, props));
  return {
    html,
    root: bySlot(html, "progress"),
    indicator: bySlot(html, "progress-indicator"),
  };
}

// ----------------------------------------------------------------------------
// The bug: `value` was destructured out of the props and never handed to
// ProgressPrimitive.Root, so every bar was permanently indeterminate.
// ----------------------------------------------------------------------------

test("value reaches the root: a bar at 50% is half filled and reports 50", () => {
  const { root, indicator } = renderProgress({ value: 50 });

  assert.equal(root.attrs["role"], "progressbar");
  assert.equal(root.attrs["aria-valuenow"], "50");
  assert.equal(root.attrs["aria-valuemin"], "0");
  assert.equal(root.attrs["aria-valuemax"], "100");
  assert.equal(root.attrs["data-value"], "50");
  // Half filled: the indicator is translated left by the *unfilled* half.
  assert.equal(indicator.attrs["style"], "transform:translateX(-50%)");
});

test("data-state tracks the value at 0, 50 and 100 — never stuck indeterminate", () => {
  const empty = renderProgress({ value: 0 });
  assert.equal(empty.root.attrs["data-state"], "loading");
  assert.equal(empty.root.attrs["aria-valuenow"], "0");
  assert.equal(empty.indicator.attrs["style"], "transform:translateX(-100%)");

  const half = renderProgress({ value: 50 });
  assert.equal(half.root.attrs["data-state"], "loading");

  const full = renderProgress({ value: 100 });
  assert.equal(full.root.attrs["data-state"], "complete");
  assert.equal(full.root.attrs["aria-valuenow"], "100");
  assert.equal(full.indicator.attrs["style"], "transform:translateX(-0%)");

  // The indicator must agree with the root, not drift from it.
  for (const rendered of [empty, half, full]) {
    assert.equal(
      rendered.indicator.attrs["data-state"],
      rendered.root.attrs["data-state"]
    );
  }
});

test("a genuinely indeterminate bar (no value) still renders indeterminate", () => {
  const { root, indicator } = renderProgress();

  assert.equal(root.attrs["data-state"], "indeterminate");
  assert.equal(root.attrs["aria-valuenow"], undefined);
  assert.equal(root.attrs["data-value"], undefined);
  assert.equal(indicator.attrs["style"], "transform:translateX(-100%)");

  // An explicit `null` is the same thing.
  const explicitNull = renderProgress({ value: null });
  assert.equal(explicitNull.root.attrs["data-state"], "indeterminate");
  assert.equal(explicitNull.root.attrs["aria-valuenow"], undefined);
});

test("max is forwarded and the fill is measured against it", () => {
  const { root, indicator } = renderProgress({ value: 50, max: 200 });

  assert.equal(root.attrs["aria-valuemax"], "200");
  assert.equal(root.attrs["aria-valuenow"], "50");
  assert.equal(root.attrs["data-state"], "loading");
  // 50 of 200 is a quarter full.
  assert.equal(indicator.attrs["style"], "transform:translateX(-75%)");
});

test("an out-of-range value clamps: 150 renders full and announces 100", () => {
  // Ruling on #149 (PR #174): clamp rather than fall back to indeterminate —
  // an empty, unannounced bar at 105% would read as the opposite of the truth.
  // No console.error suppression needed: Radix only ever sees the clamped,
  // valid value.
  const over = renderProgress({ value: 150 });
  assert.equal(over.root.attrs["data-state"], "complete");
  assert.equal(over.root.attrs["aria-valuenow"], "100");
  assert.equal(over.indicator.attrs["style"], "transform:translateX(-0%)");

  const negative = renderProgress({ value: -5 });
  assert.equal(negative.root.attrs["data-state"], "loading");
  assert.equal(negative.root.attrs["aria-valuenow"], "0");
  assert.equal(negative.indicator.attrs["style"], "transform:translateX(-100%)");

  // A non-numeric value is still genuinely indeterminate, not clamped to 0.
  const nan = renderProgress({ value: NaN });
  assert.equal(nan.root.attrs["data-state"], "indeterminate");
  assert.equal(nan.root.attrs["aria-valuenow"], undefined);
});

test("className and arbitrary props still reach the root", () => {
  const { root } = renderProgress({
    value: 40,
    className: "h-3 w-24",
    "aria-label": "Training completion",
  });

  assert.ok(root.attrs["class"]?.includes("h-3"));
  assert.ok(root.attrs["class"]?.includes("w-24"));
  assert.ok(root.attrs["class"]?.includes("rounded-full"));
  assert.equal(root.attrs["aria-label"], "Training completion");
  assert.equal(root.attrs["aria-valuenow"], "40");
});

// ----------------------------------------------------------------------------
// Consumer regression: Progress is a shared primitive, so the blast radius of
// this change is every bar in the product. Training Progress is the consumer
// that surfaced the bug.
// ----------------------------------------------------------------------------

function trainingItem(
  overrides: Partial<PersonTrainingItem> & { programId: string }
): PersonTrainingItem {
  return {
    programName: overrides.programId,
    teamId: null,
    teamName: null,
    isRequired: false,
    completedAt: null,
    ...overrides,
  };
}

test("Training Progress still renders, now with a bar that fills", () => {
  const html = renderToStaticMarkup(
    createElement(PersonTrainingProgress, {
      items: [
        trainingItem({
          programId: "safety",
          isRequired: true,
          completedAt: new Date("2026-01-05T00:00:00Z"),
        }),
        trainingItem({ programId: "doctrine", isRequired: true }),
      ],
    })
  );

  assert.ok(html.includes("Training Progress"));
  assert.ok(html.includes("1 of 2 required complete"));

  const root = bySlot(html, "progress");
  assert.equal(root.attrs["aria-valuenow"], "50");
  assert.equal(root.attrs["data-state"], "loading");
  assert.equal(
    root.attrs["aria-label"],
    "Training completion: 1 of 2 required complete"
  );
  assert.equal(
    bySlot(html, "progress-indicator").attrs["style"],
    "transform:translateX(-50%)"
  );
});

test("Training Progress with nothing assigned renders its empty state", () => {
  const html = renderToStaticMarkup(
    createElement(PersonTrainingProgress, { items: [] })
  );

  assert.ok(html.includes("No training assigned"));
  assert.equal(
    parseElements(html).some((el) => el.attrs["data-slot"] === "progress"),
    false
  );
});
