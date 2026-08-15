import assert from "node:assert/strict";
import { test } from "node:test";

import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";

import {
  buildResponseBreakdown,
  RESPONSE_CARD_OPTIONS,
  RESPONSE_NOT_RECORDED_COPY,
  RESPONSE_NOT_RECORDED_LABEL,
  RESPONSE_SUMMARY_EMPTY_COPY,
} from "@/lib/meetings/response-card";

import { ResponsePicker } from "./response-picker";
import { ResponseSummary } from "./response-summary";

// ----------------------------------------------------------------------------
// VM-014 (#98) — what the two response-card surfaces actually render.
//
// `renderToStaticMarkup` gives the exact markup the browser receives, so
// reading text and attributes off it is a real assertion about the rendered
// screen — the approach `attendance-capture.test.ts` and `ui/progress.test.ts`
// already use, with no jsdom needed for contracts that are text and attributes.
//
// Three things are pinned here, and each has already gone wrong somewhere in
// this repo:
//   - the breakdown reports the counts it was given (a summary that quietly
//     recomputed would drift from the query),
//   - the empty state says the cards are not KEYED IN rather than that nobody
//     responded, and it says it where a planter is looking,
//   - every clickable carries `cursor-pointer` (project hard rule, AGENTS.md).
// ----------------------------------------------------------------------------

function render(element: Parameters<typeof renderToStaticMarkup>[0]): string {
  return renderToStaticMarkup(element);
}

