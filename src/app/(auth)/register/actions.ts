"use server";

import { db } from "@/db";
import { isUniqueViolation } from "@/db/errors";
import type { UserSeat } from "@/db/schema";
import { users } from "@/db/schema";
import {
  createSession,
  generateSessionToken,
  hashPassword,
  setSessionCookie,
} from "@/lib/auth";
import {
  checkRateLimit,
  getRequestIp,
  recordAttempt,
} from "@/lib/auth/rate-limit";
import {
  acceptInvitationAs,
  bindOpenInvitationTarget,
  invitationActorFromSession,
} from "@/lib/invitations/core";
import {
  claimUserInvitationStatement,
  describeUserInvitationForRegistration,
  userInvitationActedOnAtRegistration,
} from "@/lib/invitations/seat";
import { findLinkablePersonId } from "@/lib/people/account-person-link";
import { extractFieldErrors, registerSchema } from "@/lib/validations";
import { eq } from "drizzle-orm";
import type { BatchItem } from "drizzle-orm/batch";
import { redirect } from "next/navigation";
import { createAccountEntities } from "./account-entities";
import {
  BETA_GATE_ERROR,
  BETA_GATE_INVALID_ERROR,
  describeInvitationForRegistration,
  hasValidInvitationBypass,
  invitationActedOnAtRegistration,
  isBetaCodeValid,
  isBetaGateEnabled,
  type RegistrationInvitation,
} from "./beta-gate";

export type RegisterState = {
  error?: string;
  fieldErrors?: {
    email?: string;
    password?: string;
    name?: string;
    organizationName?: string;
  };
};

