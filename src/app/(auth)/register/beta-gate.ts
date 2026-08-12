import type { OrganizationInvitation } from "@/db/schema";
import { getInvitation, lookupInvitingOrgName } from "@/lib/invitations/core";

/**
 * Private-beta gate helpers (server-side only).
 *
 * When `BETA_INVITE_CODE` is set (non-empty), cold sign-ups must supply a
 * matching code. When it is unset/empty, registration is fully open
 * (dev-friendly). The code value is NEVER sent to the client — the register
 * page only learns a boolean (`isBetaGateEnabled`) telling it whether to
 * render the input. This module is imported exclusively by the server-side
 * register action and the server-component register page; the client form
 * receives only the boolean flag.
 */

export const BETA_GATE_ERROR =
  "EveryField is in private beta - ask your sending church or network for an invite code.";

export const BETA_GATE_INVALID_ERROR =
  "That invite code isn't valid - double-check it with your sending church or network.";

function getBetaInviteCode(): string {
  return (process.env.BETA_INVITE_CODE ?? "").trim();
}

/** True when the private-beta gate is active. */
export function isBetaGateEnabled(): boolean {
  return getBetaInviteCode().length > 0;
}

/**
 * Validate a submitted beta code against `BETA_INVITE_CODE`
 * (case-insensitive, trimmed). Always false when gating is disabled callers
 * should gate on `isBetaGateEnabled()` first.
 */
export function isBetaCodeValid(submitted: string | null | undefined): boolean {
  const expected = getBetaInviteCode();
  if (expected.length === 0) return true;
  return (submitted ?? "").trim().toLowerCase() === expected.toLowerCase();
}

/**
 * An invitation is addressed to ONE person, and the link is not a bearer token.
 *
 * RULED 2026-08-04 (#23): registration with an invitation token must use the
 * invited address. The token travels by email and is a uuid in a URL — it gets
 * forwarded, pasted into a group chat, sits in a mail archive — and before this
 * anyone holding one could register under ANY address and walk off with the
 * association (and, when the beta gate is on, with a free bypass of it). The
 * address is now part of the credential: this comparison is what the register
 * action (through `invitationActedOnAtRegistration`) and the beta-gate bypass
 * both go through. Wrong address = the admin revokes and re-invites; there is
 * deliberately no way to re-aim a live invitation.
 *
 * A mismatch is SILENT since 2026-08-12 (Ruling C, #304 round 11). It is not
 * refused with a message any more — it simply carries no invitation, exactly as
 * an unknown id does. The rule is unchanged; only the disclosure went.
 *
 * Both sides are normalized the way `users.email` is stored (trim + lowercase),
 * so casing or a stray space is a match, not a refusal.
 *
 * An invitation with NO recorded address (rows predating #23, when
 * `invitee_email` was added) matches NOTHING — there is nothing to bind the
 * link to, which is exactly the bearer token this ruling closes. Such a link no
 * longer registers anybody; the org re-invites.
 */
export function registrationEmailMatchesInvitation(
  invitationEmail: string | null | undefined,
  registeringEmail: string | null | undefined
): boolean {
  const invited = (invitationEmail ?? "").trim().toLowerCase();
  const registering = (registeringEmail ?? "").trim().toLowerCase();
  if (invited.length === 0 || registering.length === 0) return false;
  return invited === registering;
}

/**
 * What a mismatch is told — WITH NO SHIPPED CALLER, deliberately (Ruling C,
 * #304 round 11, 2026-08-12).
 *
 * It named the invited address, which is fine on a surface that has already
 * proven the reader is the invitee and fatal on one that has not. The anonymous
 * `/register` POST is the second kind: returning this told a visitor holding any
 * invitation id both that the id is live and which address it names, which is
 * the account-existence oracle rulings 2, 4-item-5, A and B all closed
 * elsewhere. So the message was removed from that action rather than moved
 * behind a session, and it comes back on an invitee-proven surface in a
 * follow-up issue.
 *
 * Kept rather than deleted BECAUSE it has no caller: the copy is ruled and
 * wanted, and `invitations-ui.test.ts` §8 asserts that the register action does
 * not reach it — a guard that deleting the function would not give. Do not wire
 * it into anything session-free.
 */
export function invitationEmailMismatchMessage(
  invitationEmail: string | null | undefined
): string {
  const invited = (invitationEmail ?? "").trim();
  return invited.length > 0
    ? `This invitation was sent to ${invited}. Register with that address, or ask them to invite this one instead.`
    : "This invitation link cannot be used to create an account. Ask your sending church or network to send a new one.";
}

