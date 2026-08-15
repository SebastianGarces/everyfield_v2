import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { test } from "node:test";

import { responseCardTypes, type ResponseCardType } from "@/db/schema/meetings";
import { responseCardRecordSchema } from "@/lib/validations/meetings";

import {
  buildResponseBreakdown,
  parseResponseCardType,
  responseCardLabel,
  RESPONSE_CARD_OPTIONS,
  RESPONSE_NOT_RECORDED_COPY,
  RESPONSE_SUMMARY_EMPTY_COPY,
} from "./response-card";

// ----------------------------------------------------------------------------
// VM-014 (#98) — the response-card vocabulary and its arithmetic.
//
// The load-bearing rule this file exists for is one line of the requirement:
// AN ATTENDEE WITH NO RESPONSE CARD RECORDED IS NOT COUNTED AS A NEGATIVE
// RESPONSE. It is easy to satisfy by accident and easy to break by accident —
// one `?? "not_interested"`, one `notRecorded` folded into the last row — and
// the failure is silent: the breakdown still renders, still adds up, and tells
// a planter that eleven people said no when eleven people said nothing.
//
// Everything here is pure, so the rule is assertable with no database and no
// browser.
// ----------------------------------------------------------------------------

// ============================================================================
// One vocabulary, and everything built from it
// ============================================================================

test("the option list IS the stored vocabulary, in both directions", () => {
  // Neither half can catch a value missing from both, which is why both run:
  // the schema tuple is what the CHECK constraint is generated from, and the
  // option list is what the capture control offers.
  assert.deepEqual(
    RESPONSE_CARD_OPTIONS.map((option) => option.value).toSorted(),
    [...responseCardTypes].toSorted(),
    "an option the control offers is a value the column may hold"
  );

  const values = RESPONSE_CARD_OPTIONS.map((option) => option.value);
  assert.equal(
    new Set(values).size,
    values.length,
    "no option is declared twice"
  );
});

test("the zod enum is built from the list, not restated beside it", () => {
  const accepted = responseCardTypes.map((value) =>
    responseCardRecordSchema.safeParse({
      personId: "11111111-1111-4111-8111-111111111111",
      responseType: value,
    })
  );

  assert.ok(
    accepted.every((result) => result.success),
    "the server accepts every response type the control offers"
  );

  const refused = responseCardRecordSchema.safeParse({
    personId: "11111111-1111-4111-8111-111111111111",
    responseType: "definitely_maybe",
  });
  assert.ok(!refused.success, "a value outside the vocabulary is refused");
});

test("the record schema is strict — an unknown key is a refusal", () => {
  // A `"use server"` export taking an object parses a `z.strictObject` first
  // (memory/invariants.md → Multi-Tenancy). A passthrough object would let a
  // caller-named key ride along toward a SET.
  const result = responseCardRecordSchema.safeParse({
    personId: "11111111-1111-4111-8111-111111111111",
    responseType: "interested",
    churchId: "22222222-2222-4222-8222-222222222222",
  });

  assert.ok(!result.success, "a key the schema does not name is refused");
});

test("every option carries a label and the card's own wording", () => {
  for (const option of RESPONSE_CARD_OPTIONS) {
    assert.ok(option.label.trim().length > 0, `${option.value} has a label`);
    assert.ok(
      option.description.trim().length > 0,
      `${option.value} says which printed line it is`
    );
  }
});

test("the order is the commitment ladder, strongest first", () => {
  // Not cosmetic: the breakdown renders in this order, so a planter reads the
  // room top-down. `not_interested` last is the half that matters — a negative
  // above a positive would make the shape of the list lie about the meeting.
  const values = RESPONSE_CARD_OPTIONS.map((option) => option.value);

  assert.equal(values[0], "ready_commit", "the strongest commitment leads");
  assert.equal(
    values.at(-1),
    "not_interested",
    "the only negative value is last"
  );
});

// ============================================================================
// String-keyed lookups are not bare indexes
// ============================================================================

test("a prototype key is not a label — the lookup goes through Object.hasOwn", () => {
  // `meetings/labels.ts` learned this: `"constructor"` reached
  // `Object.prototype` and returned a defined value the `??` fallback never
  // caught. A response type arrives from a form post.
  for (const hostile of ["constructor", "toString", "__proto__", "valueOf"]) {
    assert.equal(
      responseCardLabel(hostile),
      hostile,
      `${hostile} must not resolve through the prototype`
    );
    assert.equal(
      parseResponseCardType(hostile),
      null,
      `${hostile} is not a response type`
    );
  }
});

test("a response type is PARSED, never cast", () => {
  assert.equal(parseResponseCardType("ready_commit"), "ready_commit");
  assert.equal(parseResponseCardType("READY_COMMIT"), null);
  assert.equal(parseResponseCardType(""), null);
  assert.equal(parseResponseCardType(undefined), null);
  assert.equal(parseResponseCardType(null), null);
  assert.equal(parseResponseCardType(7), null);
  assert.equal(parseResponseCardType(["ready_commit"]), null);
});

