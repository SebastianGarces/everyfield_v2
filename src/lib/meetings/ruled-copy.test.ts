import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { test } from "node:test";

import {
  evaluationComparisonDenominatorCopy,
  meetingLinkedTaskProgressCopy,
  EVALUATION_COMPARISON_EMPTY_COPY,
  MEETING_EVALUATION_TASK_CARD_TITLE,
} from "@/lib/meetings/copy";
import {
  compareEvaluationToHistory,
  EVALUATION_COMPARISON_WINDOW,
  type EvaluationTrendPoint,
} from "@/lib/meetings/service";

// ----------------------------------------------------------------------------
// The copy rulings on #312 (Sebastian). Two from 2026-08-10:
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
// The 2026-08-12 ruling on PR #395 added two more, both the same species as
// ruling 2 — a card claiming more than its query counted:
//
// 3. The POPULATED comparison card reports what the average COVERS, never what
//    the planter EVALUATED. `previousCount` is the window's size, not the
//    church's history (decision 1, option B).
//
// 4. The meeting-detail card over `getFollowUpCompletion` is titled "Evaluation
//    task", not "Follow-up completion": the query admits only
//    `related_type = 'meeting'` rows, and the product creates exactly one of
//    those per meeting (decision 2, option A). Only the NAME moved: the query
//    is deliberately unchanged — `follow-up-and-comparison.test.ts` pins its
//    shape with `.toSQL()` — and widening it at the task generator was
//    considered and explicitly NOT ruled in.
//
// WHERE THE RULED STRINGS LIVE: `src/lib/meetings/copy.ts`, not `service.ts`.
// They are UI copy, and their only consumers are two React Server Components
// and this test. `service.ts` is the data-access module — it opens with `@/db`,
// ten schema tables and drizzle, so an import edge from a component that later
// gains `"use client"` would drag that whole graph into the client bundle.
// `copy.ts` cannot drag anything, and the last section of this file pins the
// near half of that split: copy.ts and agenda.ts import nothing. The far half
// — that no client component REACHES service.ts, directly or through any
// non-server-action module — is an architecture guard rather than a copy
// ruling, and lives in `client-boundary.test.ts` beside it.
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

/** The comparison card, verbatim — the one component this file cannot import. */
function comparisonCardSource(): string {
  return readFileSync(
    path.join(
      __dirname,
      "../../app/(dashboard)/meetings/[id]/evaluation/evaluation-comparison.tsx"
    ),
    "utf8"
  );
}

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
  const card = comparisonCardSource();

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

// ============================================================================
// Ruling 3 — the POPULATED card says what the average covers, not what the
// planter evaluated (2026-08-12, decision 1, option B)
// ============================================================================

/**
 * The sentence ruled on 2026-08-12, written out here so the ruling and the
 * shipped helper are two independent things that must agree — the same
 * technique `RULED_EMPTY_STATE` uses one section up.
 */
function ruledDenominatorSentence(previousCount: number): string {
  const meetings =
    previousCount === 1
      ? "one earlier meeting"
      : `${previousCount} earlier meetings`;

  return `Scores are out of 5.0. The average covers the ${meetings} in view.`;
}

test("the populated card reads exactly the ruled denominator sentence", () => {
  for (const previousCount of [1, 2, 12, 44]) {
    assert.equal(
      evaluationComparisonDenominatorCopy(previousCount),
      ruledDenominatorSentence(previousCount),
      `the sentence ruled on #312 (2026-08-12) for previousCount=${previousCount}`
    );
  }
});

test("the populated card never claims the planter evaluated that many", () => {
  // The load-bearing half of decision 1. `previousCount` is the size of the
  // window `getEvaluationTrend` fetched, so a church past the window has MORE
  // meetings behind this one than the card can see. Any sentence in the second
  // person about what the planter did is a claim the number cannot support.
  const copy = evaluationComparisonDenominatorCopy(44);

  assert.doesNotMatch(
    copy,
    /you evaluated/i,
    "previousCount is what the window kept, not what the planter evaluated"
  );
  assert.doesNotMatch(
    copy,
    /before this one/i,
    "54 meetings can precede this one while previousCount reads 44"
  );
});

