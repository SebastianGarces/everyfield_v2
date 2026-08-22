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
// ============================================================================

import assert from "node:assert/strict";
import { test } from "node:test";

import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";

import type { CheckinAnswer } from "@/lib/phase-engine/planter-checkin";

import {
  PlanterCheckinCard,
  checkinDraftFrom,
  completeAnswer,
  type CheckinWeek,
} from "./planter-checkin-card";

const ANSWER: CheckinAnswer = {
  spiritually: "strained",
  marriageFamily: "steady",
  financially: "struggling",
  pace: "strained",
  note: "Hard week. Tell Ana on Saturday.",
};

/** Twelve empty slots — the strip is not what these tests are about. */
const WEEKS: CheckinWeek[] = Array.from({ length: 12 }, (_, index) => ({
  weekStart: `2026-0${index < 4 ? 6 : 8}-${String(index + 1).padStart(2, "0")}`,
  levels: null,
}));

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

  // No sentence about having answered, and no Cancel: on an unanswered week
  // the form IS the card, so there is nothing to cancel back to.
  assert.doesNotMatch(markup, /You have answered this week/);
  assert.doesNotMatch(markup, /Cancel/);
  assert.match(markup, /Save this week/);
  assert.match(markup, /How are you doing with the Lord this week\?/);
});

test("both states are reachable, so neither test is asserting on an empty card", () => {
  // A render that threw or returned nothing would satisfy `doesNotMatch` above.
  assert.ok(render(ANSWER).length > 500);
  assert.ok(render(null).length > 500);
});

// -- the note the reopened form must not eat ----------------------------------

test("reopening and saving unchanged writes back exactly what was there", () => {
  // The write is a whole-row upsert. A form reopened without the note would
  // save `note: null` over a note the planter wrote and never told them.
  const roundTripped = completeAnswer(checkinDraftFrom(ANSWER));

  assert.deepEqual(roundTripped, ANSWER);
});

test("a note of nothing but whitespace is stored as no note", () => {
  const draft = checkinDraftFrom({ ...ANSWER, note: null });
  draft.note = "   ";

  assert.equal(completeAnswer(draft)?.note, null);
});

test("a half-tapped draft is not saveable", () => {
  const draft = checkinDraftFrom(null);
  draft.answers.spiritually = "steady";
  draft.answers.pace = "strained";

  assert.equal(completeAnswer(draft), null);
});
