import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { test } from "node:test";

import {
  analyticsMeetingTypeArg,
  ANALYTICS_MEETING_TYPE_FILTERS,
  compareEvaluationToHistory,
  DEFAULT_ANALYTICS_MEETING_TYPE,
  meetingFollowUpCountQuery,
  parseAnalyticsMeetingTypeFilter,
  type EvaluationTrendPoint,
} from "./service";

// ----------------------------------------------------------------------------
// VM-010k, VM-016c, VM-020 (#312).
//
// Three figures, one shared failure mode: each has an absence that must render
// as an absence rather than as a zero. A first evaluated meeting has NO
// comparison, not a comparison against 0.0. A meeting with no linked tasks has
// NO completion percentage, not 0%. And an unrecognised filter is the default
// view, not "no type restriction" — the one direction where the wrong fallback
// would WIDEN the figures.
//
// The query-level half is rendered with `.toSQL()` and inspected, the technique
// `src/lib/wiki/tenancy.test.ts` uses: what is asserted is the SQL that would
// reach the database, so a read that stopped scoping by church or by meeting
// fails here even though it still type-checks and still returns rows.
// `.toSQL()` renders; it does not connect. A DATABASE_URL must be PRESENT
// (importing `@/db` builds the Neon client at module load), which `pnpm test`
// and CI both supply as a placeholder.
// ----------------------------------------------------------------------------

const CHURCH_A = "11111111-1111-4111-8111-111111111111";
const CHURCH_B = "22222222-2222-4222-8222-222222222222";
const MEETING_A = "33333333-3333-4333-8333-333333333333";
const MEETING_B = "44444444-4444-4444-8444-444444444444";

// ============================================================================
// VM-020 — query level
// ============================================================================

test("the follow-up count is scoped to the church AND the meeting", () => {
  const { sql: text, params } = meetingFollowUpCountQuery(
    CHURCH_A,
    MEETING_A
  ).toSQL();

  assert.match(text, /"tasks"\."church_id" = \$\d/);
  assert.match(text, /"tasks"\."related_id" = \$\d/);
  assert.ok(params.includes(CHURCH_A), "the church is not bound to the query");
  assert.ok(
    params.includes(MEETING_A),
    "the meeting is not bound to the query"
  );
});

test("no other church's or meeting's id reaches the follow-up count", () => {
  const { params } = meetingFollowUpCountQuery(CHURCH_A, MEETING_A).toSQL();

  assert.ok(
    !params.includes(CHURCH_B),
    "another church's id reached the count"
  );
  assert.ok(
    !params.includes(MEETING_B),
    "another meeting's id reached the count"
  );
});

test("the count admits only tasks whose related_type is the meeting", () => {
  // The link is `related_type = 'meeting'`, never a bare related_id match: a
  // person id and a meeting id are both uuids, so dropping the type predicate
  // would let an unrelated person-linked task collide into this figure.
  const { sql: text, params } = meetingFollowUpCountQuery(
    CHURCH_A,
    MEETING_A
  ).toSQL();

  assert.match(text, /"tasks"\."related_type" = \$\d/);
  assert.ok(params.includes("meeting"));
});

test("deleted tasks and subtasks are outside the follow-up count", () => {
  // A subtask is a checklist item, not a task (#370) — anything reporting a
  // NUMBER of tasks counts the population `listTasks` counts.
  const { sql: text } = meetingFollowUpCountQuery(CHURCH_A, MEETING_A).toSQL();

  assert.match(text, /"tasks"\."deleted_at" is null/);
  assert.match(text, /"tasks"\."parent_task_id" is null/);
});

test("completed is counted by status, not by a completed_at timestamp", () => {
  const { sql: text } = meetingFollowUpCountQuery(CHURCH_A, MEETING_A).toSQL();

  assert.match(text, /filter \(where "status" = 'complete'\)/);
});

// ============================================================================
// VM-020 — the absence rule, pinned on the source
// ============================================================================