export async function register(
  _prevState: RegisterState,
  formData: FormData
): Promise<RegisterState> {
  const result = registerSchema.safeParse({
    email: formData.get("email"),
    password: formData.get("password"),
    name: formData.get("name"),
    accountType: formData.get("accountType") || "planter",
    organizationName: formData.get("organizationName") || undefined,
  });

  if (!result.success) {
    return {
      fieldErrors: extractFieldErrors<
        NonNullable<RegisterState["fieldErrors"]>
      >(result.error),
    };
  }

  const { email, password, name, accountType, organizationName } = result.data;
  const identifier = email.toLowerCase();
  const ip = await getRequestIp();

  // Rate-limit check BEFORE any account lookup/creation. Limited by IP.
  // Generic message avoids leaking whether the account exists.
  const { limited } = await checkRateLimit(identifier, ip, "register");
  if (limited) {
    return { error: "Too many attempts. Please try again later." };
  }

  // The invitation token, read from the field the form now renders (#23). It
  // was already read here before that — the form simply never sent it, so
  // invite-at-registration was unreachable and an invited planter arrived
  // unassociated. It is re-validated server-side, never trusted from the URL,
  // and looked up AFTER the rate limit so a guessed uuid cannot be probed for
  // free (an invitation id doubles as the beta-gate bypass token).
  const invitationId = (formData.get("invitationId") as string | null) || null;

  // THE TOKEN IS BOUND TO THE INVITED ADDRESS — RULED 2026-08-04 (#23), and
  // SILENTLY SINCE 2026-08-12 (#304 round 11, Ruling C).
  //
  // An invitation link is a uuid in a URL: it is forwarded, pasted, archived.
  // Whoever held one could otherwise register under any address they liked and
  // receive the association meant for somebody else — the form pre-fills the
  // invited address, but a pre-filled field is a suggestion, and this action is
  // a POST endpoint that never saw the form.
  //
  // `invitationActedOnAtRegistration` is that binding, and it is the ONLY place
  // this action decides anything about the token: from here down there is one
  // variable, and a null one means "no invitation", whatever the visitor
  // submitted. That matters because this endpoint takes no session — a
  // targeted id, an open id with the wrong address and a guessed uuid must be
  // indistinguishable in the response, and they are only indistinguishable if
  // every later branch reads the same null. The mismatch MESSAGE was the last
  // thing that told them apart, and Ruling C deleted it.
  // TWO KINDS OF TOKEN ARRIVE IN ONE FIELD, and one lookup decides which.
  //
  // `?invitation=` carries an ORGANIZATION invitation's uuid or a SEAT
  // invitation's random token (#495). The two never collide — a seat token is
  // 43 base64url characters and the org one is a uuid — and the seat lookup is
  // a point read on a sha256, so a uuid matches no row. The SEAT path is tried
  // first because it is the narrower one; whichever answers, the other is null
  // and every branch below reads exactly one variable.
  //
  // The address binding is applied to BOTH, by the same rule and for the same
  // reason: an invitation link travels by email, so acting on one submitted with
  // a different address would hand the holder somebody else's plant.
  const seatInvitation = userInvitationActedOnAtRegistration(
    await describeUserInvitationForRegistration(invitationId),
    identifier
  );

  const invitation = seatInvitation
    ? null
    : invitationActedOnAtRegistration(
        await describeInvitationForRegistration(invitationId),
        identifier
      );

  // Private-beta gate (server-side enforced). Skipped entirely when the env
  // var is unset/empty. Org-invitation signups (the invitation IS the invite)
  // bypass the code — but only for the address the invitation names, or the
  // link would be a free pass into the beta for anyone it was forwarded to.
  // Validated regardless of client-side visibility.
  //
  // The id handed over is `invitation?.id`, never the raw submitted one: a
  // token this action decided not to act on must not still buy a gate bypass.
  // `hasValidInvitationBypass` applies the same `isOpenRedeemableInvitation`
  // rule again on its own read, so this is belt AND braces rather than a
  // delegation — round 11 exists because those two readers disagreed.
  // A SEAT INVITATION IS AN INVITE TOO, so it bypasses the beta gate on exactly
  // the same footing: the plant's Owner or Admin addressed this person by name,
  // which is the fact the code stands in for. The bypass rides `seatInvitation`,
  // which is already address-bound, so a forwarded link buys nothing.
  if (isBetaGateEnabled() && !seatInvitation) {
    const bypassed = await hasValidInvitationBypass(
      invitation?.id ?? null,
      identifier
    );

    if (!bypassed) {
      const submittedCode = formData.get("inviteCode") as string | null;
      if (!isBetaCodeValid(submittedCode)) {
        // Distinguish a wrong code from a missing one so the user knows whether
        // to fix what they typed or go ask for a code.
        const hasSubmittedCode = (submittedCode ?? "").trim().length > 0;
        return {
          error: hasSubmittedCode ? BETA_GATE_INVALID_ERROR : BETA_GATE_ERROR,
        };
      }
    }
  }

  // Check if user already exists. This SELECT is the LEGIBLE refusal only,
  // never the concurrency guard — two concurrent registrations both pass it
  // (memory/invariants.md → Transactions: "SELECT-then-INSERT is not a
  // concurrency guard"). The real guard is `users_email_unique`, enforced
  // where the batch below fails and is caught.
  const existingUser = await db
    .select({ id: users.id })
    .from(users)
    .where(eq(users.email, identifier))
    .limit(1);

  if (existingUser.length > 0) {
    await recordAttempt(identifier, ip, "register", false);
    return { error: DUPLICATE_EMAIL_MESSAGE };
  }

  // Hash password
  const passwordHash = await hashPassword(password);

  // An invited planter is the ONE case where a planter's church is created at
  // signup: the invitation is what the church gets associated with, and there
  // is nothing to associate until the church exists. So the name is required
  // here even though it is optional for a cold planter signup.
  // No `redeemable` branch here since #304 round 10 (ruled 2026-08-11): a
  // targeted invitation is `null` out of `describeInvitationForRegistration`,
  // so an invitation that reached this far is OPEN and redeemable by
  // definition. The flag was constant true and cost an account-existence
  // oracle on this public route.
  //
  // And it is `invitation`, not the submitted id, which is why THIS branch is
  // not an oracle either (round 11): "please name your church plant" is only
  // ever asked of somebody who submitted the address the invitation names.
  const invitedPlanter =
    invitation?.accountType === "planter" && accountType === "planter";

  if (invitedPlanter && !organizationName) {
    return {
      fieldErrors: {
        organizationName: "Please name your church plant",
      },
    };
  }

  // Create entity + user + privacy settings as ONE `db.batch([...])` — a Neon
  // batched transaction, all-or-nothing (`src/db/index.ts`, and the exact shape
  // #198 gave `createChurchBasics`). Every id is minted up front so each
  // statement can name the rows the others create. Two failure modes this
  // closes, both previously reachable:
  //
  //  - two concurrent registrations of one address both passed the SELECT
  //    above; the loser's user INSERT threw on `users_email_unique` AFTER its
  //    church had committed — a 500 for the visitor and an orphan `churches`
  //    row nobody is linked to. In one batch the church rolls back with the
  //    user, and the catch below turns the violation into the same legible
  //    refusal the SELECT gives.
  //
  //  - a failure at the privacy insert left a planter LINKED to a church with
  //    no `church_privacy_settings` row, which no product path can repair
  //    (`createChurchBasics` refuses a planter who already has a church) and
  //    every `canAccessFeatureData` read then answered from a missing row.
  //    In one batch the church rolls back too, and the retry starts clean.
  //
  // Planters sign up without a church — they create one later from the
  // dashboard — so both statement lists may be empty.
  const userId = crypto.randomUUID();
  const account = createAccountEntities(
    accountType,
    organizationName ?? null,
    userId,
    // The registrant themselves. For an invited planter the church-creation
    // tuple mints a `persons` row from this (#378) — the lowercased address the
    // users insert stores, so the person and the account agree on it.
    { name, email: identifier },
    invitedPlanter,
    // AS-013's match-or-create, resolved here because the planner awaits
    // nothing. The plant may already hold a contact record for this address —
    // somebody invited to a vision meeting months ago — and it is LINKED rather
    // than duplicated. The recipe itself is the directory's
    // (`accountPersonLinkStatements`); this is only its input.
    seatInvitation
      ? {
          churchId: seatInvitation.churchId,
          seat: seatInvitation.seat,
          matchedPersonId: await findLinkablePersonId(
            seatInvitation.churchId,
            identifier
          ),
        }
      : null
  );
  const { seat, churchId, sendingChurchId, sendingNetworkId } = account;

  const statements: [BatchItem<"pg">, ...BatchItem<"pg">[]] = [
    db
      .insert(users)
      .values({
        id: userId,
        email: identifier,
        passwordHash,
        name,
        // THE SEAT AND ITS TENANCY ARE WRITTEN TOGETHER, and this is the one
        // place outside the seat-management surface where a seat is granted
        // (AS-012). Neither half means anything alone: `owner` says nothing
        // about whose owner, and an org FK with no seat is an account with no
        // standing in it.
        seat,
        // For an invited planter the church link is written by the
        // `linkUserToChurchFilter` compare-and-set in `account.linkStatements`
        // — the same statement onboarding's step 1 batches — never by this
        // insert, so the link contract has exactly one spelling (ruling
        // 408-4B). `account.churchId` still names the church for the
        // invitation redemption below.
        //
        // A SEAT INVITEE IS THE OTHER CASE, and `userChurchId` is what tells
        // them apart (#495). Their plant already exists, so there is no race to
        // compare-and-set against and the tenancy goes in HERE, beside the seat
        // — which is exactly what AS-012 means by "the same write that creates
        // the account". The planner decides which value this is; this insert
        // never re-decides it.
        churchId: account.userChurchId,
        sendingChurchId,
        sendingNetworkId,
      })
      .returning({ id: users.id }),
    // For an invited planter: the WHOLE church-creation tuple, verbatim,
    // AFTER the users insert its compare-and-set and privacy row reference.
    // The `ON CONFLICT DO NOTHING` on the privacy row comes with the shared
    // statements (#198): a retry racing its own predecessor cannot dead-end
    // on the unique index.
    //
    // For a seat invitee: the ONE person-link statement AS-013 asks for.
    ...account.linkStatements,
  ];

  // THE GRANT AND THE CLAIM COMMIT TOGETHER (AS-012). The claim is a
  // compare-and-set on `pending`, appended to the SAME batch as the users
  // insert, so an account can never exist holding a seat from an invitation
  // this batch did not close — and a failure anywhere rolls both back.
  if (seatInvitation) {
    statements.push(claimUserInvitationStatement(seatInvitation.id, userId));
  }

  // The org entity goes FIRST — the users FKs point at it. (`unshift` rather
  // than a spread literal only because `db.batch` wants a provably non-empty
  // tuple, which the always-present users insert supplies.)
  statements.unshift(...account.statements);

  try {
    await db.batch(statements);
  } catch (error) {
    // The unique index losing a duplicate-address race is an expected outcome
    // with a message, not a crash. Anything else — including any OTHER unique
    // violation — is a real failure and stays one: nothing was written, the
    // batch rolled back whole.
    if (isUniqueViolation(error, USERS_EMAIL_UNIQUE)) {
      await recordAttempt(identifier, ip, "register", false);
      return { error: DUPLICATE_EMAIL_MESSAGE };
    }
    throw error;
  }

  // Redeem the invitation now that the organization it associates exists.
  // Best-effort: a failure here leaves an account that registered fine and an
  // invitation still pending, which the planter can answer later — the one
  // thing it must never leave behind is an association without an accepted
  // invitation (memory/invariants.md → Multi-Tenancy).
  if (invitation) {
    await redeemRegistrationInvitation(invitation, {
      id: userId,
      seat,
      churchId,
      sendingChurchId,
      sendingNetworkId,
    });
  }

  // Create session
  const token = generateSessionToken();
  const session = await createSession(token, userId);

  // Set session cookie
  await setSessionCookie(token, session.expiresAt);

  // Record the successful attempt (recorded before redirect, which throws).
  await recordAttempt(identifier, ip, "register", true);

  redirect("/dashboard");
}