/** The columns this screen's decision is made from — a subset, so a test can build one. */
export type InvitationForRegistration = Pick<
  OrganizationInvitation,
  | "id"
  | "type"
  | "status"
  | "expiresAt"
  | "inviteeEmail"
  | "targetChurchId"
  | "targetSendingChurchId"
  | "sendingChurchId"
  | "sendingNetworkId"
>;

/**
 * A row `isOpenRedeemableInvitation` has accepted: addressed, and open on both
 * target columns. The narrowing is the reason `RegistrationInvitation` can
 * promise a non-null `inviteeEmail`.
 */
export type OpenRedeemableInvitation = InvitationForRegistration & {
  inviteeEmail: string;
  targetChurchId: null;
  targetSendingChurchId: null;
};

/**
 * WHAT `/register` MAY ACT ON — ONE DEFINITION, TWO READERS (#304 round 11,
 * ruled 2026-08-12).
 *
 * Two functions in this file read the same invitation row on the same public,
 * session-free route: `describeInvitationForRegistration` (what the page
 * renders) and `hasValidInvitationBypass` (whether the beta gate is skipped).
 * Round 10 closed the account-existence oracle in the FIRST one and left the
 * second reading the raw row, so with `BETA_INVITE_CODE` set a POST still
 * separated a targeted id (bypass granted → "An account with this email already
 * exists") from a guessed uuid (bypass refused → `BETA_GATE_ERROR`) with no
 * session. Copying the two target checks into the bypass would have been a
 * SECOND copy of this rule, and two copies drifting apart is precisely how the
 * hole survived rounds 8, 9 and 10. So the rule is a function, and both readers
 * call it.
 *
 * True only for a row that is:
 *   - `pending` — answered, revoked and expired rows are not offers;
 *   - unexpired at `now` — expiry is lazy, so the column is checked, not the
 *     status (`memory/invariants.md` → Multi-Tenancy);
 *   - addressed — an invitation with no `invitee_email` binds to nobody, which
 *     is the bearer token the 2026-08-04 ruling closed;
 *   - OPEN — both target columns null. A targeted invitation belongs to an
 *     address that already had an account when it was issued, is answered from
 *     `/settings/association`, and creates nothing by being registered with.
 *     Acting on one here buys an attacker nothing and discloses that the
 *     address is taken.
 *
 * `now` is a parameter so a caller can pin the boundary; it defaults to the
 * wall clock, which is what both shipped readers pass.
 *
 * It is a TYPE PREDICATE as well as a rule: the four guards it replaced are
 * what narrowed `invitee_email` from nullable to `string` for
 * `RegistrationInvitation`, so saying so in the signature is what stops a
 * future reader "simplifying" the address check back out of it — the build
 * fails instead.
 */
export function isOpenRedeemableInvitation(
  invitation: InvitationForRegistration,
  now: Date = new Date()
): invitation is OpenRedeemableInvitation {
  if (invitation.status !== "pending") return false;
  if (invitation.expiresAt && invitation.expiresAt < now) return false;
  if (!invitation.inviteeEmail) return false;
  return (
    invitation.targetChurchId === null &&
    invitation.targetSendingChurchId === null
  );
}

/**
 * The two reads the `/register` invitation readers perform, as a seam.
 *
 * Not a testing convenience: the rule above is a NULL-RETURN, and the three
 * previous attempts at rules of this shape were all guarded by regexes over the
 * source that passed while the property was false (`memory/invariants.md` →
 * Multi-Tenancy). A regex cannot follow a derivation; only calling the function
 * can. The functions read the database, so the only way a unit test calls the
 * real ones is to hand them their reads.
 *
 * `hasValidInvitationBypass` uses `loadInvitation` only — it names no org — but
 * takes the same seam type rather than a narrower one, because the whole point
 * of round 11 is that these two readers are held to ONE rule and a second,
 * subtly different seam is the next place they drift.
 */
export type RegistrationInvitationReader = {
  loadInvitation: (id: string) => Promise<InvitationForRegistration | null>;
  lookupInvitingOrgName: (
    invitation: InvitationForRegistration
  ) => Promise<string | null>;
};

/** The real reads. The default, and the only one any shipped caller uses. */
export const registrationInvitationReader: RegistrationInvitationReader = {
  loadInvitation: getInvitation,
  lookupInvitingOrgName,
};

