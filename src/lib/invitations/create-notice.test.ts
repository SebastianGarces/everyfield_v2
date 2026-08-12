import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { test } from "node:test";

// TYPE-ONLY, and it has to stay that way: `actions.ts` is a `"use server"`
// module that reaches the database and `next/cache`, neither of which belongs in
// a unit test's process. `import type` is erased, so this costs nothing at
// runtime and still fails `pnpm typecheck` the moment the action's payload stops
// matching the fixtures below — which is the link the previous pass was missing.
import type { CreateInvitationState } from "@/app/(dashboard)/oversight/invitations/actions";

import {
  INVITATION_EMAIL_FAILED_HEADLINE,
  invitationCreatedNotice,
} from "./create-notice";
import { assertInOrder, sourceReader } from "./source-span";

// ============================================================================
// OV-003b (#293), AC 3 — the half a forced-failure test cannot reach.
//
// "Send failure does not fail the invitation create (row still created; failure
// surfaced to the admin as 'invitation created — email could not be sent' with
// the copyable link as fallback)."
//
// `email.test.ts` proves the first clause: the transport can refuse or throw and
// `sendInvitationEmail` still returns `{ sent: false }` rather than throwing, so
// the committed row survives. That is a fact about a boolean. THIS file covers
// the second clause, which is a fact about WORDS: what the admin reads, in each
// of the three `emailSent` states, driven from the payload the action returns.
//
// The distinction matters because the first version of this workstream shipped a
// perfect `emailSent` and no reader for it. The value was computed, propagated
// through a carefully documented three-valued contract, and dropped one layer
// above — so the surface told every admin to go send the link themselves whether
// or not the email had gone out, and said nothing at all when it had not.
//
// ----------------------------------------------------------------------------
// THE AC's "copyable link" CLAUSE IS SUPERSEDED (reconciled 2026-08-12)
// ----------------------------------------------------------------------------
//
// #304 ruling 4 item 5 (2026-08-09, reinforced 2026-08-11) forbids
// `/oversight/invitations` rendering a `/register?invitation=` link at all, and
// named the admin's copy of it "a stopgap for the email delivery that has not
// shipped". #293 IS that delivery. The AC was written before the ruling; the
// ⚖ ruling is later and explicitly says not to reintroduce the link without one
// that supersedes it. So the fallback the AC asks for is now **Resend email**
// on the invitation's own row — the same track's work — and §5 below asserts
// the ABSENCE of a link, which is the stronger guard the ruling wants.
// ============================================================================

const ROOT = path.join(process.cwd(), "src");
const ACTIONS = readFileSync(
  path.join(
    ROOT,
    "app",
    "(dashboard)",
    "oversight",
    "invitations",
    "actions.ts"
  ),
  "utf8"
);
const CREATE_FORM = readFileSync(
  path.join(ROOT, "components", "oversight", "invitation-create-form.tsx"),
  "utf8"
);

const INVITEE = "new-planter@example.test";

/**
 * A create result, shaped as the action's own payload. Typed against
 * `CreateInvitationState` so a rename or a dropped field is a type error here
 * rather than a surface that silently stops branching.
 */
function created(
  emailSent?: boolean
): NonNullable<CreateInvitationState["created"]> {
  return {
    inviteeEmail: INVITEE,
    emailSent,
  };
}

function noticeFor(emailSent?: boolean) {
  const payload = created(emailSent);
  return invitationCreatedNotice({
    inviteeEmail: payload.inviteeEmail,
    emailSent: payload.emailSent,
  });
}

// ----------------------------------------------------------------------------
// 1. The failure wording the AC names, verbatim
// ----------------------------------------------------------------------------

test("a failed send is surfaced as 'invitation created — email could not be sent'", () => {
  const notice = noticeFor(false);

  assert.equal(notice.state, "not_sent");
  assert.equal(notice.headline, INVITATION_EMAIL_FAILED_HEADLINE);
  assert.match(
    notice.headline,
    /^Invitation created — email could not be sent\.$/,
    "the AC names this sentence; it is not paraphrasable"
  );

  // "Created" leads, because that is the durable fact. An admin who reads this
  // as a failed create will retry and hit the duplicate-pending refusal.
  assertInOrder(
    notice.headline.toLowerCase(),
    "the not_sent headline",
    ["created", "could not"],
    '"created" leads, because that is the durable fact'
  );

  // …and it names the RECOVERY, which is what the AC's "fallback" clause means
  // now that item 5 has removed the link (see the header). The invitee's
  // address is named, because the point is that nothing reached it.
  assert.match(notice.detail, new RegExp(INVITEE));
  assert.match(notice.detail, /resend email/i);

  // Never a link, in the one state most tempted to offer one.
  assert.doesNotMatch(notice.detail, /\/register|invitation=|this link/i);
});