const DUPLICATE_EMAIL_MESSAGE = "An account with this email already exists";

/** The unique constraint on `users.email` — the REAL duplicate-account guard. */
const USERS_EMAIL_UNIQUE = "users_email_unique";

/**
 * Turn a redeemed invite link into a real association (#23 / OV-003).
 *
 * TWO WRITES, IN THIS ORDER, and the order is the whole design:
 *
 *   1. `bindOpenInvitationTarget` — point the invitation at the organization
 *      that was just created. It is a compare-and-set (`pending`, unexpired,
 *      NO target yet), which is what makes an invite link SINGLE USE: of two
 *      registrations racing one link, exactly one binds and the loser simply
 *      registers unassociated. It deliberately leaves `status` alone.
 *   2. `acceptInvitationAs` — the ordinary accept path, unchanged: it locks the
 *      target row, compare-and-sets the claim, and writes the association in
 *      one `db.batch`, gated on the invitation reading `accepted`.
 *
 * Splitting it this way is what keeps `memory/invariants.md` → Multi-Tenancy
 * true through a crash. After step 1 the row is `pending` with a target and
 * nothing is bound — a state the planter can finish answering later — rather
 * than an acceptance with no association behind it, which is the one state
 * nothing in the product can repair. Doing it the other way round (claim first,
 * then create the church) would produce exactly that.
 *
 * The actor is minted from the user row this request just INSERTed, which is
 * the same person the session cookie is about to be issued to — not a value
 * that arrived from a client. `verifyInvitationAuthority` then holds normally:
 * the actor is the Owner of the church the invitation now targets.
 *
 * Never throws. An invitation that cannot be redeemed must not cost somebody
 * their account.
 */
async function redeemRegistrationInvitation(
  invitation: RegistrationInvitation,
  user: {
    id: string;
    seat: UserSeat | null;
    churchId: string | null;
    sendingChurchId: string | null;
    sendingNetworkId: string | null;
  }
): Promise<void> {
  const target =
    invitation.accountType === "planter"
      ? user.churchId
        ? { targetChurchId: user.churchId }
        : null
      : user.sendingChurchId
        ? { targetSendingChurchId: user.sendingChurchId }
        : null;

  // The account type they registered as does not match what the invitation
  // creates (they switched the radio group). Nothing to bind; the invitation
  // stays pending for whoever it was meant for.
  if (!target) return;

  try {
    const bound = await bindOpenInvitationTarget(
      invitation.id,
      target,
      user.id
    );
    if (!bound) return;

    await acceptInvitationAs(invitationActorFromSession({ user }), bound.id);
  } catch (error) {
    console.error("redeeming a registration invitation failed", {
      invitationId: invitation.id,
      error,
    });
  }
}
