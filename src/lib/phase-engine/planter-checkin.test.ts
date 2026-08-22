import assert from "node:assert/strict";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";

import {
  CHECKIN_DIMENSIONS,
  CHECKIN_NOTE_MAX,
  CHECKIN_NUDGE_RUN,
  checkinDraftFrom,
  checkinNudges,
  completeAnswer,
  recentWeekStarts,
  thisWeeksCheckin,
  weekStartOf,
  type CheckinAnswer,
} from "./planter-checkin";
import type { PlanterCheckin, PlanterCheckinLevel } from "@/db/schema";

// ----------------------------------------------------------------------------
// The planter's own sustainability (#484, C19).
//
// Bryan: "a plant can hit every launch metric while the planter himself is
// falling apart." The four answers below are the most sensitive thing this
// product will ever hold, and the promise made on the card — only you see this
// — has to be structural rather than a habit. The sweep at the bottom is that
// structure: it fails if the engine or the oversight layer so much as names
// this module.
// ----------------------------------------------------------------------------

function checkin(
  weekStart: string,
  levels: Partial<Record<string, PlanterCheckinLevel>> = {}
): PlanterCheckin {
  return {
    id: `c-${weekStart}`,
    churchId: "church-1",
    weekStart,
    spiritually: "steady",
    marriageFamily: "steady",
    financially: "steady",
    pace: "steady",
    note: null,
    answeredById: "user-1",
    createdAt: new Date(),
    updatedAt: new Date(),
    ...levels,
  } as PlanterCheckin;
}

// -- weeks --------------------------------------------------------------------

test("the week runs Monday to Sunday, in UTC", () => {
  // The week is an IDENTITY here — the unique key that makes answering
  // idempotent — so it must not shift with the reader's timezone. A planter in
  // Auckland and their coach in Dallas have to agree which row "this week" is.
  assert.equal(weekStartOf(new Date("2026-08-19T23:00:00.000Z")), "2026-08-17");
  assert.equal(weekStartOf(new Date("2026-08-17T00:00:00.000Z")), "2026-08-17");
  // Sunday belongs to the week behind it, not the one ahead.
  assert.equal(weekStartOf(new Date("2026-08-23T18:00:00.000Z")), "2026-08-17");
  assert.equal(weekStartOf(new Date("2026-08-24T00:00:00.000Z")), "2026-08-24");
});

test("the strip's weeks are contiguous and end at this week", () => {
  const weeks = recentWeekStarts(new Date("2026-08-21T12:00:00.000Z"), 4);
  assert.deepEqual(weeks, [
    "2026-07-27",
    "2026-08-03",
    "2026-08-10",
    "2026-08-17",
  ]);
});

test("this week is answered only by THIS week's row", () => {
  const asOf = new Date("2026-08-21T12:00:00.000Z");
  assert.equal(
    thisWeeksCheckin([checkin("2026-08-17")], asOf)?.weekStart,
    "2026-08-17"
  );
  assert.equal(thisWeeksCheckin([checkin("2026-08-10")], asOf), null);
  assert.equal(thisWeeksCheckin([], asOf), null);
});

test("this week's row is picked out of a history, not the newest one", () => {
  // The card prefills the change form from this row (#634). Handing it last
  // week's answers would show a planter the wrong week and then save it over
  // this one.
  const asOf = new Date("2026-08-21T12:00:00.000Z");
  const history = [
    checkin("2026-08-03", { pace: "steady" }),
    checkin("2026-08-10", { pace: "struggling" }),
    checkin("2026-08-17", { pace: "strained" }),
  ];

  assert.equal(thisWeeksCheckin(history, asOf)?.pace, "strained");

  // …and a week nobody answered yet reads as unanswered even with a full
  // history behind it.
  assert.equal(
    thisWeeksCheckin(history, new Date("2026-08-24T12:00:00.000Z")),
    null
  );
});

// -- the draft the change form opens on (#634) --------------------------------

const ANSWER: CheckinAnswer = {
  spiritually: "strained",
  marriageFamily: "steady",
  financially: "struggling",
  pace: "strained",
  note: "Hard week. Tell Ana on Saturday.",
};

