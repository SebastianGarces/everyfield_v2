import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { test } from "node:test";

import {
  activeTeamMemberIdsQuery,
  buildTeamGuestListRows,
  dedupePersonIds,
  shouldPopulateGuestListFromTeam,
} from "./guest-list";

// ----------------------------------------------------------------------------
// VM-006 (#312) — the team roster as a guest list.
//
// A team meeting starts with its team's roster already invited. Three things
// that must hold, and each of them is a way to get it wrong:
//
//  - the roster is the ACTIVE members of ONE team in ONE church (an `inactive`
//    membership is a former member; another church's rows are not reachable);
//  - nobody appears twice, whether the duplicate comes from a person holding
//    two roles on the team or from the same meeting being populated twice;
//  - a meeting that is not a team meeting is not touched at all.
//
// The query half is rendered with `.toSQL()` and inspected — the technique
// `src/lib/wiki/tenancy.test.ts` uses — so a read that stopped scoping by
// church fails here even though it still type-checks and still returns rows.
// `.toSQL()` renders; it does not connect. A DATABASE_URL must be PRESENT
// (importing `@/db` builds the Neon client at module load), which `pnpm test`
// and CI both supply as a placeholder.
// ----------------------------------------------------------------------------

const CHURCH_A = "11111111-1111-4111-8111-111111111111";
const CHURCH_B = "22222222-2222-4222-8222-222222222222";
const TEAM_A = "33333333-3333-4333-8333-333333333333";
const TEAM_B = "44444444-4444-4444-8444-444444444444";
const MEETING_A = "55555555-5555-4555-8555-555555555555";
const PERSON_1 = "66666666-6666-4666-8666-666666666666";
const PERSON_2 = "77777777-7777-4777-8777-777777777777";
const USER = "88888888-8888-4888-8888-888888888888";

// ============================================================================
// The gate — which meetings get a roster
// ============================================================================

test("a team meeting with a team gets the roster", () => {
  assert.equal(shouldPopulateGuestListFromTeam("team_meeting", TEAM_A), true);
});

test("a non-team meeting is never auto-populated", () => {
  // The guest list of a vision meeting is who the planter invited. Filling it
  // from a team would put the wrong people in the room.
  for (const type of ["vision_meeting", "orientation"] as const) {
    assert.equal(
      shouldPopulateGuestListFromTeam(type, TEAM_A),
      false,
      `${type} was auto-populated from a team`
    );
  }
});

test("a team meeting with no team gets nothing, not a crash", () => {
  // `meetingCreateSchema` requires a teamId for a team meeting, but the column
  // is nullable and older rows predate that rule.
  assert.equal(shouldPopulateGuestListFromTeam("team_meeting", null), false);
  assert.equal(
    shouldPopulateGuestListFromTeam("team_meeting", undefined),
    false
  );
  assert.equal(shouldPopulateGuestListFromTeam("team_meeting", ""), false);
});

// ============================================================================
// The roster read
// ============================================================================

test("the roster is scoped to the church AND the team", () => {
  const { sql: text, params } = activeTeamMemberIdsQuery(
    CHURCH_A,
    TEAM_A
  ).toSQL();

  assert.match(text, /"team_memberships"\."church_id" = \$\d/);
  assert.match(text, /"team_memberships"\."team_id" = \$\d/);
  assert.ok(params.includes(CHURCH_A), "the church is not bound to the query");
  assert.ok(params.includes(TEAM_A), "the team is not bound to the query");
});

test("no other church's or team's id reaches the roster read", () => {
  const { params } = activeTeamMemberIdsQuery(CHURCH_A, TEAM_A).toSQL();

  assert.ok(!params.includes(CHURCH_B), "another church's id reached the read");
  assert.ok(!params.includes(TEAM_B), "another team's id reached the read");
});

test("only ACTIVE memberships are on the roster", () => {
  // Membership status is three-valued — `inactive` is a former member and
  // `pending` is not one yet. Dropping this predicate invites both.
  const { sql: text, params } = activeTeamMemberIdsQuery(
    CHURCH_A,
    TEAM_A
  ).toSQL();

  assert.match(text, /"team_memberships"\."status" = \$\d/);
  assert.ok(params.includes("active"), "the roster is not filtered to active");
  assert.ok(
    !params.includes("inactive") && !params.includes("pending"),
    "an inactive or pending membership can reach the roster"
  );
});

