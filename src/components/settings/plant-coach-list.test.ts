import assert from "node:assert/strict";
import { test } from "node:test";

import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";

import { namedButtons } from "@/lib/testing/rendered-markup";

import type { SeatActionOutcome } from "./seat-action-outcome";
import { PlantCoachList, type PlantCoachViewRow } from "./plant-coach-list";

// ----------------------------------------------------------------------------
// THE COACH LIST'S MARKUP — AS-018 and AS-024 (#497, pinned by #555).
//
// WHY THIS FILE EXISTS AT ALL. `canEndAssignments` is currently always `true`
// for anyone who gets past `/settings/team`'s redirect: the page gate is
// `seat.invitation.manage` and the control's rule is `coach.assignment.manage`,
// and both are `ADMIN_PLUS` on a plant. #544's review called the prop dead and
// proposed deleting it. It was KEPT, on the argument that it is what makes the
// control and the action read the SAME capability table — so that narrowing
// `coach.assignment.manage` later cannot leave a button standing beside an
// action that refuses it.
//
// That argument was the whole justification for the prop, and nothing asserted
// it. A guard kept for a reason no test states is a guard the next reader
// deletes, correctly, as dead — and the deletion looks safe right up until the
// capability moves. These two tests are that reason, written down where a
// change has to argue with them.
//
// The false case is therefore NOT dead-code testing: it is the branch the prop
// exists FOR, exercised directly rather than through a page state that cannot
// currently produce it.
// ----------------------------------------------------------------------------

const stub = async (): Promise<SeatActionOutcome> => ({
  success: false,
  error: "stub",
});

const ROWS: PlantCoachViewRow[] = [
  {
    assignmentId: "11111111-1111-4111-8111-111111111111",
    name: "Dana Coach",
    email: "dana@coach.test",
    assignedLabel: "Feb 2, 2026",
  },
  {
    assignmentId: "22222222-2222-4222-8222-222222222222",
    name: null,
    email: "nameless@coach.test",
    assignedLabel: "Mar 9, 2026",
  },
];

function render(canEndAssignments: boolean, rows: PlantCoachViewRow[] = ROWS) {
  return renderToStaticMarkup(
    createElement(PlantCoachList, {
      rows,
      canEndAssignments,
      endAssignment: stub,
    })
  );
}

/**
 * Undo React's HTML escaping, so an assertion reads in the words a screen
 * reader announces. Every label here holds a possessive apostrophe.
 */
function decode(text: string): string {
  return text.replace(/&#x27;|&#39;/g, "'").replace(/&amp;/g, "&");
}

const controlLabels = (html: string) =>
  namedButtons(html)
    .map((b) => decode(b.attrs["aria-label"]))
    .filter((label) => /coach assignment/.test(label));

test("a caller who may end an assignment gets one control per coach", () => {
  assert.deepEqual(
    controlLabels(render(true)).sort(),
    [
      "End Dana Coach's coach assignment",
      "End nameless@coach.test's coach assignment",
    ].sort(),
    "AS-018: every active assignment carries its own named control, and a coach with no name is addressed by their address"
  );
});

test("a caller who may not end an assignment sees no control in the markup", () => {
  // THE BRANCH THE PROP EXISTS FOR. Absent, not disabled (AS-020) — a greyed
  // button still announces a control somebody else may press.
  const html = render(false);

  assert.deepEqual(
    controlLabels(html),
    [],
    "the End-assignment control must not render when the caller does not carry coach.assignment.manage"
  );
  assert.doesNotMatch(
    html,
    /<button[^>]*\bdisabled\b/,
    "hidden means absent from the markup, never disabled"
  );
  assert.doesNotMatch(
    html,
    /End assignment/,
    "and the verb may not appear as text either"
  );
});

test("the coaches are still listed either way — only the control is gated", () => {
  // The absence is of the CONTROL, not of the information. AS-024 puts the
  // coach list beside the roster so an Owner auditing access sees both reaches
  // in one pass, and that read is not what `coach.assignment.manage` gates.
  for (const canEnd of [true, false]) {
    const html = render(canEnd);
    for (const shown of ["Dana Coach", "dana@coach.test", "Feb 2, 2026"]) {
      assert.ok(
        html.includes(shown),
        `${shown} must be listed whether or not the caller may end an assignment`
      );
    }
  }
});

test("a plant with no coaches says so rather than rendering an empty list", () => {
  const html = render(true, []);

  assert.ok(
    html.includes("No coach is assigned to this plant."),
    "an empty coach list needs an empty state — a bare card reads as a broken query"
  );
  assert.deepEqual(controlLabels(html), [], "and there is nothing to end");
});
