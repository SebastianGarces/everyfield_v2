import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { test } from "node:test";

import {
  compareEvaluationToHistory,
  EVALUATION_COMPARISON_EMPTY_COPY,
  EVALUATION_COMPARISON_WINDOW,
  type EvaluationTrendPoint,
} from "@/lib/meetings/service";

// ----------------------------------------------------------------------------
// The two copy rulings on #312 (2026-08-10, Sebastian).
//
// 1. The team-meeting creation form's free-text field is called "Notes". Free
//    text and the structured agenda are SEPARATE concepts. The field posts to
//    `church_meetings.notes`, which the Agenda card never reads, so a field
//    labelled "Agenda" sent a planter's running order somewhere the page then
//    reported as "No agenda yet".
//
// 2. The evaluation comparison's empty state must never claim "first". The
//    50-meeting window is deliberately KEPT, which means `null` has two causes
//    — nothing earlier exists, or everything earlier fell outside the window —
//    and the card cannot tell them apart. Only the sentence changed. Round 2
//    of the ruling shortened it to one line and dropped the window number from
//    the copy entirely; the window stays in code and is never rendered.
//
// WHY THIS FILE LIVES IN src/lib/meetings/ AND NOT NEXT TO THE COMPONENT:
// its natural home looks like the route directory, but that directory is
// `src/app/(dashboard)/meetings/[id]/evaluation/`, and `[id]` is a glob
// character class. A targeted run — `pnpm test <that path>`, or any scoped
// subset a verifier assembles — matches NOTHING there and still exits 0, so
// the file reports green while running none of its assertions. Here it is
// addressable, and it needs nothing from the route directory: it imports the
// behaviour under test from `service.ts` and reads the one component it cannot
// import by an explicit path.
// ----------------------------------------------------------------------------

// ============================================================================
// Ruling 1 — the creation form field is "Notes"
// ============================================================================

// `meetings-tab.tsx` cannot be imported here: it pulls in server actions and a
// database client at module load. So this ruling — and ONLY this ruling — is
// asserted against source text, the way `meetings-tab.test.ts` asserts the
// absence of unpinned formatters. Comments are stripped first, because this
// file's prose quotes the forbidden wording and so does the component's.
const MEETINGS_TAB = path.join(
  __dirname,
  "../../components/ministry-teams/meetings-tab.tsx"
);

function meetingsTabSource(): string {
  return readFileSync(MEETINGS_TAB, "utf8")
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/\/\/.*$/gm, "");
}

/**
 * One element from that source, by pattern. Group 1 when the pattern captures
 * the part a planter reads, so an assertion about text is never satisfied by
 * markup. Scoped to the exact element on purpose — a file-wide search for a
 * word like "agenda" is a booby trap, because the next legitimate use of the
 * word for the structured agenda would fail a test about the notes field.
 */
function element(pattern: RegExp, what: string): string {
  const match = meetingsTabSource().match(pattern);
  assert.ok(match, `expected to find ${what} in meetings-tab.tsx`);
  return match[1] ?? match[0];
}

/** The text a planter reads on the notes field's label — markup excluded. */
function notesLabelText(): string {
  return element(
    /<Label htmlFor="notes">([\s\S]*?)<\/Label>/,
    'a <Label htmlFor="notes">'
  );
}

/** The `<Textarea id="notes" ... />` element, placeholder included. */
function notesTextarea(): string {
  return element(
    /<Textarea\b[^>]*\bid="notes"[^>]*\/>/,
    'a <Textarea id="notes" />'
  );
}

test("the team-meeting creation form labels its free text 'Notes'", () => {
  assert.equal(
    notesLabelText().trim(),
    "Notes",
    "the field that posts to church_meetings.notes is labelled exactly Notes — not 'Agenda / Notes', not one field with a slash in its name"
  );
});

test("neither the label nor the placeholder calls that field an agenda", () => {
  // The placeholder is half the label. "Meeting agenda..." under a box called
  // Notes re-creates exactly the confusion the ruling settled.
  assert.doesNotMatch(
    notesLabelText(),
    /agenda/i,
    "the label for the notes field does not say agenda"
  );
  assert.doesNotMatch(
    notesTextarea(),
    /agenda/i,
    "the placeholder for the notes field does not say agenda"
  );
});

// ============================================================================
// Ruling 2 — the comparison empty state never claims "first"
// ============================================================================

/**
 * The sentence ruled on 2026-08-10 (round 2), written out once here so the
 * ruling and the shipped string are two independent things that must agree.
 */
const RULED_EMPTY_STATE =
  "No comparison available — no earlier evaluated meeting to compare against.";