// ----------------------------------------------------------------------------
// 2. The success wording — the inverse failure, and just as costly
// ----------------------------------------------------------------------------

test("a successful send says so, and stops telling the admin to deliver it", () => {
  const notice = noticeFor(true);

  assert.equal(notice.state, "sent");
  assert.equal(notice.headline, `Invitation sent to ${INVITEE}`);

  // The instruction to go deliver it by hand is gone. Telling an admin to
  // forward a link the invitee already has is the "we sent nothing" copy
  // failure inverted, and it costs the same trust.
  assert.doesNotMatch(notice.detail, /send this link|send them this link/i);
  assert.match(notice.detail, /nothing more to send/i);

  // A successful send must never claim the failure sentence, whatever else
  // changes about the copy.
  assert.notEqual(notice.headline, INVITATION_EMAIL_FAILED_HEADLINE);
  assert.doesNotMatch(notice.detail, /could not be sent/i);
});

// ----------------------------------------------------------------------------
// 3. The three values stay three
// ----------------------------------------------------------------------------

test("undefined is not false — an unattempted send reports no failure", () => {
  // The reason `emailSent` is optional rather than a boolean (`service.ts`).
  // `undefined` means "this path does not send email"; a notice written as
  // `emailSent ? … : …` would fold it into the failure branch and announce an
  // email problem where no email was ever attempted.
  const notice = noticeFor(undefined);

  assert.equal(notice.state, "no_send_attempted");
  assert.doesNotMatch(notice.headline, /could not be sent/i);
  assert.doesNotMatch(notice.detail, /could not be sent/i);
  assert.notEqual(notice.state, noticeFor(false).state);
});

test("the three states produce three different headlines", () => {
  const headlines = [true, false, undefined].map((v) => noticeFor(v).headline);
  assert.equal(new Set(headlines).size, 3, headlines.join(" | "));
});

// ----------------------------------------------------------------------------
// 4. The wiring — the value must actually arrive
// ----------------------------------------------------------------------------

test("the create action carries emailSent through to the surface", () => {
  // The defect this file exists to close: `emailSent` was produced by
  // `createInvitationAs`, propagated by `service.ts`, and then dropped by the
  // action, so no wording above could ever have been reached. Source-shaped,
  // because the action needs a session and a database to execute.
  // Through the reader (`./source-span`): a bare `indexOf` that stopped matching
  // would hand `assert.match` the last character of the module instead of the
  // success branch, and this file has no other guard that the branch exists.
  const returned = sourceReader(
    ACTIONS,
    "oversight/invitations/actions.ts"
  ).after("    created: {");
  assert.match(returned, /emailSent: result\.emailSent/);

  // Passed through untouched. `?? false` or `Boolean(...)` would collapse the
  // third state at the last possible moment.
  assert.doesNotMatch(ACTIONS, /emailSent:\s*Boolean\(/);
  assert.doesNotMatch(ACTIONS, /result\.emailSent\s*\?\?/);
});

test("the notice component branches on it rather than hard-coding copy", () => {
  // The words live in this module, so the assertions above are the surface's
  // assertions. A component that re-inlined them would pass every test here and
  // still be wrong on screen.
  assert.match(CREATE_FORM, /invitationCreatedNotice\(/);
  assert.match(CREATE_FORM, /emailSent: created\.emailSent/);
  assert.match(CREATE_FORM, /\{notice\.headline\}/);
  assert.match(CREATE_FORM, /\{notice\.detail\}/);

  // The pre-#293 copy is gone from the component — it documented a world where
  // nothing was ever sent, and it told every admin to deliver the link by hand.
  assert.doesNotMatch(
    CREATE_FORM,
    /Email delivery is not part of this surface/
  );
  assert.doesNotMatch(CREATE_FORM, /Send them this link\./);
});

// ----------------------------------------------------------------------------
// 5. …and no register link comes back with it (#304 ruling 4 item 5)
// ----------------------------------------------------------------------------
//
// The COMPONENT-side half of this lives in `invitations-ui.test.ts` §9, which
// owns the item-5 assertions for the whole page and strips comments before
// scanning (a comment RECORDING the removed link must not be what fails a
// test). What belongs here is the half §9 cannot see: the words themselves.

test("the three notices never mention a link the surface does not render", () => {
  // Copy and component cannot drift: the words live in `create-notice.ts` and
  // the surface renders them verbatim, so a sentence offering a link would ship
  // an instruction pointing at nothing.
  for (const emailSent of [true, false, undefined]) {
    const { headline, detail } = noticeFor(emailSent);
    assert.doesNotMatch(`${headline} ${detail}`, /\/register|invitation=/i);
  }
});