test("reopening and saving unchanged writes back exactly what was there", () => {
  // The write is a whole-row upsert. A form reopened without the note would
  // save `note: null` over a note the planter wrote and never tell them.
  assert.deepEqual(completeAnswer(checkinDraftFrom(ANSWER)), ANSWER);
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

test("the note length the keyboard enforces is the one the server enforces", () => {
  // The action's single refusal message is about the three levels, so a note
  // refused on length would be refused in a sentence that never mentions notes.
  const schema = readFileSync(
    join(SRC, "app", "(dashboard)", "phase", "checkin-actions.ts"),
    "utf8"
  );

  assert.match(schema, /z\.string\(\)\.max\(CHECKIN_NOTE_MAX\)/);
  assert.equal(CHECKIN_NOTE_MAX, 2000);
});

// -- the nudge ----------------------------------------------------------------

test("three strained weeks running raises the question", () => {
  const nudges = checkinNudges([
    checkin("2026-08-03", { pace: "strained" }),
    checkin("2026-08-10", { pace: "struggling" }),
    checkin("2026-08-17", { pace: "strained" }),
  ]);

  assert.equal(nudges.length, 1);
  assert.equal(nudges[0].dimension, "pace");
  assert.equal(nudges[0].weeks, 3);
  assert.match(nudges[0].message, /who is caring for you\?/);
});

test("two hard weeks are just two hard weeks", () => {
  // A product that asks "who is caring for you?" every bad week teaches a
  // planter to answer `steady` to make it stop.
  assert.deepEqual(
    checkinNudges([
      checkin("2026-08-10", { pace: "strained" }),
      checkin("2026-08-17", { pace: "strained" }),
    ]),
    []
  );
  assert.equal(CHECKIN_NUDGE_RUN, 3);
});

test("a good week breaks the run, however bad the quarter was", () => {
  // Three hard weeks scattered across a season is a normal season of planting.
  assert.deepEqual(
    checkinNudges([
      checkin("2026-07-27", { pace: "struggling" }),
      checkin("2026-08-03", { pace: "struggling" }),
      checkin("2026-08-10", { pace: "steady" }),
      checkin("2026-08-17", { pace: "struggling" }),
    ]),
    []
  );
});

test("each dimension is counted on its own", () => {
  const nudges = checkinNudges([
    checkin("2026-08-03", { pace: "strained", financially: "strained" }),
    checkin("2026-08-10", { pace: "strained", financially: "steady" }),
    checkin("2026-08-17", { pace: "strained", financially: "strained" }),
  ]);

  assert.deepEqual(
    nudges.map((n) => n.dimension),
    ["pace"]
  );
});

test("the four dimensions are Bryan's, in his order", () => {
  assert.deepEqual(
    CHECKIN_DIMENSIONS.map((d) => d.label),
    ["Spiritually", "Marriage & family", "Financially", "Pace"]
  );
});

// ----------------------------------------------------------------------------
// AC-4: the privacy spine, as a sweep.
//
// Same shape as the no-person-names and one-spelling sweeps elsewhere in this
// codebase: a rule that has to hold across a whole directory is asserted over
// the directory, not remembered by each new file in it.
// ----------------------------------------------------------------------------

const SRC = join(process.cwd(), "src");

function filesUnder(dir: string): string[] {
  return readdirSync(dir).flatMap((entry) => {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) return filesUnder(full);
    return full.endsWith(".ts") || full.endsWith(".tsx") ? [full] : [];
  });
}

/** Everything the assessment pipeline and the oversight layer are made of. */
const ENGINE_DIRS = [
  join(SRC, "lib", "phase-engine", "signals"),
  join(SRC, "lib", "phase-engine", "judge"),
  join(SRC, "lib", "phase-engine", "assessment"),
  join(SRC, "lib", "phase-engine", "oversight"),
  join(SRC, "lib", "phase-engine", "rag"),
];

test("no part of the engine or the oversight layer can reach a check-in", () => {
  const offenders: string[] = [];

  for (const dir of ENGINE_DIRS) {
    for (const file of filesUnder(dir)) {
      const source = readFileSync(file, "utf8");
      if (
        /planter_checkins|planterCheckins|planter-checkin/.test(source) &&
        !file.endsWith(".test.ts")
      ) {
        offenders.push(file.slice(SRC.length + 1));
      }
    }
  }

  assert.deepEqual(
    offenders,
    [],
    "a check-in reached the assessment or oversight layer. These four answers are planter-only (#484 D3): they feed no signal, no snapshot, no judge prompt and no oversight payload, and the promise on the card depends on that staying true"
  );
});

test("the sweep is looking at real files, not an empty list", () => {
  // A directory scan that matched nothing would pass silently, which is how a
  // guardrail becomes decoration.
  const scanned = ENGINE_DIRS.flatMap(filesUnder).length;
  assert.ok(scanned > 20, `expected the engine's files, saw ${scanned}`);
});

test("the check-in table is not in the snapshot's own vocabulary", () => {
  // The other half of the same rule, from the opposite direction: the fact
  // snapshot names every source it reads, and this is not one of them.
  const types = readFileSync(
    join(SRC, "lib", "phase-engine", "signals", "types.ts"),
    "utf8"
  );
  assert.doesNotMatch(types, /checkin/i);
});
