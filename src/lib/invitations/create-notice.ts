// ============================================================================
// What the admin READS after creating an invitation — OV-003b (#293).
//
// `createInvitationAs` reports `emailSent`, three-valued on purpose (see
// `./service.ts`). This module is the one place that turns those three values
// into words, and it lives here rather than in the notice component for two
// reasons:
//
//   1. THE ACCEPTANCE CRITERION IS ABOUT THE COPY, not about the boolean. "A
//      failed send does not fail the create" is only half of it; the other half
//      is that the admin is told "invitation created — email could not be sent"
//      and given a way to fix it. A test that stops at `{ sent: false }` proves
//      the first half and nothing of the second. Pure copy is executable, so
//      the sentence itself is asserted (`./create-notice.test.ts`).
//
//   2. THE THREE VALUES MUST NOT COLLAPSE. `undefined` means "this path does
//      not send email at all" and `false` means "it tried and failed". A notice
//      written as `emailSent ? … : …` folds them together and tells somebody
//      an email failed when none was ever attempted. The switch below is
//      exhaustive over the three, so the distinction survives a rewrite.
//
// No imports, deliberately: the create form is a client component, so anything
// this module pulled in would be pulled into the browser bundle with it.
//
// WHAT THE RECOVERY IS, and why no sentence here hands over a URL. #304 ruling
// 4 item 5 (2026-08-09, reinforced 2026-08-11) forbids this surface rendering a
// `/register?invitation=` link at all, and named the admin's copy of it "a
// stopgap for the email delivery that has not shipped". #293 is that delivery,
// so the stopgap does not return: the answer to a refused send is **Resend
// email** on the invitation's own row, one section below, which the same track
// ships. Reintroducing a link here needs a ruling that supersedes item 5.
// ============================================================================

/**
 * The exact sentence the AC names for a created-but-unsent invitation.
 *
 * Exported as a constant so the surface, the test and any future retry affordance
 * quote ONE string. "Created" first, because that is the durable fact and the
 * one the admin must not misread as a failure: the invitation exists, is in the
 * list below, and can be revoked — only the delivery did not happen.
 */
export const INVITATION_EMAIL_FAILED_HEADLINE =
  "Invitation created — email could not be sent.";

/** Which of the three `emailSent` values produced this copy. */
export type InvitationNoticeState = "sent" | "not_sent" | "no_send_attempted";

export interface InvitationCreatedNotice {
  state: InvitationNoticeState;
  /** The fact, in one line. */
  headline: string;
  /** What the admin should do about it. */
  detail: string;
}

/**
 * Turn a create result into the notice.
 *
 * `emailSent` is exactly what `createInvitation` returned — do not normalise it
 * to a boolean on the way in, or the third state is lost before it arrives.
 */
export function invitationCreatedNotice({
  inviteeEmail,
  emailSent,
}: {
  inviteeEmail: string;
  emailSent?: boolean;
}): InvitationCreatedNotice {
  if (emailSent === true) {
    return {
      state: "sent",
      headline: `Invitation sent to ${inviteeEmail}`,
      detail:
        "The email carries the invitation, so there is nothing more to send. It only works for that address, so if the address is wrong, revoke this invitation and create a new one.",
    };
  }

  if (emailSent === false) {
    return {
      state: "not_sent",
      headline: INVITATION_EMAIL_FAILED_HEADLINE,
      detail: `The invitation exists and is in the list below. Use Resend email on its row to try again — nothing has reached ${inviteeEmail} yet.`,
    };
  }

  // `undefined`: nothing tried to send, so nothing failed. Says neither.
  return {
    state: "no_send_attempted",
    headline: `Invitation created for ${inviteeEmail}`,
    detail:
      "Tell them directly that you have invited them. Until they answer, it sits in the list below, where you can resend the email or revoke it.",
  };
}
