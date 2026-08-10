import assert from "node:assert/strict";
import { test } from "node:test";

import { PgDialect } from "drizzle-orm/pg-core";
import type { SQL } from "drizzle-orm";

import {
  DELIVERED_STATUSES,
  OPENED_STATUSES,
  TEAM_GROUP_PREFIX,
  UNREACHABLE_STATUSES,
  churchDeliveryScope,
  countAttempted,
  countOfStatus,
  countOfStatuses,
  isTeamGroup,
  messageRecipientScope,
  nonOpenerScope,
  parseTeamGroup,
  selectableTeamsScope,
  sentMessagesScope,
  sentSinceScope,
  teamGroup,
  teamMemberScope,
} from "./queries";

// ----------------------------------------------------------------------------
// The delivery overview (COM-019), the resend recipient resolution (COM-018)
// and the ministry-team recipient group (MT-015) are all reads whose ONLY
// tenant boundary is the predicate they carry — isolation is application-layer
// here, with no RLS behind it (`memory/invariants.md` -> Multi-Tenancy). A
// dropped `church_id` would not fail, throw, or look wrong; it would quietly
// report another church's open rate, or resolve a resend to another church's
// people.
//
// These tests compile each predicate with the real Postgres dialect (no
// connection is opened) and pin both the emitted SQL and its bound parameters.
// The same technique `filters.test.ts` uses on the history query.
// ----------------------------------------------------------------------------

const dialect = new PgDialect();
const CHURCH_ID = "11111111-1111-4111-8111-111111111111";
const OTHER_CHURCH_ID = "22222222-2222-4222-8222-222222222222";
const COMMUNICATION_ID = "33333333-3333-4333-8333-333333333333";
const TEAM_ID = "44444444-4444-4444-8444-444444444444";

function compile(fragment: SQL) {
  const query = dialect.sqlToQuery(fragment);
  return { text: query.sql, params: query.params };
}

/** Count the occurrences of a global regexp in the compiled SQL. */
function countMatches(text: string, pattern: RegExp): number {
  return text.match(pattern)?.length ?? 0;
}

// --- delivery aggregate scope (COM-019) -------------------------------------

test("the delivery aggregate scopes BOTH joined tables to the church", () => {
  const { text, params } = compile(churchDeliveryScope(CHURCH_ID));

  assert.match(text, /"communications"\."church_id" = \$1/);
  assert.match(text, /"communication_recipients"\."church_id" = \$2/);
  assert.deepEqual(params, [CHURCH_ID, CHURCH_ID]);
});

test("the delivery aggregate cannot admit a second church", () => {
  const { params } = compile(churchDeliveryScope(CHURCH_ID));

  assert.ok(!params.includes(OTHER_CHURCH_ID));
});

test("the delivery aggregate says nothing about message status", () => {
  // Faithful to what the recipient rows record: a draft and the `logged`
  // entries COM-020 writes carry no recipient rows, so they need no filter,
  // and this read must not pre-empt the pending logged-vs-sent ruling.
  const { text } = compile(churchDeliveryScope(CHURCH_ID));

  assert.doesNotMatch(text, /"status"/);
});

test("the sent-message count is church-scoped and status-filtered", () => {
  const { text, params } = compile(sentMessagesScope(CHURCH_ID));

  assert.match(text, /"communications"\."church_id" = \$1/);
  assert.match(text, /"communications"\."status" = \$2/);
  assert.deepEqual(params, [CHURCH_ID, "sent"]);
});

test("'sent this week' keeps the status filter, so a logged contact cannot count", () => {
  const since = new Date("2026-08-02T00:00:00.000Z");
  const { text, params } = compile(sentSinceScope(CHURCH_ID, since));

  assert.match(text, /"communications"\."church_id" = \$1/);
  // The status predicate is the whole point: a COM-020 `logged` entry carries a
  // `sent_at` too, so a window over the date alone would count it as a send.
  assert.match(text, /"communications"\."status" = \$2/);
  assert.match(text, /"communications"\."sent_at" >= \$3/);
  assert.deepEqual(params.slice(0, 2), [CHURCH_ID, "sent"]);
  // Drizzle maps the Date to the column's own timestamp encoding before it
  // becomes a bound parameter, so compare the instant, not the representation.
  assert.equal(
    new Date(params[2] as string | number | Date).getTime(),
    since.getTime()
  );
});

// --- aggregate expressions --------------------------------------------------

test("attempted counts every recipient row past pending", () => {
  const { text, params } = compile(countAttempted());

  assert.match(
    text,
    /count\(\*\) filter \(where "communication_recipients"\."status" <> 'pending'\)::int/
  );
  assert.deepEqual(params, []);
});

test("a single-status count binds the status as a parameter", () => {
  const { text, params } = compile(countOfStatus("clicked"));

  assert.match(
    text,
    /count\(\*\) filter \(where "communication_recipients"\."status" = \$1\)::int/
  );
  assert.deepEqual(params, ["clicked"]);
});

test("a multi-status count binds every status as a parameter", () => {
  const { text, params } = compile(countOfStatuses(DELIVERED_STATUSES));

  assert.match(
    text,
    /count\(\*\) filter \(where "communication_recipients"\."status" in \(\$1, \$2, \$3\)\)::int/
  );
  assert.deepEqual(params, ["delivered", "opened", "clicked"]);
});

test("a click implies an open, so both statuses count as opened", () => {
  const { params } = compile(countOfStatuses(OPENED_STATUSES));

  assert.deepEqual(params, ["opened", "clicked"]);
});