test("the ruled sentence stays true for a church past the window", () => {
  // The worked example from the ruling, run through the shipped comparison: 60
  // evaluated meetings, the planter opens #55. 54 precede it; the window keeps
  // 44 of them. The card must be readable as true with BOTH numbers on the
  // table, which "in view" is and "you evaluated before this one" is not.
  const all = Array.from({ length: 60 }, (_, i) => point(i, 4.0));
  const current = all[54]!;

  const comparison = compareEvaluationToHistory(windowedTrend(all), {
    meetingId: current.meetingId,
    datetime: current.datetime,
    totalScore: current.totalScore,
  });

  assert.ok(comparison, "meeting #55 has a baseline inside the window");
  assert.equal(comparison.previousCount, 44, "the window's earlier points");
  assert.ok(
    all.filter((p) => p.datetime < current.datetime).length >
      comparison.previousCount,
    "more meetings precede this one than the card counted — the whole point"
  );
  assert.equal(
    evaluationComparisonDenominatorCopy(comparison.previousCount),
    "Scores are out of 5.0. The average covers the 44 earlier meetings in view.",
    "the card reports the 44 it counted, and claims nothing about the other 10"
  );
});

test("the card states the denominator exactly once", () => {
  // The ruled sentence is the card's ONE statement of how many meetings are
  // behind the average. The definition list used to restate it three lines
  // above as `Average of previous {previousCount}`, which rendered on the
  // preview as the ungrammatical "Average of previous 1" — a bare number with
  // no noun, and a second denominator free to drift from the ruled one.
  //
  // The term still has to NAME its figure, though: with the count gone it read
  // "Previous average", which a reader takes as the average OF the previous
  // meeting — the column immediately to its left. So it carries the plural
  // noun and no number.
  //
  // Comments are stripped first, the way rulings 1 and 4 strip them: the JSX
  // above the `<dt>` explains the retired wording and quotes it.
  const card = comparisonCardSource()
    .replace(/\{\/\*[\s\S]*?\*\/\}/g, "")
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/\/\/.*$/gm, "");

  assert.doesNotMatch(
    card,
    /Average of previous\s*\{/,
    'the <dt> never interpolates the count back in — "Average of previous {n}" is the ruled sentence\'s job'
  );
  assert.match(
    card,
    /<dt[^>]*>\s*Average of previous meetings\s*<\/dt>/,
    "the term is static and names its own noun, so it cannot render a bare number, cannot drift from the ruled sentence, and cannot be read as the average of the previous meeting"
  );
});

test("the populated card renders the helper rather than its own sentence", () => {
  // The link the equalities above cannot prove — the mirror of the empty
  // state's assertion. Without it the JSX could re-hardcode the old claim and
  // every other assertion in this section would still pass.
  const card = comparisonCardSource();

  assert.match(
    card,
    /<p[^>]*>\s*\{evaluationComparisonDenominatorCopy\(previousCount\)\}\s*<\/p>/,
    "the populated card renders {evaluationComparisonDenominatorCopy(previousCount)}"
  );
});

// ============================================================================
// Ruling 4 — the follow-up card is renamed to what it counts
// (2026-08-12, decision 2, option A)
// ============================================================================

const MEETING_DETAIL_PAGE = path.join(
  __dirname,
  "../../app/(dashboard)/meetings/[id]/page.tsx"
);

/**
 * The meeting-detail page with comments stripped — the same precaution ruling 1
 * takes, and for the same reason: the page's own comment quotes the retired
 * title to explain why it is retired.
 */
function meetingDetailSource(): string {
  return readFileSync(MEETING_DETAIL_PAGE, "utf8")
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/\/\/.*$/gm, "");
}

test("the card is titled exactly what its query counts", () => {
  assert.equal(
    MEETING_EVALUATION_TASK_CARD_TITLE,
    "Evaluation task",
    "the title ruled on #312 (2026-08-12, decision 2, option A)"
  );
});

test("the retired title is gone from the meeting detail page", () => {
  // Case-sensitive on purpose: `data-testid="follow-up-completion"` is an
  // addressing handle, not copy a planter reads, and it stays so the browser
  // validation and any selector written against it keep working.
  assert.doesNotMatch(
    meetingDetailSource(),
    /Follow-up completion/,
    'no surface still reads "Follow-up completion" — it promised a metric over a figure that can only be 0 of 1 or 1 of 1'
  );
});

test("the card title comes from the constant, not from the JSX", () => {
  assert.match(
    meetingDetailSource(),
    /<CardTitle[^>]*>\s*\{MEETING_EVALUATION_TASK_CARD_TITLE\}\s*<\/CardTitle>/,
    "the card renders {MEETING_EVALUATION_TASK_CARD_TITLE} verbatim"
  );
});

