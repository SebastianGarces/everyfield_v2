import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { test } from "node:test";

import {
  pendingInvitationsForPlantQuery,
  pendingInvitationsForSendingChurchQuery,
} from "./queries";

// ============================================================================
// #304 / OV-005 — what the planter is offered an ANSWER to.
//
// The reminder is dismissible only by answering, so what appears in it is a
// commitment: an invitation the planter cannot get rid of had better be one the
// server will still accept. Two independent things have to hold, and they fail
// differently:
//
//   1. THE PREDICATE. "Pending" is not "answerable" — expiry is lazy in this
//      product (`expireInvitationQuery` runs only when somebody tries to
//      answer), so a closed window still reads `pending` until then. Read off
//      the generated SQL, because no behaviour shows it without a live
//      Postgres and a 30-day-old row (HR4 finding, 2026-08-09).
//   2. THE SURFACE. There is no dismiss control anywhere on either rendering,
//      and the dashboard's copy of the list is gated on the one role that may
//      answer. Source-shaped, because "no such button exists" is a fact about
//      the file.
// ============================================================================

const ROOT = path.join(process.cwd(), "src", "app", "(dashboard)");

/**
 * The file with its comments removed. Every "there is no such control" check
 * below is about what the module DOES, and these modules explain at length why
 * they do not do it — a prose mention of `useDismissed` is the explanation, not
 * the mistake.
 */
const code = (source: string) =>
  source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1");

const read = (...segments: string[]) =>
  code(readFileSync(path.join(ROOT, ...segments), "utf8"));

const REMINDER = read("dashboard", "association-reminder.tsx");
// The FINISHED dashboard, which is where the reminder renders. `/dashboard`
// split into `page.tsx` (session + `?step=` + the onboarding fork) and these
// two halves on 2026-08-12 (PR #408); the banner belongs to the plant half.
const DASHBOARD = read("dashboard", "plant-dashboard.tsx");
const ANSWER = read("settings", "association", "invitation-answer.tsx");
const PAGE = read("settings", "association", "page.tsx");
const LEAVE_DIALOG = read("settings", "association", "leave-org-dialog.tsx");

const PLANT = "11111111-1111-4111-8111-111111111111";
const SENDING_CHURCH = "22222222-2222-4222-8222-222222222222";
const NOW = new Date("2026-08-09T12:00:00.000Z");

// ----------------------------------------------------------------------------
// 1. Only an ANSWERABLE invitation is offered an answer
// ----------------------------------------------------------------------------

test("the pending list refuses rows whose window has closed", () => {
  const { sql, params } = pendingInvitationsForPlantQuery(PLANT, NOW).toSQL();

  // The three clauses, all of them, and the third is the one #304's first build
  // shipped without: an expired-but-unstamped row rendered with live Accept and
  // Decline buttons the server then refused with "Invitation has expired" —
  // and, the reminder being dismissible only by answering, could not be cleared.
  assert.match(sql, /"target_church_id" = \$1/);
  assert.match(sql, /"status" = \$2/);
  assert.match(
    sql,
    /\("organization_invitations"\."expires_at" is null or "organization_invitations"\."expires_at" > \$3\)/
  );

  assert.deepEqual(params.slice(0, 2), [PLANT, "pending"]);
  // The instant is the SERVER's, bound as a parameter — not a client's, and not
  // `now()` evaluated by the database on a row the caller chose.
  assert.equal(
    new Date(params[2] as string | Date).toISOString(),
    NOW.toISOString()
  );
});

test("a row with no expiry is still answerable", () => {
  // `expires_at` is nullable and pre-#23 rows carry no window at all. `is null
  // OR` is what keeps them answerable rather than silently unanswerable — the
  // same disjunction `bindOpenInvitationTargetQuery` uses, so the two readings
  // of "still open" cannot drift.
  const { sql } = pendingInvitationsForPlantQuery(PLANT, NOW).toSQL();
  assert.match(sql, /"expires_at" is null or/);
});

test("a declined or revoked invitation leaves the reminder on the next render", () => {
  // The status predicate is the whole mechanism: answering writes `declined`
  // (or the org writes `revoked`), the action calls `refresh()`, and this query
  // no longer returns the row. Nothing client-side remembers it, which is why
  // "dismissed only by answering" is a property of the data rather than of the
  // component.
  const { params } = pendingInvitationsForPlantQuery(PLANT, NOW).toSQL();
  assert.equal(params[1], "pending");
  assert.doesNotMatch(REMINDER, /useState|useEffect/);
});

// ----------------------------------------------------------------------------
// 2. The reminder cannot be dismissed any other way
// ----------------------------------------------------------------------------