/**
 * An org invitation IS an invite — invited planters/admins bypass the beta
 * code. Returns true when the id names an invitation `/register` may act on
 * (`isOpenRedeemableInvitation`) AND the account being registered is the one it
 * was addressed to. Everything else — invalid, expired, answered, unknown,
 * TARGETED, or the right id with the wrong address — falls through to the beta
 * gate rather than granting access.
 *
 * The address is a parameter and not an afterthought: this bypass is the OTHER
 * thing an invitation token buys, so binding only the redemption would have
 * left the link a free pass into a private beta for whoever it was forwarded to.
 *
 * The TARGET refusal is round 11's (ruled 2026-08-12) and it costs nothing: a
 * targeted invitee already has an account and dies on "user already exists" one
 * branch later. What it removes is the disclosure — after it, a targeted id and
 * a guessed uuid both answer `BETA_GATE_ERROR`.
 */
export async function hasValidInvitationBypass(
  invitationId: string | null,
  registeringEmail: string,
  reader: RegistrationInvitationReader = registrationInvitationReader
): Promise<boolean> {
  if (!invitationId) return false;

  try {
    const invitation = await reader.loadInvitation(invitationId);
    if (!invitation) return false;
    if (!isOpenRedeemableInvitation(invitation)) return false;
    return registrationEmailMatchesInvitation(
      invitation.inviteeEmail,
      registeringEmail
    );
  } catch {
    return false;
  }
}

/**
 * What the register page needs to know about an invitation token (#23).
 *
 * EVERY INVITATION THIS TYPE DESCRIBES IS OPEN (#304 round 10, ruled
 * 2026-08-11). A targeted invitation — one whose invitee already had an account
 * when it was issued — is answered from `/settings/association` and is now
 * `null` here, so there is no `redeemable` flag left to carry: a value that is
 * constant true is not a field, it is a sentence in a comment.
 *
 * `accountType` SURVIVES, and only because of that null-return. It is read off
 * `invitation.type`, and `type` is target-derived in general
 * (`resolveInvitationRequest` picks the kind from the RESOLVED target and falls
 * back to the admin's `inviteAs` only when there is no target) — which is why
 * the round-10 ruling offered to delete it. On a row with NO target the
 * fallback is the only branch that can have run, so what this field carries is
 * the inviting admin's own form selection and nothing about the invitee. The
 * two alternatives the ruling named both break a live path: an open
 * `sending_church_to_network` invitation registers a SENDING CHURCH, and a
 * constant `"planter"` (or no field at all) would ask that invitee to name a
 * church plant and leave `redeemRegistrationInvitation` with nothing to bind.
 * See `memory/invariants.md` → Multi-Tenancy for the rule this rests on: if a
 * targeted invitation ever becomes describable again, this field goes with it.
 */
export type RegistrationInvitation = {
  id: string;
  /**
   * The address the invitation was issued to. NOT nullable: since the
   * 2026-08-04 ruling the registering email must equal this one, so an
   * invitation with no recorded address describes nothing this page can offer
   * (see `describeInvitationForRegistration`).
   */
  inviteeEmail: string;
  invitingOrgName: string;
  /** The account type this invitation creates when redeemed. */
  accountType: "planter" | "sending_church";
};

/**
 * Describe an invitation for the register screen. Returns `null` for anything
 * a visitor should not be told about — unknown, answered, revoked, expired —
 * so a guessed uuid learns nothing beyond "no invitation here", the same
 * silence `hasValidInvitationBypass` gives it.
 *
 * Runs with NO session, by construction: there is no account yet.
 *
 * ----------------------------------------------------------------------------
 * A TARGETED INVITATION IS INDESCRIBABLE HERE (#304 round 10, RULED 2026-08-11)
 * ----------------------------------------------------------------------------
 *
 * Ruling 4 item 5 closed the account-existence oracle on `/oversight/invitations`
 * — no branching notice, no `isOpen`, no caption, no register link. It left the
 * same question answerable one route over, and this diff is what armed it:
 * #304 revives targeting, so `redeemable` and `accountType` stopped being
 * constants and started varying with `target_church_id` /
 * `target_sending_church_id`. The attack needs no session and no error. An
 * oversight admin types any address, reads the deliberately neutral success
 * notice, takes the new row's id — which is in their own DOM by design, because
 * Revoke needs it — and opens `/register?invitation=<id>` in a private window.
 * A redeeming form means the address has no EveryField account; anything else
 * means it has one.
 *
 * So the boundary is not "no admin surface renders the link". It is this
 * function's own answer: a row with either target column set is `null`, beside
 * the unknown/answered/expired/addressless nulls, and a targeted token, an
 * answered one and a guessed uuid all render the identical page.
 *
 * NOTHING IS LOST. A targeted invitee already has an account, cannot register
 * again, and answers from `/settings/association`.
 *
 * ROUND 11 (ruled 2026-08-12) closed the other half. This function was the only
 * reader that got the null-return; `hasValidInvitationBypass` still read the raw
 * row, so with the beta gate on the POST answered a targeted id and a guessed
 * uuid differently. Both readers now apply `isOpenRedeemableInvitation`, which
 * is where the four guards below moved to — this function adds only the two
 * things the PAGE additionally needs: an org whose name resolves, and the
 * fields it renders.
 *
 * PINNED BY CALLING THIS FUNCTION, never by a regex over the page — see
 * `RegistrationInvitationReader` above and `invitations-ui.test.ts` §9c.
 */