// ============================================================================
// THE RULE: absence is not a refusal
// ============================================================================

test("an attendee with no card is counted as unrecorded, never as declined", () => {
  // Nineteen in the room, four cards back, none of them a no.
  const breakdown = buildResponseBreakdown(
    { ready_commit: 2, interested: 2 },
    19
  );

  assert.equal(breakdown.attendeeCount, 19);
  assert.equal(breakdown.recordedCount, 4);
  assert.equal(breakdown.notRecordedCount, 15, "fifteen handed nothing in");

  const negative = breakdown.rows.find((row) => row.value === "not_interested");
  assert.equal(
    negative?.count,
    0,
    "nobody said no, so the negative row is zero — the fifteen are elsewhere"
  );
});

test("unrecorded and not_interested are separate numbers that do not leak", () => {
  // The direct form of the same rule: move a card from one bucket and the other
  // must not move with it.
  const withRefusals = buildResponseBreakdown({ not_interested: 3 }, 10);
  const withNone = buildResponseBreakdown({}, 10);

  assert.equal(withRefusals.notRecordedCount, 7);
  assert.equal(
    withRefusals.rows.find((row) => row.value === "not_interested")?.count,
    3
  );

  assert.equal(
    withNone.notRecordedCount,
    10,
    "no cards means nothing recorded"
  );
  assert.equal(
    withNone.rows.find((row) => row.value === "not_interested")?.count,
    0,
    "ten silences are not ten refusals"
  );
});

test("shares are of the cards that came back, never of attendance", () => {
  const breakdown = buildResponseBreakdown(
    { ready_commit: 1, interested: 3 },
    40
  );

  assert.equal(
    breakdown.rows.find((row) => row.value === "ready_commit")?.share,
    25,
    "one of four cards, not one of forty attendees"
  );
});

test("a share with a zero denominator is unknown, never 0%", () => {
  // memory/invariants.md → Communication: "0%" claims something about a count
  // that was never taken.
  const breakdown = buildResponseBreakdown({}, 12);

  for (const row of breakdown.rows) {
    assert.equal(row.share, null, `${row.value} claims no percentage`);
  }
});

test("zero-count rows are kept, so the breakdown has one shape", () => {
  const breakdown = buildResponseBreakdown({ interested: 1 }, 1);

  assert.deepEqual(
    breakdown.rows.map((row) => row.value),
    RESPONSE_CARD_OPTIONS.map((option) => option.value),
    "every option renders — 'nobody was ready to commit' is a finding"
  );
});

test("more cards than attendees floors the unrecorded count at zero", () => {
  // Reachable: `recordMeetingResponse` guards on an attendance row in a
  // separate statement, so a row deleted between the two leaves a response
  // behind. Benign — one meeting's count is high — but it must never render a
  // negative.
  const breakdown = buildResponseBreakdown({ interested: 5 }, 3);

  assert.equal(breakdown.recordedCount, 5);
  assert.equal(breakdown.notRecordedCount, 0);
});

test("a negative count from a broken query cannot become a negative row", () => {
  const breakdown = buildResponseBreakdown(
    { interested: -4 } as Partial<Record<ResponseCardType, number>>,
    2
  );

  assert.equal(
    breakdown.rows.find((row) => row.value === "interested")?.count,
    0
  );
  assert.equal(breakdown.recordedCount, 0);
});

// ============================================================================
// Copy
// ============================================================================

test("the empty state says the cards are not KEYED IN, not that nobody responded", () => {
  // The two are indistinguishable from this screen, and the second is a claim
  // about a meeting the product cannot make.
  assert.doesNotMatch(RESPONSE_SUMMARY_EMPTY_COPY, /\bnobody\b|\bno one\b/i);
  assert.match(RESPONSE_SUMMARY_EMPTY_COPY, /recorded/i);
});

test("the unrecorded line says out loud that it is not a no", () => {
  assert.match(RESPONSE_NOT_RECORDED_COPY, /not a no/i);
});

// ============================================================================
// The vocabulary is declared once
// ============================================================================

test("no second module hand-writes the five response types", () => {
  // The failure this stops is a component or a validator restating the list and
  // then drifting from it — the exact history `labels.ts` and
  // `evaluation-factors.ts` were created to end.
  const roots = ["../../components/meetings", "../../lib/meetings"];
  const offenders: string[] = [];

  for (const root of roots) {
    const dir = path.join(__dirname, root);
    for (const file of readdirSync(dir)) {
      if (!file.endsWith(".ts") && !file.endsWith(".tsx")) continue;
      if (file.startsWith("response-card")) continue;

      const source = readFileSync(path.join(dir, file), "utf8")
        .replace(/\/\*[\s\S]*?\*\//g, "")
        .replace(/\/\/.*$/gm, "");

      const named = responseCardTypes.filter((value) =>
        source.includes(`"${value}"`)
      );
      if (named.length >= 3) offenders.push(`${root}/${file}`);
    }
  }

  assert.deepEqual(
    offenders,
    [],
    "a module naming three or more response types as literals is a second vocabulary"
  );
});