test("the empty line under the renamed card promises one task, not a set", () => {
  // "No follow-up tasks are linked to this meeting" was the plural half of the
  // same over-promise. The card can hold one meeting-linked task.
  assert.match(
    meetingDetailSource(),
    /No task is linked to this meeting\./,
    "the empty line says what the query can find"
  );
});

test("the progress sentence reads what the figure says, in both grammars", () => {
  // The sentence is a VALUE now, so the grammar branch is asserted by equality
  // instead of by counting matches of a ternary in the page's source — a regex
  // that pinned Prettier's line breaking and went red on a re-wrap that changed
  // no behaviour. One function IS "exactly one grammar branch".
  assert.equal(meetingLinkedTaskProgressCopy(0, 1), "0 of 1 task complete");
  assert.equal(meetingLinkedTaskProgressCopy(1, 1), "1 of 1 task complete");
  assert.equal(meetingLinkedTaskProgressCopy(2, 3), "2 of 3 tasks complete");
});

test("the progress figure is written once and pointed at, never copied", () => {
  // The bar used to carry its own `aria-label` holding a second copy of the
  // visible sentence, and the two had already drifted: the label hardcoded
  // "tasks" while the visible line branched on `total === 1`. Because this
  // query can only ever return `total: 1` — the premise the rename rests on —
  // the plural was not an edge case, it was the ONLY case a planter reaches.
  const page = meetingDetailSource();

  // The one render assertion, matching how the other two ruled strings are
  // pinned: the page calls the helper rather than re-assembling the sentence.
  assert.match(
    page,
    /\{meetingLinkedTaskProgressCopy\(/,
    "the visible sentence comes from the helper, not from JSX"
  );

  assert.match(
    page,
    /<p\s+id="meeting-evaluation-task-progress-label"/,
    "the visible sentence carries the id the bar borrows"
  );
  // Scoped to the one element, not the whole file: a page-wide ban on
  // `aria-label=` would fail the next legitimate use of it somewhere else here,
  // the same booby trap the notes-field helpers above avoid.
  const progress = page.match(/<Progress\b[^>]*\/>/);
  assert.ok(progress, "expected a <Progress /> on the meeting detail page");
  assert.match(
    progress[0],
    /aria-labelledby="meeting-evaluation-task-progress-label"/,
    "the bar names the visible sentence instead of restating it"
  );
  assert.doesNotMatch(
    progress[0],
    /aria-label=/,
    "the bar carries no aria-label — that attribute is how the copy split in two"
  );
});

// ============================================================================
// The layer the ruled strings live in
// ============================================================================

test("the ruled copy module pulls in no data-access graph", () => {
  // `copy.ts` exists so a component can render a ruled string without importing
  // `service.ts`, which opens with `@/db`, ten schema tables and drizzle. If
  // copy.ts ever grows one of those imports, the boundary is gone and the split
  // bought nothing.
  const copy = readFileSync(path.join(__dirname, "copy.ts"), "utf8")
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/\/\/.*$/gm, "");

  assert.doesNotMatch(
    copy,
    /^\s*import\b/m,
    "copy.ts imports nothing at all — it is strings and one string builder"
  );
});

test("the agenda module pulls in no data-access graph either", () => {
  // Same rule, same reason. `agenda.ts` holds the bounds and the clamp that
  // `AgendaBuilder` ("use client") and `service.ts` must agree on, so it sits
  // on both sides of the boundary and may drag neither way.
  const agenda = readFileSync(path.join(__dirname, "agenda.ts"), "utf8")
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/\/\/.*$/gm, "");

  assert.doesNotMatch(
    agenda,
    /^\s*import\b/m,
    "agenda.ts imports nothing at all — a type, two bounds, a clamp and a reader"
  );
});

test("the shared filter table imports a TYPE and nothing else", () => {
  // Third sibling, same rule with one allowance. `analytics-filter.ts` holds
  // the meeting-type filter that `MeetingList` ("use client") and the analytics
  // server page must agree on, so it sits on both sides of the boundary. It
  // needs `MeetingType` from the schema — but `import type` is erased at
  // compile time, so it adds no bundle edge and `client-boundary.test.ts`
  // (value edges only) never follows it. A VALUE import here would be the hole.
  const filter = readFileSync(
    path.join(__dirname, "analytics-filter.ts"),
    "utf8"
  )
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/\/\/.*$/gm, "");

  assert.doesNotMatch(
    filter,
    /^\s*import\s+(?!type\b)/m,
    "analytics-filter.ts has no VALUE import — a type-only import is erased, a value import ships the graph"
  );
});