test("an unfinalized meeting returns no figure at all", () => {
  // `getFollowUpCompletion` needs a database to run, so the rule is pinned on
  // the source instead: the finalized marker is `actual_attendance`, and the
  // early return is what stops a never-finalized meeting rendering "0%".
  const source = readFileSync(
    path.join(process.cwd(), "src/lib/meetings/service.ts"),
    "utf8"
  );

  assert.match(
    source,
    /if \(!meeting \|\| meeting\.actualAttendance === null\) return null;/,
    "getFollowUpCompletion no longer bails out on an unfinalized meeting"
  );
  assert.match(
    source,
    /percent: total === 0 \? null : /,
    "a zero-denominator percentage is no longer null"
  );
});

test("the meeting page renders the follow-up card only when there is a figure", () => {
  const source = readFileSync(
    path.join(process.cwd(), "src/app/(dashboard)/meetings/[id]/page.tsx"),
    "utf8"
  );

  assert.match(
    source,
    /\{followUp && \(/,
    "the follow-up card is no longer gated on a non-null figure"
  );
  assert.match(
    source,
    /followUp\.percent === null \?/,
    "a zero-task meeting no longer gets its own wording"
  );
});

// ============================================================================
// VM-016c — the comparison
// ============================================================================

function point(
  meetingId: string,
  isoDate: string,
  totalScore: number
): EvaluationTrendPoint {
  return {
    meetingId,
    meetingNumber: null,
    totalScore,
    datetime: new Date(isoDate),
  };
}

const CURRENT = {
  meetingId: MEETING_A,
  datetime: new Date("2026-03-01T18:00:00.000Z"),
  totalScore: 4.4,
};

test("a first-ever evaluated meeting has NO comparison", () => {
  // The whole point of VM-016c's empty state: comparing against an absent
  // history would render a 4.4 first meeting as a 4.4-point collapse.
  assert.equal(compareEvaluationToHistory([], CURRENT), null);
});

test("a meeting alone in the trend still has no comparison", () => {
  const trend = [point(MEETING_A, "2026-03-01T18:00:00.000Z", 4.4)];

  assert.equal(compareEvaluationToHistory(trend, CURRENT), null);
});

test("only LATER meetings still means no comparison", () => {
  const trend = [
    point(MEETING_A, "2026-03-01T18:00:00.000Z", 4.4),
    point(MEETING_B, "2026-04-01T18:00:00.000Z", 3.0),
  ];

  assert.equal(compareEvaluationToHistory(trend, CURRENT), null);
});

test("the comparison averages every earlier evaluated meeting", () => {
  const trend = [
    point("aaaa", "2026-01-01T18:00:00.000Z", 3.5),
    point("bbbb", "2026-02-01T18:00:00.000Z", 4.1),
    point(MEETING_A, "2026-03-01T18:00:00.000Z", 4.4),
  ];

  const result = compareEvaluationToHistory(trend, CURRENT);

  assert.ok(result);
  assert.equal(result.previousCount, 2);
  assert.equal(result.previousAverage, 3.8);
  assert.equal(result.previousScore, 4.1, "the immediately previous score");
  assert.equal(result.currentScore, 4.4);
  assert.equal(result.delta, 0.6);
});

test("a drop is reported as a negative delta, not an absolute one", () => {
  const trend = [
    point("aaaa", "2026-01-01T18:00:00.000Z", 4.8),
    point(MEETING_A, "2026-03-01T18:00:00.000Z", 4.4),
  ];

  const result = compareEvaluationToHistory(trend, CURRENT);

  assert.ok(result);
  assert.equal(result.delta, -0.4);
});

test("the delta is exactly the two rendered numbers subtracted", () => {
  // Both figures are shown to one decimal. If the delta were computed on the
  // unrounded mean, the card could read "4.4, average 3.9, +0.4".
  const trend = [
    point("aaaa", "2026-01-01T18:00:00.000Z", 3.9),
    point("bbbb", "2026-01-15T18:00:00.000Z", 3.9),
    point("cccc", "2026-02-01T18:00:00.000Z", 4.0),
  ];

  const result = compareEvaluationToHistory(trend, CURRENT);

  assert.ok(result);
  assert.equal(
    result.delta,
    Math.round((result.currentScore - result.previousAverage) * 10) / 10
  );
});

test("the current meeting never lands inside its own baseline", () => {
  // Same-day meetings are the trap: an ordering-only filter would keep the
  // current row in `earlier` and dilute the average with the score itself.
  const trend = [
    point("aaaa", "2026-03-01T18:00:00.000Z", 2.0),
    point(MEETING_A, "2026-03-01T18:00:00.000Z", 4.4),
  ];

  assert.equal(
    compareEvaluationToHistory(trend, CURRENT),
    null,
    "a same-instant sibling is not 'before' this meeting"
  );
});

test("the comparison works for a meeting outside the trend window", () => {
  // `currentScore` is passed in rather than looked up, so a meeting that has
  // fallen out of the window still gets a comparison against what is left.
  const trend = [point("aaaa", "2026-01-01T18:00:00.000Z", 4.0)];

  const result = compareEvaluationToHistory(trend, CURRENT);

  assert.ok(result);
  assert.equal(result.previousCount, 1);
  assert.equal(result.currentScore, 4.4);
});

// ============================================================================
// VM-010k — the analytics meeting-type filter
// ============================================================================

test("no ?type= is the vision-meeting view existing users already had", () => {
  assert.equal(parseAnalyticsMeetingTypeFilter(undefined), "vision_meeting");
  assert.equal(DEFAULT_ANALYTICS_MEETING_TYPE, "vision_meeting");
});

test("every offered filter round-trips through the parser", () => {
  for (const option of ANALYTICS_MEETING_TYPE_FILTERS) {
    assert.equal(parseAnalyticsMeetingTypeFilter(option.value), option.value);
  }
});

test("an unrecognised or repeated ?type= narrows to the default, never widens", () => {
  // The dangerous fallback is "all": a hand-edited or duplicated query param
  // must not silently show figures across every meeting type.
  assert.equal(parseAnalyticsMeetingTypeFilter("everything"), "vision_meeting");
  assert.equal(parseAnalyticsMeetingTypeFilter(""), "vision_meeting");
  assert.equal(
    parseAnalyticsMeetingTypeFilter(["all", "team_meeting"]),
    "vision_meeting"
  );
});

test("only 'all' drops the type restriction on the analytics queries", () => {
  assert.equal(analyticsMeetingTypeArg("all"), undefined);
  assert.equal(analyticsMeetingTypeArg("vision_meeting"), "vision_meeting");
  assert.equal(analyticsMeetingTypeArg("orientation"), "orientation");
  assert.equal(analyticsMeetingTypeArg("team_meeting"), "team_meeting");
});

test("the analytics page passes the parsed filter to BOTH figure queries", () => {
  // One control, two reads. A page that filtered the trend but not the summary
  // tiles would show a chart and a headline that disagree.
  const source = readFileSync(
    path.join(
      process.cwd(),
      "src/app/(dashboard)/meetings/[id]/analytics/page.tsx"
    ),
    "utf8"
  );

  assert.match(
    source,
    /getAttendanceTrend\(user\.churchId, TREND_LIMIT, typeArg\)/
  );
  assert.match(source, /getMeetingSummaryStats\(user\.churchId, typeArg\)/);
});

test("every filter control carries cursor-pointer", () => {
  // Project hard rule (AGENTS.md): every clickable element.
  const source = readFileSync(
    path.join(
      process.cwd(),
      "src/app/(dashboard)/meetings/[id]/analytics/page.tsx"
    ),
    "utf8"
  );

  assert.match(source, /cursor-pointer/);
});