test("a soft-deleted person is not on the roster", () => {
  const { sql: text } = activeTeamMemberIdsQuery(CHURCH_A, TEAM_A).toSQL();

  assert.match(text, /"persons"\."deleted_at" is null/i);
});

test("the person joined is the church's own person", () => {
  // The membership row carries a church_id and so does the person; a join that
  // checked only the membership would read another church's person row.
  const { sql: text } = activeTeamMemberIdsQuery(CHURCH_A, TEAM_A).toSQL();

  assert.match(text, /"persons"\."church_id" = \$\d/);
});

test("the roster read is DISTINCT", () => {
  // Two roles on one team is two membership rows and the same guest twice.
  const { sql: text } = activeTeamMemberIdsQuery(CHURCH_A, TEAM_A).toSQL();

  assert.match(text, /select distinct/i);
});

// ============================================================================
// No duplicates
// ============================================================================

test("dedupePersonIds keeps first-seen order and drops repeats", () => {
  assert.deepEqual(
    dedupePersonIds([
      { personId: PERSON_1 },
      { personId: PERSON_2 },
      { personId: PERSON_1 },
    ]),
    [PERSON_1, PERSON_2]
  );
  assert.deepEqual(dedupePersonIds([PERSON_2, PERSON_2]), [PERSON_2]);
  assert.deepEqual(dedupePersonIds([]), []);
});

test("N active members become N guest rows, once each", () => {
  const rows = buildTeamGuestListRows(
    CHURCH_A,
    MEETING_A,
    [PERSON_1, PERSON_2, PERSON_1],
    USER
  );

  assert.equal(rows.length, 2);
  assert.deepEqual(
    rows.map((row) => row.personId),
    [PERSON_1, PERSON_2]
  );
});

test("every guest row carries the church, the meeting and the author", () => {
  const rows = buildTeamGuestListRows(CHURCH_A, MEETING_A, [PERSON_1], USER);

  assert.deepEqual(rows[0], {
    churchId: CHURCH_A,
    meetingId: MEETING_A,
    personId: PERSON_1,
    status: "absent",
    createdBy: USER,
  });
});

test("an auto-populated guest is invited, not marked attended", () => {
  // The guest list is who was invited; attendance is marked after the meeting.
  // Seeding "attended" would make every team meeting report full attendance.
  const rows = buildTeamGuestListRows(
    CHURCH_A,
    MEETING_A,
    [PERSON_1, PERSON_2],
    USER
  );

  for (const row of rows) {
    assert.equal(row.status, "absent");
  }
});

test("an empty team produces no INSERT at all", () => {
  assert.deepEqual(buildTeamGuestListRows(CHURCH_A, MEETING_A, [], USER), []);
});

// ============================================================================
// The write leans on the database, not on the read
// ============================================================================

test("the guest-list insert defers duplicates to the unique index", () => {
  // `memory/invariants.md` → Transactions: SELECT-then-INSERT is not a
  // concurrency guard. Two submissions of the create form race the roster read,
  // so the repeat must be refused by
  // `meeting_attendance_meeting_person_unique` and made a no-op by DO NOTHING.
  const source = readFileSync(
    path.join(process.cwd(), "src/lib/meetings/guest-list.ts"),
    "utf8"
  );

  assert.match(
    source,
    /addTeamMembersToGuestList[\s\S]*?onConflictDoNothing\(\{\s*target: \[\s*meetingAttendance\.meetingId,\s*meetingAttendance\.personId,?\s*\],?\s*\}\)/,
    "the roster insert no longer carries ON CONFLICT DO NOTHING on (meeting, person)"
  );
});

test("createMeeting populates the guest list from the roster it announces to", () => {
  // ONE roster read serves the guest list and the training announcement, so the
  // people invited and the people announced to cannot become different sets.
  const source = readFileSync(
    path.join(process.cwd(), "src/lib/meetings/service.ts"),
    "utf8"
  );

  assert.match(
    source,
    /shouldPopulateGuestListFromTeam\(/,
    "createMeeting no longer gates the guest list on the meeting type"
  );
  assert.match(
    source,
    /await addTeamMembersToGuestList\(\s*churchId,\s*meeting\.id,\s*teamMemberIds,\s*userId\s*\)/,
    "createMeeting no longer adds the roster to the new meeting's guest list"
  );
  assert.match(
    source,
    /emitTrainingScheduled\(\s*data\.teamId,\s*teamMemberIds,/,
    "the training announcement no longer uses the same roster as the guest list"
  );
});