export async function describeInvitationForRegistration(
  invitationId: string | null,
  reader: RegistrationInvitationReader = registrationInvitationReader
): Promise<RegistrationInvitation | null> {
  if (!invitationId) return null;

  try {
    const invitation = await reader.loadInvitation(invitationId);
    if (!invitation) return null;
    // THE SHARED PREDICATE — pending, unexpired, addressed, and both target
    // columns null. Applied here rather than inline so this function and
    // `hasValidInvitationBypass` cannot answer differently about the same row,
    // and BEFORE anything else is read, so a targeted token and a guessed uuid
    // cost the same work as well as returning the same answer.
    if (!isOpenRedeemableInvitation(invitation)) return null;

    // ONE implementation, in the invitations domain, reached through the seam —
    // this file used to run its own SQL against `sendingChurches` /
    // `sendingNetworks` (#293), which was both a duplicated decision and an app
    // route reaching past another domain's exports. The copy took
    // `type: string` and fell through to `null`, so it would have gone on
    // returning `null` for a fourth invitation type while the original refused
    // to compile. `registrationInvitationReader` now defaults this to
    // `lookupInvitingOrgName` from `@/lib/invitations/core`, so the seam is a
    // test seam and not a second implementation.
    const invitingOrgName = await reader.lookupInvitingOrgName(invitation);
    if (!invitingOrgName) return null;

    return {
      id: invitation.id,
      inviteeEmail: invitation.inviteeEmail,
      invitingOrgName,
      accountType:
        invitation.type === "sending_church_to_network"
          ? "sending_church"
          : "planter",
    };
  } catch {
    return null;
  }
}

/**
 * WHAT THE ANONYMOUS `/register` POST ACTS ON — RULED 2026-08-12 (#304 round
 * 11, Ruling C).
 *
 * The register action's whole invitation decision, as a pure function, so a
 * test can assert it by CALLING it across rows instead of by grepping the
 * action. The three source-text regexes this replaces (`invitations-ui.test.ts`
 * §8) were the fourth guard of that family in this track, and the family's
 * record is that a regex passes while the property is false.
 *
 * The rule: an invitation is acted on ONLY when the submitted address is the one
 * it names. Anything else — a targeted row (already `null` out of
 * `describeInvitationForRegistration`), an answered or expired one, a guessed
 * uuid, or a real OPEN row submitted with a different address — is treated as
 * NO INVITATION AT ALL for every branch that follows: the beta-gate bypass, the
 * "name your church plant" requirement, and the redemption.
 *
 * WHY A MISMATCH IS SILENT NOW. It used to return
 * `invitationEmailMismatchMessage`, which is a per-row message on a session-free
 * POST: the three inputs the ruling requires to be indistinguishable — targeted
 * id, open id with the wrong address, nonexistent id — produced three different
 * responses. Ruling C: drop the message. A wrong-address submit falls through to
 * the ordinary sign-up exactly as an unknown id does. The 2026-08-04 binding
 * ruling is untouched, because it was never about the MESSAGE: redemption is
 * still gated on the invitation being non-null here, so a forwarded link still
 * cannot associate somebody else's plant. If the usability need surfaces, the
 * message returns behind a session on an invitee-proven surface.
 */
export function invitationActedOnAtRegistration(
  described: RegistrationInvitation | null,
  registeringEmail: string
): RegistrationInvitation | null {
  if (!described) return null;
  return registrationEmailMatchesInvitation(
    described.inviteeEmail,
    registeringEmail
  )
    ? described
    : null;
}
