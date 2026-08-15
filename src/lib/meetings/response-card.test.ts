import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { test } from "node:test";

import { responseCardTypes, type ResponseCardType } from "@/db/schema/meetings";
import { responseCardRecordSchema } from "@/lib/validations/meetings";

import {
  buildResponseBreakdown,
  type ResponseCardCounts,
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

// ============================================================================
// THE OTHER RULE: the numerator never exceeds its denominator
// ============================================================================
//
// "2 of 1 attendee handed a card in" was reachable through two ordinary UI
// paths — removing an attendee, and flipping one from `attended` to `absent`
// after their card was keyed — because the cards and the attendees were counted
// over populations that could diverge. Product value V5 is explicit: for every
// displayed number someone must be able to say what it counts and over what
// denominator.
//
// The fix is in the SQL (`meetingResponseCountsQuery` and
// `meetingAttendedCountQuery`), so what is asserted here is that the arithmetic
// holds for EVERY pair those two queries can now produce. The model below is the
// two WHERE clauses restated over a plain list of rows; `response-queries.test.ts`
// asserts the real statements still say the same thing.
// ----------------------------------------------------------------------------

interface AttendanceRow {
  personId: string;
  status: "attended" | "absent" | "excused";
}

interface ResponseRow {
  personId: string;
  responseType: ResponseCardType;
}

/** `meetingResponseCountsQuery`: cards whose person still has an attendance row. */
function modelCounts(
  attendance: readonly AttendanceRow[],
  responses: readonly ResponseRow[]
): ResponseCardCounts {
  const counts: ResponseCardCounts = {};

  for (const response of responses) {
    if (!attendance.some((row) => row.personId === response.personId)) continue;
    counts[response.responseType] = (counts[response.responseType] ?? 0) + 1;
  }

  return counts;
}

/** `meetingAttendedCountQuery`: attended, OR holding a card for this meeting. */
function modelAttendeeCount(
  attendance: readonly AttendanceRow[],
  responses: readonly ResponseRow[]
): number {
  return attendance.filter(
    (row) =>
      row.status === "attended" ||
      responses.some((response) => response.personId === row.personId)
  ).length;
}

test("recorded never exceeds attendees, over every population the queries can return", () => {
  const people = ["a", "b", "c"];
  const statuses: AttendanceRow["status"][] = ["attended", "absent", "excused"];
  // `undefined` is "no attendance row"; `null` is "on the list, no card".
  const attendanceStates = [undefined, ...statuses];
  const cardStates = [null, "ready_commit", "not_interested"] as const;

  let cases = 0;

  for (const a of attendanceStates)
    for (const b of attendanceStates)
      for (const c of attendanceStates)
        for (const cardA of cardStates)
          for (const cardB of cardStates)
            for (const cardC of cardStates) {
              const attendanceStatuses = [a, b, c];
              const cards = [cardA, cardB, cardC];

              const attendance: AttendanceRow[] = people
                .map((personId, index) => ({
                  personId,
                  status: attendanceStatuses[index],
                }))
                .filter(
                  (row): row is AttendanceRow => row.status !== undefined
                );

              const responses: ResponseRow[] = people.flatMap(
                (personId, index) => {
                  const responseType = cards[index];
                  return responseType === null
                    ? []
                    : [{ personId, responseType }];
                }
              );

              const breakdown = buildResponseBreakdown(
                modelCounts(attendance, responses),
                modelAttendeeCount(attendance, responses)
              );

              cases += 1;
              assert.ok(
                breakdown.recordedCount <= breakdown.attendeeCount,
                `${breakdown.recordedCount} of ${breakdown.attendeeCount}: a card was counted whose person is not in the denominator`
              );
              assert.equal(
                breakdown.notRecordedCount,
                breakdown.attendeeCount - breakdown.recordedCount,
                "the unrecorded line is the honest remainder, never a floored one"
              );
            }

  assert.equal(cases, 4 ** 3 * 3 ** 3, "every combination ran");
});

test("a status flip after a card is keyed keeps both the card and its denominator", () => {
  // The second reachable path. Nobody's card is destroyed by a correction to
  // their attendance status, and the person who handed it in stays in the
  // population it is reported against.
  const attendance: AttendanceRow[] = [
    { personId: "a", status: "absent" },
    { personId: "b", status: "attended" },
  ];
  const responses: ResponseRow[] = [
    { personId: "a", responseType: "ready_commit" },
  ];

  const breakdown = buildResponseBreakdown(
    modelCounts(attendance, responses),
    modelAttendeeCount(attendance, responses)
  );

  assert.equal(breakdown.recordedCount, 1);
  assert.equal(breakdown.attendeeCount, 2, "the card's owner is still counted");
  assert.equal(breakdown.notRecordedCount, 1);
});

test("a card from somebody off the list is counted by neither number", () => {
  // `removeAttendee` deletes the card with the row, so this is only reachable
  // through the write race `recordMeetingResponse` documents. It must be
  // invisible rather than wrong.
  const breakdown = buildResponseBreakdown(
    modelCounts(
      [{ personId: "b", status: "attended" }],
      [{ personId: "ghost", responseType: "interested" }]
    ),
    modelAttendeeCount(
      [{ personId: "b", status: "attended" }],
      [{ personId: "ghost", responseType: "interested" }]
    )
  );

  assert.equal(breakdown.recordedCount, 0);
  assert.equal(breakdown.attendeeCount, 1);
});

test("the floor stays, as defence in depth for a caller that counts differently", () => {
  // Not the fix — the queries are — but a future caller must still never render
  // a negative row.
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
