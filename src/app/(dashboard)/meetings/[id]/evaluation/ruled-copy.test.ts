import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { test } from "node:test";

import {
  compareEvaluationToHistory,
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
//    and the card cannot tell them apart. Only the sentence changed.
//
// Both are claims about rendered TEXT, and neither component can be imported
// here (they pull in server actions and a database client at module load), so
// the copy half is asserted against source text the way `meetings-tab.test.ts`
// asserts the absence of unpinned formatters. Comments are stripped first —
// this file's own prose quotes the forbidden wording, and so does the code's.
//
// The window half is asserted for real, against the shipped function.
// ----------------------------------------------------------------------------

const EVALUATION_COMPARISON = path.join(__dirname, "evaluation-comparison.tsx");
const MEETINGS_TAB = path.join(
  __dirname,
  "../../../../../components/ministry-teams/meetings-tab.tsx"
);

/**
 * Source with every comment removed, so an assertion about what a planter
 * READS is not satisfied — or broken — by what a developer wrote about it.
 */
function renderedSource(file: string): string {
  return readFileSync(file, "utf8")
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/\/\/.*$/gm, "");
}

/**
 * Every assertion below is scoped to the exact element whose text a planter
 * reads — never to the whole file. A file-wide `doesNotMatch` for a word like
 * "agenda" or a number like 50 is a booby trap: the next legitimate use of the
 * word, or a Tailwind class such as `w-50`, fails the test with a message
 * about a ruling it did not break.
 */
function element(file: string, pattern: RegExp, what: string): string {
  const match = renderedSource(file).match(pattern);
  assert.ok(match, `expected to find ${what} in ${path.basename(file)}`);
  // Group 1 when the pattern captures the part that is read, else the whole
  // match — so an assertion about text is never satisfied by markup.
  return match[1] ?? match[0];
}

/** The text a planter reads on the notes field's label — markup excluded. */
function notesLabelText(): string {
  return element(
    MEETINGS_TAB,
    /<Label htmlFor="notes">([\s\S]*?)<\/Label>/,
    'a <Label htmlFor="notes">'
  );
}

/** The `<Textarea id="notes" ... />` element, placeholder included. */
function notesTextarea(): string {
  return element(
    MEETINGS_TAB,
    /<Textarea\b[^>]*\bid="notes"[^>]*\/>/,
    'a <Textarea id="notes" />'
  );
}

/**
 * The empty-state card's JSX, with `className` attributes dropped — styling is
 * not copy, and a utility class must never decide whether a copy ruling holds.
 */
function emptyStateCopy(): string {
  return element(
    EVALUATION_COMPARISON,
    /<Card data-testid="evaluation-comparison-empty">[\s\S]*?<\/Card>/,
    "the empty-state card"
  ).replace(/className="[^"]*"/g, "");
}

// ============================================================================
// Ruling 1 — the creation form field is "Notes"
// ============================================================================

test("the team-meeting creation form labels its free text 'Notes'", () => {
  assert.equal(
    notesLabelText().trim(),
    "Notes",
    "the field that posts to church_meetings.notes is labelled exactly Notes — not 'Agenda / Notes', not one field with a slash in its name"
  );
});

test("neither the label nor the placeholder calls that field an agenda", () => {
  // The placeholder is half the label. "Meeting agenda..." under a box called
  // Notes re-creates exactly the confusion the ruling settled. Only these two
  // strings are pinned — the word may appear elsewhere in the file for the
  // structured agenda, which is the one thing that IS an agenda.
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

test("the empty state never says this is the planter's first meeting", () => {
  const copy = emptyStateCopy();

  assert.doesNotMatch(
    copy,
    /\bfirst\b/i,
    "null does not mean first — the window may have hidden every earlier meeting"
  );
  assert.match(copy, /No comparison available/);
});

test("the empty state promises nothing evaluating another meeting cannot keep", () => {
  // "Evaluate another and this card fills in" is true for a genuinely first
  // meeting and false for an out-of-window one: a NEW evaluation is more
  // recent still, so it never enters this meeting's baseline.
  assert.doesNotMatch(emptyStateCopy(), /Evaluate another/i);
});

test("the empty state names the window from the constant, not a literal", () => {
  const copy = emptyStateCopy();

  assert.match(
    copy,
    /\{EVALUATION_COMPARISON_WINDOW\}/,
    "a hand-typed 50 is the copy that goes wrong the day the window changes"
  );
  assert.doesNotMatch(
    copy,
    new RegExp(`\\b${EVALUATION_COMPARISON_WINDOW}\\b`),
    "the number itself is never typed into the sentence"
  );
});
