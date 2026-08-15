import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { test } from "node:test";

import {
  attendanceRowQuery,
  meetingAttendedCountQuery,
  meetingResponseCountsQuery,
  meetingResponseDeleteQuery,
} from "./service";

// ----------------------------------------------------------------------------
// VM-014 (#98) — response cards are CHURCH-SCOPED, at the query level.
//
// Tenancy in this repo is enforced in the application layer; there is no RLS
// behind these reads (memory/invariants.md → Multi-Tenancy). So the property
// worth asserting is not "the function takes a churchId" — it does, and a read
// that stopped USING it would still type-check, still return rows, and still
// pass every test written against its return value. What is asserted here is
// the SQL that would reach the database, the technique
// `follow-up-and-comparison.test.ts` and `wiki/tenancy.test.ts` use.
//
// The fixture is TWO CHURCHES, and the assertions run in both directions: the
// caller's ids are bound, and the other church's ids appear nowhere.
//
// `.toSQL()` renders; it does not connect. A DATABASE_URL must be PRESENT
// (importing `@/db` builds the Neon client at module load), which `pnpm test`
// and CI both supply as a placeholder.
// ----------------------------------------------------------------------------

const CHURCH_A = "11111111-1111-4111-8111-111111111111";
const CHURCH_B = "22222222-2222-4222-8222-222222222222";
const MEETING_A = "33333333-3333-4333-8333-333333333333";
const MEETING_B = "44444444-4444-4444-8444-444444444444";
const PERSON_A = "55555555-5555-4555-8555-555555555555";
const PERSON_B = "66666666-6666-4666-8666-666666666666";

// ============================================================================
// The breakdown reads
// ============================================================================

test("the response counts are scoped to the church AND the meeting", () => {
  const { sql: text, params } = meetingResponseCountsQuery(
    CHURCH_A,
    MEETING_A
  ).toSQL();

  assert.match(text, /"meeting_responses"\."church_id" = \$\d/);
  assert.match(text, /"meeting_responses"\."meeting_id" = \$\d/);
  assert.ok(params.includes(CHURCH_A), "the church is not bound to the query");
  assert.ok(
    params.includes(MEETING_A),
    "the meeting is not bound to the query"
  );
});

test("no other church's or meeting's id reaches the response counts", () => {
  const { params } = meetingResponseCountsQuery(CHURCH_A, MEETING_A).toSQL();

  assert.ok(
    !params.includes(CHURCH_B),
    "another church's id reached the count"
  );
  assert.ok(
    !params.includes(MEETING_B),
    "another meeting's id reached the count"
  );
});

test("the counts are grouped by response type, so the breakdown is one query", () => {
  const { sql: text } = meetingResponseCountsQuery(CHURCH_A, MEETING_A).toSQL();

  assert.match(text, /group by "meeting_responses"\."response_type"/i);
  assert.match(text, /count\(\*\)/i);
});

test("the attendee denominator is scoped to the church AND the meeting", () => {
  const { sql: text, params } = meetingAttendedCountQuery(
    CHURCH_A,
    MEETING_A
  ).toSQL();

  assert.match(text, /"meeting_attendance"\."church_id" = \$\d/);
  assert.match(text, /"meeting_attendance"\."meeting_id" = \$\d/);
  assert.ok(params.includes(CHURCH_A));
  assert.ok(params.includes(MEETING_A));
  assert.ok(!params.includes(CHURCH_B));
  assert.ok(!params.includes(MEETING_B));
});

test("the denominator counts `attended` positively, never `not absent`", () => {
  // The column has three values — `excused` is neither attended nor absent — so
  // a negated predicate would put excused people into `notRecordedCount`, which
  // reads as "we did not get a card from them" about people who were not there.
  const { sql: text, params } = meetingAttendedCountQuery(
    CHURCH_A,
    MEETING_A
  ).toSQL();

  assert.match(text, /"meeting_attendance"\."status" = \$\d/);
  assert.doesNotMatch(text, /"status" (<>|!=)/);
  assert.ok(params.includes("attended"));
});

