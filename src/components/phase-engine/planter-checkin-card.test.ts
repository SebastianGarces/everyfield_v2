// ============================================================================
// THE PROMISE AND THE CONTROL, ASSERTED TOGETHER (#634).
//
// The answered card said "or change your answer any time before then" and then
// rendered nothing that could. The bug was found in a browser by counting the
// card's interactive descendants and getting zero, so that is the shape of the
// test: render the real component the way `citation-voice.test.ts` next door
// does, and count what a browser would receive.
//
// A grep for the button's label would pass on a `<Button>` sitting in a branch
// that never renders. Only the markup knows.
//
// The draft round-trip these panels are built on is asserted next door, in
// `lib/phase-engine/planter-checkin.test.ts` — it is domain logic, not markup.
// ============================================================================

import assert from "node:assert/strict";
import { test } from "node:test";

import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";

import {
  CHECKIN_DIMENSIONS,
  type CheckinAnswer,
} from "@/lib/phase-engine/planter-checkin";

import { PlanterCheckinCard, type CheckinWeek } from "./planter-checkin-card";

const ANSWER: CheckinAnswer = {
  spiritually: "strained",
  marriageFamily: "steady",
  financially: "struggling",
  pace: "strained",
  note: "Hard week. Tell Ana on Saturday.",
};

/**
 * Three answered weeks, so the strip renders its dots rather than taking its
 * "nothing yet" early return. The control count below is then taken over a card
 * that draws everything a real one draws, which is what the browser repro did.
 */
const WEEKS: CheckinWeek[] = ["2026-08-03", "2026-08-10", "2026-08-17"].map(
  (weekStart) => ({
    weekStart,
    levels: {
      spiritually: "steady",
      marriageFamily: "steady",
      financially: "strained",
      pace: "strained",
    },
  })
);

function render(thisWeek: CheckinAnswer | null): string {
  return renderToStaticMarkup(
    createElement(PlanterCheckinCard, { thisWeek, weeks: WEEKS, nudges: [] })
  );
}

/** Every interactive descendant, the way the browser repro counted them. */
function controls(markup: string): number {
  return (markup.match(/<(?:button|a|input|textarea|select)\b/g) ?? []).length;
}

// -- the defect ---------------------------------------------------------------

test("the answered card renders the change it promises (#634)", () => {
  const markup = render(ANSWER);

  assert.match(markup, /change your answer any time before then/);
  assert.match(markup, /Change my answer/);
  assert.ok(
    controls(markup) > 0,
    "the answered card promised a change and rendered no control that could make it — the planter got one attempt per week"
  );
});

test("an unanswered week opens straight into the form", () => {
  const markup = render(null);

  // The answered panel is UNREACHABLE without an answer. The shape this
  // replaced latched "answered" at mount, so a page left open across a Monday
  // told the planter they had answered a week nobody had.
  assert.doesNotMatch(markup, /You have answered this week/);
  assert.doesNotMatch(markup, /Change my answer/);
  // …and no Cancel: on an unanswered week the form IS the card, so there is
  // nothing to cancel back to.
  assert.doesNotMatch(markup, /Cancel/);
  assert.match(markup, /Save this week/);
  assert.match(markup, /How are you doing with the Lord this week\?/);
});

test("both panels are really rendering, so neither test asserts on an empty card", () => {
  // A render that threw or returned nothing would satisfy `doesNotMatch` above.
  for (const markup of [render(ANSWER), render(null)]) {
    assert.match(markup, /data-testid="planter-checkin"/);
    assert.match(markup, /data-testid="checkin-strip"/);
  }
});

// The same response labels repeat across dimensions. The native groups must
// announce which question each set answers, rather than twelve unnamed peers.
test("each response group has its dimension name and question description", () => {
  const markup = render(null);
  const groups = [
    ...markup.matchAll(/<fieldset([^>]*)>([\s\S]*?)<\/fieldset>/g),
  ];
  assert.equal(groups.length, CHECKIN_DIMENSIONS.length);

  for (const [index, [, attributes, content]] of groups.entries()) {
    const dimension = CHECKIN_DIMENSIONS[index];
    const descriptionId = attributes.match(/aria-describedby="([^"]+)"/)?.[1];
    assert.ok(
      descriptionId,
      `${dimension.label} needs its question description`
    );
    assert.ok(
      content.includes(`>${dimension.label.replaceAll("&", "&amp;")}</legend>`),
      `${dimension.label} needs a native legend`
    );
    assert.ok(content.includes(`id="${descriptionId}"`));
    assert.ok(content.includes(dimension.prompt));
    assert.equal((content.match(/aria-pressed="false"/g) ?? []).length, 3);
    assert.equal((content.match(/<button /g) ?? []).length, 3);
  }
});