// --- non-openers (COM-018) --------------------------------------------------

test("the non-opener scope pins the church on the recipient, the message and the person", () => {
  const { text, params } = compile(nonOpenerScope(CHURCH_ID, COMMUNICATION_ID));

  assert.match(text, /"communication_recipients"\."church_id" = \$1/);
  assert.match(text, /"communications"\."church_id" = \$2/);
  assert.match(text, /"persons"\."church_id" = \$\d/);
  assert.equal(countMatches(text, /"church_id" = \$\d/g), 3);
  assert.equal(params[0], CHURCH_ID);
  assert.equal(params[1], CHURCH_ID);
});

test("the non-opener scope narrows to the one message", () => {
  const { text, params } = compile(nonOpenerScope(CHURCH_ID, COMMUNICATION_ID));

  assert.match(text, /"communication_recipients"\."communication_id" = \$3/);
  assert.equal(params[2], COMMUNICATION_ID);
});

test("anyone who opened is excluded twice over — by status and by timestamp", () => {
  const { text, params } = compile(nonOpenerScope(CHURCH_ID, COMMUNICATION_ID));

  // The status is the tracked state; opened_at is the same fact written a
  // second way. Either one recording an open is enough to skip the person.
  assert.match(
    text,
    /"communication_recipients"\."status" not in \(\$4, \$5\)/
  );
  assert.deepEqual(params.slice(3, 5), ["opened", "clicked"]);
  assert.match(text, /"communication_recipients"\."opened_at" is null/);
});

test("an address that bounced OR failed is never resent to", () => {
  // Ruled 2026-08-09 (PR #371): `failed` is excluded exactly like `bounced`.
  // The provider refused the address; retrying it immediately cannot succeed
  // and spends sender reputation to find that out again.
  const { text, params } = compile(nonOpenerScope(CHURCH_ID, COMMUNICATION_ID));

  assert.match(
    text,
    /"communication_recipients"\."status" not in \(\$6, \$7\)/
  );
  assert.deepEqual(params.slice(5, 7), ["bounced", "failed"]);
});

test("the unreachable statuses are exactly bounced and failed", () => {
  assert.deepEqual([...UNREACHABLE_STATUSES], ["bounced", "failed"]);
});

test("the non-opener scope excludes deleted people and people with no address", () => {
  const { text } = compile(nonOpenerScope(CHURCH_ID, COMMUNICATION_ID));

  assert.match(text, /"persons"\."deleted_at" is null/);
  assert.match(text, /"persons"\."email" is not null/);
});

test("the resend denominator is scoped to the church and the message", () => {
  const { text, params } = compile(
    messageRecipientScope(CHURCH_ID, COMMUNICATION_ID)
  );

  assert.match(text, /"communication_recipients"\."church_id" = \$1/);
  assert.match(text, /"communication_recipients"\."communication_id" = \$2/);
  assert.deepEqual(params, [CHURCH_ID, COMMUNICATION_ID]);
});

// --- ministry-team recipient groups (MT-015) --------------------------------

test("a team selector round-trips through teamGroup/parseTeamGroup", () => {
  assert.equal(teamGroup(TEAM_ID), `${TEAM_GROUP_PREFIX}${TEAM_ID}`);
  assert.equal(parseTeamGroup(teamGroup(TEAM_ID)), TEAM_ID);
});

test("a status group is not a team", () => {
  for (const group of [
    "core_group",
    "launch_team",
    "leaders",
    "prospects",
    "all",
  ]) {
    assert.equal(parseTeamGroup(group), null);
  }
});

test("an empty or whitespace-only team id is not a team", () => {
  assert.equal(parseTeamGroup("team:"), null);
  assert.equal(parseTeamGroup("team:   "), null);
});

test("a malformed team selector is still recognised AS a team selector", () => {
  // The distinction that keeps `team:` from resolving to every active person:
  // it claims to be a team, so it must never reach the status-group branch,
  // where an unrecognised group means everyone.
  assert.equal(isTeamGroup("team:"), true);
  assert.equal(isTeamGroup(teamGroup(TEAM_ID)), true);
  assert.equal(isTeamGroup("core_group"), false);
  assert.equal(isTeamGroup("all"), false);
});

test("the team quick-select list is church-scoped and drops paused teams", () => {
  const { text, params } = compile(selectableTeamsScope(CHURCH_ID));

  assert.match(text, /"ministry_teams"\."church_id" = \$1/);
  assert.match(text, /"ministry_teams"\."status" <> \$2/);
  assert.deepEqual(params, [CHURCH_ID, "paused"]);
});

test("team members resolve church-scoped on both the membership and the person", () => {
  const { text, params } = compile(teamMemberScope(CHURCH_ID, TEAM_ID));

  assert.match(text, /"team_memberships"\."church_id" = \$1/);
  assert.match(text, /"persons"\."church_id" = \$\d/);
  assert.equal(countMatches(text, /"church_id" = \$\d/g), 2);
  assert.equal(params[0], CHURCH_ID);
});

test("only ACTIVE members of the named team resolve", () => {
  const { text, params } = compile(teamMemberScope(CHURCH_ID, TEAM_ID));

  assert.match(text, /"team_memberships"\."team_id" = \$2/);
  assert.match(text, /"team_memberships"\."status" = \$3/);
  assert.equal(params[1], TEAM_ID);
  assert.equal(params[2], "active");
  assert.match(text, /"persons"\."deleted_at" is null/);
});