test("the empty state reads exactly the ruled sentence", () => {
  // The whole copy ruling, in one equality. The component renders this
  // constant, so there is no JSX to re-parse and no wrapping to normalise —
  // and "names no window", "carries no digit", "is one sentence, not a branch
  // on the cause" stop being assertions and become impossible states.
  assert.equal(
    EVALUATION_COMPARISON_EMPTY_COPY,
    RULED_EMPTY_STATE,
    "the sentence ruled on #312 round 2 — one line, nothing added"
  );
});

test("the empty-state card renders the constant rather than its own sentence", () => {
  // The one link the equality above cannot prove: that the card actually shows
  // this string. Without it, someone could re-hardcode a sentence in the JSX
  // and every other assertion here would still pass.
  const card = readFileSync(
    path.join(
      __dirname,
      "../../app/(dashboard)/meetings/[id]/evaluation/evaluation-comparison.tsx"
    ),
    "utf8"
  );

  assert.match(
    card,
    /<p[^>]*>\s*\{EVALUATION_COMPARISON_EMPTY_COPY\}\s*<\/p>/,
    "the empty state renders {EVALUATION_COMPARISON_EMPTY_COPY} verbatim"
  );
});

test("the empty state never says this is the planter's first meeting", () => {
  // `null` does not mean first — the window may have hidden every earlier
  // meeting. This is the ruling's load-bearing half, so it is pinned in its
  // own right and not left to the equality above.
  assert.doesNotMatch(
    EVALUATION_COMPARISON_EMPTY_COPY,
    /\bfirst\b/i,
    "null does not mean first — the window may have hidden every earlier meeting"
  );
});

test("the empty state promises nothing evaluating another meeting cannot keep", () => {
  // "Evaluate another and this card fills in" is true for a genuinely first
  // meeting and false for an out-of-window one: a NEW evaluation is more
  // recent still, so it never enters this meeting's baseline.
  assert.doesNotMatch(EVALUATION_COMPARISON_EMPTY_COPY, /Evaluate another/i);
});

// ----------------------------------------------------------------------------
// The behaviour behind the sentence: BOTH causes of an empty comparison,
// asserted against the shipped `compareEvaluationToHistory`.
// ----------------------------------------------------------------------------

/** What `getEvaluationTrend(churchId, WINDOW)` returns for a full history. */
function windowedTrend(
  all: readonly EvaluationTrendPoint[]
): EvaluationTrendPoint[] {
  return [...all]
    .sort((a, b) => b.datetime.getTime() - a.datetime.getTime())
    .slice(0, EVALUATION_COMPARISON_WINDOW)
    .reverse();
}

/** Weekly meetings from a fixed epoch — index 0 is the oldest. */
const FIRST_MEETING = Date.UTC(2026, 0, 5, 18, 0, 0);
const ONE_WEEK_MS = 7 * 24 * 60 * 60 * 1000;

function point(index: number, score: number): EvaluationTrendPoint {
  return {
    meetingId: `meeting-${index}`,
    meetingNumber: index + 1,
    totalScore: score,
    datetime: new Date(FIRST_MEETING + index * ONE_WEEK_MS),
  };
}

test("a meeting that is genuinely the church's first gets no comparison", () => {
  // Cause one of `null`: nothing was evaluated before this meeting at all.
  // The window is irrelevant here — the history is empty.
  const current = point(0, 4.0);

  assert.equal(
    compareEvaluationToHistory([current], {
      meetingId: current.meetingId,
      datetime: current.datetime,
      totalScore: current.totalScore,
    }),
    null,
    "null — nothing came before the first evaluated meeting"
  );
});

test("a meeting older than the whole window gets no comparison", () => {
  // The state the ruling exists for. This church evaluated WINDOW + 2 meetings.
  // The planter opens the SECOND one — one meeting is genuinely earlier than
  // it, and the window holds none of them.
  const all = Array.from({ length: EVALUATION_COMPARISON_WINDOW + 2 }, (_, i) =>
    point(i, 4.0)
  );
  const current = all[1]!;

  const trend = windowedTrend(all);

  assert.equal(trend.length, EVALUATION_COMPARISON_WINDOW);
  assert.ok(
    trend.every((p) => p.datetime.getTime() > current.datetime.getTime()),
    "every point the window kept is LATER than the meeting being viewed"
  );
  assert.equal(
    compareEvaluationToHistory(trend, {
      meetingId: current.meetingId,
      datetime: current.datetime,
      totalScore: current.totalScore,
    }),
    null,
    "null — even though meeting 1 came before this one"
  );
});
