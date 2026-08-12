"use server";

import { db } from "@/db";
import { isUniqueViolation } from "@/db/errors";
import type { UserRole } from "@/db/schema";
import { sendingChurches, sendingNetworks, users } from "@/db/schema";
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
import { churchCreationStatements } from "@/lib/onboarding/create-church";
import { extractFieldErrors, registerSchema } from "@/lib/validations";
import type { AccountType } from "@/lib/validations/auth";
import { eq } from "drizzle-orm";
import type { BatchItem } from "drizzle-orm/batch";
import { redirect } from "next/navigation";
import {
  BETA_GATE_ERROR,
  BETA_GATE_INVALID_ERROR,
  describeInvitationForRegistration,
  hasValidInvitationBypass,
  invitationEmailMismatchMessage,
  isBetaCodeValid,
  isBetaGateEnabled,
  registrationEmailMatchesInvitation,
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
  const invitation = await describeInvitationForRegistration(invitationId);

  // THE TOKEN IS BOUND TO THE INVITED ADDRESS — RULED 2026-08-04 (#23).
  //
  // An invitation link is a uuid in a URL: it is forwarded, pasted, archived.
  // Until this check, whoever held one could register under any address they
  // liked and receive the association meant for somebody else — the form
  // pre-fills the invited address, but a pre-filled field is a suggestion, and
  // this action is a POST endpoint that never saw the form. So the address is
  // re-checked HERE, before the beta gate (a token is also a bypass of it) and
  // before any account exists. A wrong address is not re-aimed at: the admin
  // revokes and re-invites, which is the only path that leaves an audit trail
  // of who was actually invited.
  if (
    invitation &&
    !registrationEmailMatchesInvitation(invitation.inviteeEmail, identifier)
  ) {
    return {
      fieldErrors: {
        email: invitationEmailMismatchMessage(invitation.inviteeEmail),
      },
    };
  }

  // Private-beta gate (server-side enforced). Skipped entirely when the env
  // var is unset/empty. Org-invitation signups (the invitation IS the invite)
  // bypass the code — but only for the address the invitation names, or the
  // link would be a free pass into the beta for anyone it was forwarded to.
  // Validated regardless of client-side visibility.
  if (isBetaGateEnabled()) {
    const bypassed = await hasValidInvitationBypass(invitationId, identifier);

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
  const redeeming = invitation?.redeemable ? invitation : null;
  const invitedPlanter =
    redeeming?.accountType === "planter" && accountType === "planter";

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
    invitedPlanter
  );
  const { role, churchId, sendingChurchId, sendingNetworkId } = account;

  const statements: [BatchItem<"pg">, ...BatchItem<"pg">[]] = [
    db
      .insert(users)
      .values({
        id: userId,
        email: identifier,
        passwordHash,
        name,
        role,
        // For an invited planter the church link is written by the
        // `linkUserToChurchFilter` compare-and-set in `account.linkStatements`
        // — the same statement onboarding's step 1 batches — never by this
        // insert, so the link contract has exactly one spelling (ruling
        // 408-4B). `account.churchId` still names the church for the
        // invitation redemption below.
        churchId: null,
        sendingChurchId,
        sendingNetworkId,
      })
      .returning({ id: users.id }),
    // The church link + its privacy row, AFTER the users insert both
    // reference. The `ON CONFLICT DO NOTHING` on the privacy row comes with
    // the shared statements (#198): a retry racing its own predecessor cannot
    // dead-end on the unique index.
    ...account.linkStatements,
  ];

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
  if (redeeming) {
    await redeemRegistrationInvitation(redeeming, {
      id: userId,
      role,
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
 * Plan the organizational entity for the account type: the role and FK values
 * to set on the user, plus the entity's statements for the caller's batch —
 * never awaited here, so the entity, the user, the church link and the privacy
 * row commit or roll back together. Ids are minted up front
 * (`crypto.randomUUID()`, as `createChurchDeps.newChurchId` does) so each
 * statement can reference rows that do not exist yet.
 *
 * The statements come back in two lists because they straddle the users
 * insert: `statements` is the org entity itself (the users FKs point at it, so
 * it goes first), and `linkStatements` is what needs the users row to exist —
 * the church link and its privacy row.
 *
 * Planters sign up without creating a church — they get free access to
 * Phase 0 content and the Wiki. They create their church from the dashboard
 * when they're ready.
 */
function createAccountEntities(
  accountType: AccountType,
  organizationName: string | null,
  userId: string,
  createChurchForPlanter = false
): {
  role: UserRole;
  churchId: string | null;
  sendingChurchId: string | null;
  sendingNetworkId: string | null;
  /** The org-entity insert, or empty for a cold planter signup. */
  statements: BatchItem<"pg">[];
  /** Statements that reference the users row — batched AFTER its insert. */
  linkStatements: BatchItem<"pg">[];
} {
  switch (accountType) {
    case "planter": {
      // An INVITED planter is the exception: the invitation exists to associate
      // a church plant, so the plant is created here and named by the planter.
      // Note what is NOT set — neither oversight FK. The association is written
      // by the accept path, guarded on the invitation reading `accepted`, so
      // the plant can never be bound to an org without an acceptance behind it.
      if (createChurchForPlanter && organizationName) {
        // The church-creation contract is stated ONCE, by
        // `churchCreationStatements` (`src/lib/onboarding/create-church.ts`,
        // ruling 408-4B): the church insert, the `linkUserToChurchFilter`
        // compare-and-set and the `ON CONFLICT DO NOTHING` privacy row are
        // the same statements onboarding's step 1 batches — composed around
        // this path's users insert rather than reimplemented beside it, so
        // the privacy row and the FK order cannot drift between the two
        // church-creation paths.
        const churchId = crypto.randomUUID();
        const [createChurch, linkPlanter, privacyRow] =
          churchCreationStatements({
            churchId,
            plantedBy: userId,
            name: organizationName,
            city: null,
            stateRegion: null,
            country: null,
          });

        return {
          role: "planter",
          churchId,
          sendingChurchId: null,
          sendingNetworkId: null,
          statements: [createChurch],
          linkStatements: [linkPlanter, privacyRow],
        };
      }

      // No church created at signup — planter gets free Phase 0 / Wiki access
      // They'll create a church from the dashboard when ready
      return {
        role: "planter",
        churchId: null,
        sendingChurchId: null,
        sendingNetworkId: null,
        statements: [],
        linkStatements: [],
      };
    }

    case "sending_church": {
      if (!organizationName) {
        throw new Error(
          "Organization name is required for sending church accounts"
        );
      }
      // Create a new sending church (independent, no network)
      const sendingChurchId = crypto.randomUUID();

      return {
        role: "sending_church_admin",
        churchId: null,
        sendingChurchId,
        sendingNetworkId: null,
        statements: [
          db
            .insert(sendingChurches)
            .values({ id: sendingChurchId, name: organizationName }),
        ],
        linkStatements: [],
      };
    }

    case "network": {
      if (!organizationName) {
        throw new Error("Organization name is required for network accounts");
      }
      // Create a new sending network
      const sendingNetworkId = crypto.randomUUID();

      return {
        role: "network_admin",
        churchId: null,
        sendingChurchId: null,
        sendingNetworkId,
        statements: [
          db
            .insert(sendingNetworks)
            .values({ id: sendingNetworkId, name: organizationName }),
        ],
        linkStatements: [],
      };
    }
  }
}

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
 * the actor is the planter of the church the invitation now targets.
 *
 * Never throws. An invitation that cannot be redeemed must not cost somebody
 * their account.
 */
async function redeemRegistrationInvitation(
  invitation: RegistrationInvitation,
  user: {
    id: string;
    role: UserRole;
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