// ============================================================================
// The write paths
// ============================================================================

test("the write's attendance guard names the church, the meeting and the person", () => {
  // `personId` and `meetingId` are both values a client chose. The guard is
  // what makes a forged church id reach no row, and what stops a response
  // existing for somebody who was never on the meeting's list.
  const { sql: text, params } = attendanceRowQuery(
    CHURCH_A,
    MEETING_A,
    PERSON_A
  ).toSQL();

  assert.match(text, /"meeting_attendance"\."church_id" = \$\d/);
  assert.match(text, /"meeting_attendance"\."meeting_id" = \$\d/);
  assert.match(text, /"meeting_attendance"\."person_id" = \$\d/);
  assert.ok(params.includes(CHURCH_A));
  assert.ok(params.includes(MEETING_A));
  assert.ok(params.includes(PERSON_A));
  assert.ok(!params.includes(CHURCH_B));
  assert.ok(!params.includes(PERSON_B));
});

test("clearing a card is a church-scoped DELETE, not a (meeting, person) one", () => {
  // The read half being over-broad leaks; the WRITE half being over-broad is a
  // cross-tenant deletion, and both ids arrive from the client.
  const { sql: text, params } = meetingResponseDeleteQuery(
    CHURCH_A,
    MEETING_A,
    PERSON_A
  ).toSQL();

  assert.match(text, /^delete from "meeting_responses"/i);
  assert.match(text, /"meeting_responses"\."church_id" = \$\d/);
  assert.match(text, /"meeting_responses"\."meeting_id" = \$\d/);
  assert.match(text, /"meeting_responses"\."person_id" = \$\d/);
  assert.ok(params.includes(CHURCH_A));
  assert.ok(!params.includes(CHURCH_B));
});

// ============================================================================
// The upsert, pinned on the source
// ============================================================================

const SERVICE = readFileSync(path.join(__dirname, "service.ts"), "utf8");

/** The body of `recordMeetingResponse`, comments stripped. */
function recordBody(): string {
  const from = SERVICE.indexOf("export async function recordMeetingResponse");
  assert.notEqual(
    from,
    -1,
    "recordMeetingResponse moved — this guard is blind"
  );
  const to = SERVICE.indexOf(
    "export async function clearMeetingResponse",
    from
  );
  assert.notEqual(to, -1, "clearMeetingResponse moved — this guard is blind");

  return SERVICE.slice(from, to)
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/\/\/.*$/gm, "");
}

test("a re-keyed card overwrites, through the unique index and not a SELECT", () => {
  // SELECT-then-INSERT is not a concurrency guard (memory/invariants.md →
  // Transactions). A double-submitted form must not make one attendee count
  // twice in the breakdown, and the unique index is what makes that impossible
  // rather than unlikely.
  const body = recordBody();

  assert.match(body, /onConflictDoUpdate\(/, "the write is an upsert");
  assert.match(
    body,
    /target:\s*\[\s*meetingResponses\.meetingId,\s*meetingResponses\.personId,?\s*\]/,
    "the conflict target is the (meeting, person) unique constraint"
  );
  assert.doesNotMatch(
    body,
    /\.from\(meetingResponses\)/,
    "no pre-flight SELECT on meeting_responses stands in for the index"
  );
});

test("the upsert's SET is built field by field, never spread from the caller", () => {
  // A SET that could rewrite `church_id` or `person_id` from a caller-supplied
  // object is a tenancy hole — the same rule `progressUpsertQuery` follows.
  const body = recordBody();

  assert.doesNotMatch(
    body,
    /set:\s*\{\s*\.\.\./,
    "the SET must not spread a caller-supplied object"
  );
  assert.doesNotMatch(
    body,
    /set:\s*\{[^}]*churchId/,
    "the church is never rewritten by an update"
  );
  assert.doesNotMatch(
    body,
    /set:\s*\{[^}]*personId/,
    "the person is never rewritten by an update"
  );
});