test("the reminder has no dismiss control of any kind", () => {
  // OV-005: "dismissed only by answering". Every other dashboard banner uses
  // `useDismissed`; this one must not, and must not grow a close button, an X,
  // or a snooze either.
  assert.doesNotMatch(REMINDER, /useDismissed/);
  assert.doesNotMatch(REMINDER, /dismiss/i);
  assert.doesNotMatch(REMINDER, /Later|Not now|Remind me/i);

  // The only controls it renders are the two answers, and they come from the
  // component the settings screen uses — so the question is answered the same
  // way in both places and neither has a third option.
  assert.match(REMINDER, /<InvitationAnswer/);
  const buttons = ANSWER.match(/<Button/g) ?? [];
  assert.equal(buttons.length, 2, "accept and decline, and nothing else");
});

test("the dashboard only asks for invitations somebody may answer", () => {
  // A banner whose buttons the server refuses is worse than no banner: OV-010
  // makes accept and decline the planter's, so a team member or coach is never
  // shown the question at all. The gate is a courtesy — `verifyInvitationAuthority`
  // refuses them again — but a reminder they cannot dismiss would be a trap.
  assert.match(
    DASHBOARD,
    /role === "planter"\s*\?\s*getPendingInvitationsForPlant\(churchId\)/
  );
  assert.match(DASHBOARD, /<AssociationReminder/);
});

test("the settings surface redirects anyone who could not act on it", () => {
  // TWO roles can act here since #304 WS3, and the guard is positive — each
  // view is entered by the role that owns it, and the redirect is what is left
  // over. Stated that way round so a third answering role cannot be admitted by
  // forgetting to add it to a negation.
  assert.match(PAGE, /user\.role === "planter" && user\.churchId/);
  assert.match(
    PAGE,
    /user\.role === "sending_church_admin" && user\.sendingChurchId/
  );
  assert.match(PAGE, /redirect\("\/settings"\)/);

  // The redirect is the LAST thing, so it cannot be reached by a role that has
  // a view above it.
  assert.ok(
    PAGE.indexOf('redirect("/settings")') >
      PAGE.indexOf('user.role === "sending_church_admin"'),
    "the redirect must be the fall-through, not a gate in front of a view"
  );
});

test("the sending church's pending list refuses rows whose window has closed", () => {
  // The same three clauses as the plant-side query, on the other target column.
  // A second surface that offers an ANSWER is a second place the lazy-expiry
  // trap can be re-opened, so it is read off the SQL here too rather than
  // trusted to have been copied correctly.
  const { sql, params } = pendingInvitationsForSendingChurchQuery(
    SENDING_CHURCH,
    NOW
  ).toSQL();

  assert.match(sql, /"target_sending_church_id" = \$1/);
  assert.match(sql, /"status" = \$2/);
  assert.match(
    sql,
    /\("organization_invitations"\."expires_at" is null or "organization_invitations"\."expires_at" > \$3\)/
  );

  assert.deepEqual(params.slice(0, 2), [SENDING_CHURCH, "pending"]);
  assert.equal(
    new Date(params[2] as string | Date).toISOString(),
    NOW.toISOString()
  );

  // And it names the SENDING CHURCH's own column only. Matching on
  // `target_church_id` here would hand a sending-church admin the invitations
  // addressed to a plant that happens to share the id.
  assert.doesNotMatch(sql, /"target_church_id"/);
});

// ----------------------------------------------------------------------------
// 3. House rules on the surfaces this unit owns
// ----------------------------------------------------------------------------

test("every clickable on the association surfaces carries cursor-pointer", () => {
  for (const [name, source] of [
    ["invitation-answer", ANSWER],
    ["leave-org-dialog", LEAVE_DIALOG],
    ["association-reminder", REMINDER],
  ] as const) {
    const clickables =
      source.match(/<(Button|AlertDialogCancel|Link)\b/g) ?? [];
    const pointers = source.match(/cursor-pointer/g) ?? [];
    assert.ok(clickables.length > 0, name);
    assert.ok(
      pointers.length >= clickables.length,
      `${name}: ${clickables.length} clickables, ${pointers.length} cursor-pointer`
    );
  }
});

test("the leave dialog is type-to-confirm, and the typing is not the authority", () => {
  // OV-007a. The match is trimmed and case-insensitive on purpose — the control
  // is deliberateness, not transcription — and the button stays disabled until
  // it holds.
  assert.match(
    LEAVE_DIALOG,
    /confirmation\.trim\(\)\.toLowerCase\(\) === orgName\.trim\(\)\.toLowerCase\(\)/
  );
  assert.match(LEAVE_DIALOG, /disabled=\{!confirmed \|\| pending\}/);

  // And the request it sends carries no id at all — the org is named by KIND,
  // so there is nothing on this screen for a forged submit to re-aim.
  assert.match(LEAVE_DIALOG, /leaveOversightOrg\(orgType\)/);
  assert.doesNotMatch(LEAVE_DIALOG, /orgId/);
});