/** The rendered text with tags removed, so a count can be read as a reader would. */
function textOf(html: string): string {
  return html
    .replace(/<[^>]*>/g, " ")
    .replace(/&quot;/g, '"')
    .replace(/&#x27;/g, "'")
    .replace(/&amp;/g, "&")
    .replace(/\s+/g, " ")
    .trim();
}

// ============================================================================
// The breakdown
// ============================================================================

test("the breakdown shows one row per response type, with its count", () => {
  const html = render(
    createElement(ResponseSummary, {
      breakdown: buildResponseBreakdown(
        { ready_commit: 4, interested: 7, prayer_request: 1 },
        19
      ),
    })
  );

  for (const option of RESPONSE_CARD_OPTIONS) {
    assert.ok(
      html.includes(`data-testid="response-row-${option.value}"`),
      `${option.value} has a row — a zero-count row is a finding, not an absence`
    );
    assert.ok(
      textOf(html).includes(option.label),
      `${option.value} is headed by its label`
    );
  }

  const text = textOf(html);
  assert.match(text, /Ready to commit 4/, "the strongest response reports 4");
  assert.match(text, /Wants to learn more 7/);
  assert.match(text, /Asked for prayer 1/);
});

test("the scope line says how many of how many handed a card in", () => {
  const html = render(
    createElement(ResponseSummary, {
      breakdown: buildResponseBreakdown({ ready_commit: 4 }, 19),
    })
  );

  // An unlabelled "4" beside "Ready to commit" reads as a claim about the whole
  // room — the same reason the analytics page carries a scope line.
  assert.match(textOf(html), /4 of 19 attendees handed a card in\./);
});

test("an attendee with no card is its own line, and it says it is not a no", () => {
  // THE requirement. Fifteen silences must never be rendered as fifteen
  // refusals, and the screen has to say so rather than leave it to be inferred
  // from a row title.
  const html = render(
    createElement(ResponseSummary, {
      breakdown: buildResponseBreakdown({ ready_commit: 2, interested: 2 }, 19),
    })
  );
  const text = textOf(html);

  assert.ok(html.includes('data-testid="response-not-recorded"'));
  assert.match(text, new RegExp(`${RESPONSE_NOT_RECORDED_LABEL} 15`));
  assert.ok(text.includes(RESPONSE_NOT_RECORDED_COPY));

  // …and the negative row still reads zero, because nobody said no.
  assert.match(text, /Not interested 0/);
});

test("nobody unaccounted for means no unrecorded line at all", () => {
  const html = render(
    createElement(ResponseSummary, {
      breakdown: buildResponseBreakdown({ ready_commit: 3 }, 3),
    })
  );

  assert.ok(
    !html.includes('data-testid="response-not-recorded"'),
    "a zero unrecorded count renders nothing rather than a line of zeroes"
  );
});

test("percentages are shares of the cards, and vanish when there are none", () => {
  const withCards = render(
    createElement(ResponseSummary, {
      breakdown: buildResponseBreakdown({ ready_commit: 1, interested: 3 }, 40),
    })
  );
  assert.match(textOf(withCards), /Ready to commit 1 25%/);

  const noCards = render(
    createElement(ResponseSummary, {
      breakdown: buildResponseBreakdown({}, 40),
    })
  );
  assert.doesNotMatch(
    textOf(noCards),
    /0%/,
    "a rate with a zero denominator is unknown, never 0%"
  );
});

// ============================================================================
// The empty state
// ============================================================================

test("a meeting with no responses shows the empty state, not an empty chart", () => {
  const html = render(
    createElement(ResponseSummary, {
      breakdown: buildResponseBreakdown({}, 12),
    })
  );

  assert.ok(html.includes('data-testid="response-summary-empty"'));
  assert.ok(textOf(html).includes(RESPONSE_SUMMARY_EMPTY_COPY));
  assert.ok(
    !html.includes('data-testid="response-breakdown"'),
    "five zero rows are not an empty state — they are a claim"
  );
});

test("the empty state still says where the cards get keyed in", () => {
  // An empty state that only reports emptiness leaves the planter to find the
  // capture surface on their own.
  const html = render(
    createElement(ResponseSummary, {
      breakdown: buildResponseBreakdown({}, 0),
    })
  );

  assert.match(textOf(html), /Attendance tab/);
});

test("a meeting with no attendance at all renders without crashing", () => {
  const html = render(
    createElement(ResponseSummary, {
      breakdown: buildResponseBreakdown({}, 0),
    })
  );

  assert.match(textOf(html), /0 attendees marked here\./);
});

// ============================================================================
// The capture control — every clickable carries cursor-pointer
// ============================================================================

test("the response picker's trigger is a clickable that says so", () => {
  // AGENTS.md hard rule: every clickable element gets `cursor-pointer`. A Radix
  // `SelectTrigger` renders as a `<button>` whose cursor is set by class, so
  // this is the assertion that the class survived.
  const html = render(
    createElement(ResponsePicker, {
      meetingId: "77777777-7777-4777-8777-777777777777",
      personId: "88888888-8888-4888-8888-888888888888",
      personName: "Ada Lovelace",
      value: null,
    })
  );

  const trigger = /<button[^>]*data-slot="select-trigger"[^>]*>/.exec(html);
  assert.ok(trigger, "the picker renders a trigger button");
  assert.match(
    trigger[0],
    /class="[^"]*cursor-pointer/,
    "the trigger carries cursor-pointer"
  );
});

test("the picker names whose card it takes, state-free", () => {
  // The only visible label is the "Response" column header, which does not say
  // whose card this is — the gap issue #159 closed on the attendance checkbox.
  // The name is state-free because the trigger already announces its value.
  const html = render(
    createElement(ResponsePicker, {
      meetingId: "77777777-7777-4777-8777-777777777777",
      personId: "88888888-8888-4888-8888-888888888888",
      personName: "Ada Lovelace",
      value: "ready_commit",
    })
  );

  assert.match(html, /aria-label="Response card for Ada Lovelace"/);
  assert.doesNotMatch(
    html,
    /aria-label="[^"]*Ready to commit/,
    "the accessible name does not flip with the value"
  );
});

test("no card recorded is an offered state, not the absence of one", () => {
  const html = render(
    createElement(ResponsePicker, {
      meetingId: "77777777-7777-4777-8777-777777777777",
      personId: "88888888-8888-4888-8888-888888888888",
      personName: "Ada Lovelace",
      value: null,
    })
  );

  // The trigger shows it, so a planter can see the row is untouched rather than
  // reading a blank control as "not loaded yet".
  assert.ok(textOf(html).includes(RESPONSE_NOT_RECORDED_LABEL));
});
