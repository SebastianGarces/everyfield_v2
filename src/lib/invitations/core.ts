// ============================================================================
// Organization invitations — the logic layer (issue #265).
//
// This module has NO "use server" directive, and that absence is the fix.
// `service.ts` used to be a `"use server"` module with eleven exports, and in a
// `"use server"` module every export is a POSTable endpoint whether or not any
// UI calls it: an anonymous request could accept an invitation on a stranger's
// behalf (`respondingUser` was an ARGUMENT), or sever any church's oversight
// association by guessing a uuid. Moving the logic here makes none of it
// reachable from a browser; `service.ts` now holds only actions that mint their
// actor from `verifySession()` and is the sole way in from the client.
//
// So: nothing in this file may be exported from a `"use server"` module without
// re-reading the authority rules below. `service.test.ts` pins both halves —
// that this file is not an endpoint surface, and that the action layer never
// takes an actor as an argument.
//
// Dropping the directive also drops the one thing it guaranteed for free: that
// this module can never be emitted into a client bundle. It holds every raw DB
// write and read for the feature and imports `@/db`, so a Client Component that
// imported it would pull `@neondatabase/serverless` into the browser with no
// build error. `import "server-only"` is the repo's usual rail for exactly this
// (`src/lib/auth/admin.ts:1`) and CANNOT be used here: the package's default
// entry is a bare `throw` and resolves to the empty file only under the
// `react-server` condition, so importing it would break every test that loads
// this module in a bare node process — which is all of `service.test.ts`. The
// replacement is a static one, in `service.test.ts` → "no client component can
// pull the logic layer into the browser": it walks the import graph from every
// `"use client"` entry and fails, with the offending chain, if this file is
// reachable. Do not swap it for the import without first making the tests run
// under `--conditions=react-server`.
//
// Every mutation that has an actor takes an `InvitationActor`, which can only
// be minted from a session (`invitationActorFromSession`). A bare `User` — the
// shape a forged payload could carry — is not assignable to it, so "trust the
// caller's user" cannot be written by accident. Same technique as
// `preferenceOwnerFromSession` in `@/lib/notifications/preferences`.
// ============================================================================

import {
  and,
  desc,
  eq,
  exists,
  gt,
  gte,
  lt,
  notExists,
  or,
  sql,
  type SQL,
} from "drizzle-orm";
import type { AnyPgColumn } from "drizzle-orm/pg-core";

import { db } from "@/db";
import {
  associationEvents,
  churches,
  organizationInvitations,
  sendingChurches,
  sendingNetworks,
  users,
  type NewOrganizationInvitation,
  type OrganizationInvitation,
  type User,
  type UserSeat,
} from "@/db/schema";
import type {
  OrganizationInvitationStatus,
  OrganizationInvitationType,
} from "@/db/schema/organization-invitation";
import type { AssociationOrgType } from "@/db/schema";
import {
  isOrgOwner,
  isOversightUser,
  isPlantOwner,
  oversightOrgOf,
  type SeatFields,
  type TenancyFields,
} from "@/lib/auth/tenancy";
import { redactForLog } from "@/lib/email/redact";
import { sharingDefaultsStatement } from "@/lib/privacy/sharing-defaults";
import {
  announceAssociationEnded,
  announceInvitationAccepted,
  announceInvitationDeclined,
  announceSendingChurchDeclinedNetwork,
  announceSendingChurchJoinedNetwork,
  announceSendingChurchLeftNetwork,
} from "@/lib/notifications/oversight";
import { announceRemovedFromOversightOrg } from "@/lib/notifications/plant-association";

import {
  acceptedAssociationEventStatement,
  auditableAssociationOrg,
  churchSubject,
  sendingChurchSubject,
  severAssociationWithAuditStatement,
} from "./audit";

import {
  sendInvitationEmail,
  type InvitationEmailDeps,
  type InvitationEmailOutcome,
  type InvitationSendOccasion,
} from "./email";
// NOT `./resend-window`, and not `InvitationEmailRefusal` either — both left
// with the resend path when it moved to `./resend.ts` (2026-08-12, PR #392
// warning (c)). The dedupe bucket is reported by that module and consumed by
// the surface; nothing in the shared layer reads it.

// ============================================================================
// Constants
// ============================================================================

/**
 * How long an invitation stays open: 30 days, SERVER-FIXED.
 *
 * RULED 2026-08-03 (#265): there is no client-facing expiry parameter, and #23's
 * create form gets no expiry field. An earlier round of this fix let the caller
 * name a window (clamped to 1–90 days, with user-facing copy for the refusal) —
 * nothing in the FRD or any AC asked for it, and an unspecified knob on a
 * `"use server"` endpoint is surface nobody has decided the rules for. Adding one
 * later means a ruling, a validation rule and a form field, in that order;
 * `service.test.ts` fails if `expiresInDays` reappears anywhere in this module.
 */
export const INVITATION_EXPIRY_DAYS = 30;

/**
 * How many times ONE inviting org may address ONE email address inside a
 * rolling `INVITATION_EXPIRY_DAYS` window (#304, HR4 2026-08-09).
 *
 * WHAT THIS IS FOR. #304 restored the targeted path, so an invitation addressed
 * to somebody who already has an account produces a DASHBOARD REMINDER on their
 * plant — and OV-005 makes that reminder dismissible ONLY by answering. The org
 * chooses its own display name, so without a cap an oversight admin could park
 * an attacker-chosen banner on an arbitrary planter's dashboard and, each time
 * the planter declined, put it straight back. Declining has to END something.
 *
 * `assertNoDuplicatePending` already stops two banners standing at once; it does
 * nothing about the replay, because a declined row is no longer pending. This
 * counts EVERY invitation the org has addressed to that address in the window,
 * whatever its status, so a decline–reinvite loop exhausts the allowance instead
 * of resetting it.
 *
 * AND IT RESETS AFTER A SEVER (round 10, ruled 2026-08-11). Counting every
 * status is what defeats the loop; it also meant an association that was
 * ACCEPTED and later ended still spent the allowance, so the three severs this
 * track ships could lock an org out of re-inviting a plant it legitimately
 * parted with — with a refusal message asserting a pending answer while nothing
 * was pending. `afterTheLastAssociationEventFilter` is the floor that fixes it:
 * only invitations created after the org's most recent `association_events` row
 * about the same subject count. A decline writes no event, so the loop is
 * unchanged.
 *
 * Three, not one: an admin genuinely does mistype an address, revoke, and send
 * again, and the window is a month. Three attempts a month is far more than that
 * needs and far less than a nuisance channel.
 */
export const INVITES_PER_INVITEE_PER_WINDOW = 3;

// ============================================================================
// Errors
// ============================================================================

/**
 * A failure the user is allowed to read: not found, not pending, expired, or
 * not yours. The action layer surfaces `message` verbatim and turns everything
 * else into a generic error, so an internal failure can never leak.
 */
export class InvitationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "InvitationError";
  }
}

export const NOT_AUTHORIZED_MESSAGE =
  "You are not authorized to respond to this invitation";

/**
 * A second accept, for a slot that is already bound to a DIFFERENT org.
 *
 * RULED here (#265, 2026-08-03): an accept never REPLACES an association. See
 * `acceptInvitationAs` for the reasoning and `memory/invariants.md` →
 * Multi-Tenancy for the consequence.
 */
export const ALREADY_ASSOCIATED_MESSAGE =
  "This organization is already associated with another one — that association has to be removed first";

// ============================================================================
// The actor
// ============================================================================

declare const invitationActorBrand: unique symbol;

/**
 * Who is acting. Structurally identical to the fields of a `User` we care
 * about, but branded: the ONLY way to obtain one is
 * `invitationActorFromSession`, so an authorization check can never be handed a
 * user object that arrived from a client.
 */
export type InvitationActor = {
  readonly id: string;
  readonly seat: UserSeat | null;
  readonly churchId: string | null;
  readonly sendingChurchId: string | null;
  readonly sendingNetworkId: string | null;
  readonly [invitationActorBrand]: true;
};

/**
 * Mint an actor from a validated session. Takes the whole session result — the
 * shape `verifySession()` returns — so the call site reads as "the actor is
 * whoever this request is authenticated as" and there is no id parameter for a
 * client value to slot into.
 */
export function invitationActorFromSession(session: {
  user: Pick<
    User,
    "id" | "seat" | "churchId" | "sendingChurchId" | "sendingNetworkId"
  >;
}): InvitationActor {
  const { user } = session;
  return {
    id: user.id,
    seat: user.seat,
    churchId: user.churchId,
    sendingChurchId: user.sendingChurchId,
    sendingNetworkId: user.sendingNetworkId,
  } as InvitationActor;
}

// ============================================================================
// What a client is told
// ============================================================================

/**
 * An invitation as an ACTION may return it. The row itself carries two internal
 * user uuids — `inviter_user_id` and `responded_by` — and the four actions used
 * to hand the whole row back, so the invitee learned the inviting admin's user
 * id and vice versa. Neither is anything a surface needs to render (a name would
 * be a join, not an id), and an id that reaches the client is an id somebody can
 * aim a request at, so they are dropped HERE rather than remembered at four call
 * sites. Do this before wiring a surface, not after: #277/#278 will read whatever
 * shape they find.
 */
export type InvitationView = Omit<
  OrganizationInvitation,
  "inviterUserId" | "respondedBy"
>;

/** The row, minus the two internal user ids. Total, so a new column is a compile error away from being reviewed. */
export function invitationView(row: OrganizationInvitation): InvitationView {
  return {
    id: row.id,
    type: row.type,
    // The address the ADMIN typed, not an identifier anybody can aim a request
    // at — and the only thing an invitations row has to render.
    inviteeEmail: row.inviteeEmail,
    targetChurchId: row.targetChurchId,
    targetSendingChurchId: row.targetSendingChurchId,
    sendingChurchId: row.sendingChurchId,
    sendingNetworkId: row.sendingNetworkId,
    status: row.status,
    respondedAt: row.respondedAt,
    createdAt: row.createdAt,
    expiresAt: row.expiresAt,
  };
}

// ============================================================================
// Create
// ============================================================================

/**
 * What a client may say when issuing an invitation: WHO is being invited. That
 * is the whole of it.
 *
 * Never which org is inviting, and never the invitation `type` — both are
 * derived from the actor by `resolveInvitationRequest`, because they are the
 * fields that decide who ends up associated with whom (and who gets notified
 * about it without consent — see `announceInvitationAcceptedForChurch`). And
 * never the expiry: `INVITATION_EXPIRY_DAYS` is server-fixed by the 2026-08-03
 * ruling, so this type has exactly two optional fields and one of them must be
 * set.
 */
export interface InvitationRequest {
  /**
   * The address the invite goes to. The ONLY thing a create form asks for
   * besides `inviteAs` — see `resolveInvitationTarget` for why there is no
   * picker of existing plants.
   */
  inviteeEmail: string;
  /**
   * Which kind of organization is being invited, for an invitee who has no
   * account yet and therefore no target row. Only a `network_admin` has a
   * choice to make (a plant or a sending church); a `sending_church_admin` may
   * only ever invite plants and the field is ignored for them.
   */
  inviteAs?: InvitationTargetKind;
  /**
   * Resolved from `inviteeEmail` by `resolveInvitationTarget`, NEVER sent by a
   * client. Kept on the request type — rather than as extra parameters — so
   * `resolveInvitationRequest` stays pure and unit-testable without a database.
   */
  targetChurchId?: string;
  targetSendingChurchId?: string;
}

/** What the invitee is: a church plant, or a sending church. */
export const invitationTargetKinds = ["church", "sending_church"] as const;
export type InvitationTargetKind = (typeof invitationTargetKinds)[number];

export function isInvitationTargetKind(
  value: unknown
): value is InvitationTargetKind {
  return (
    typeof value === "string" &&
    (invitationTargetKinds as readonly string[]).includes(value)
  );
}

/** Trim + lowercase, the form `users.email` is stored and compared in. */
export function normalizeInviteeEmail(value: unknown): string {
  return typeof value === "string" ? value.trim().toLowerCase() : "";
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

export const INVALID_EMAIL_MESSAGE = "Enter a valid email address";

/**
 * Is this an address we will address an invitation to?
 *
 * EXPORTED AS A PREDICATE RATHER THAN AS THE REGEX, because the answer travels
 * with `INVALID_EMAIL_MESSAGE` and a caller holding the pattern would compose
 * its own sentence. The seat surface (`./seat.ts`, #495) is the second caller
 * and AS-010 forbids it a second copy — which it had, byte-identical, until the
 * review of #495 found it.
 *
 * Deliberately permissive: the real test of an address is whether the
 * invitation arrives, and a stricter pattern only ever refuses somebody's
 * legitimate mailbox.
 */
export function isInvitableEmailAddress(email: string): boolean {
  return EMAIL_RE.test(email);
}

/**
 * The ONE refusal an admin ever reads about an address they typed — whatever
 * the actual reason was.
 *
 * ----------------------------------------------------------------------------
 * The history, because the rule inverted twice, and then collapsed
 * ----------------------------------------------------------------------------
 *
 * RULED 2026-08-04 (#23): an invitation nobody can answer is not sent. At that
 * point the only place an invitation could be answered was `/register` — the
 * link creates the organization and redeems the invitation in one request — and
 * somebody who already has an account cannot register again. So EVERY existing
 * account was refused, with one message, and a targeted invitation would have
 * sat `pending` for 30 days with no surface anywhere to answer it.
 *
 * #304 REMOVES THAT PREMISE, which is the condition the ruling itself named: the
 * planter's association area (`/settings/association`) and the dashboard
 * reminder are now the in-product place an existing account answers from. So the
 * targeted path is restored — the address is looked up, the account is mapped to
 * its organization, and the id becomes the invitation's target.
 *
 * ----------------------------------------------------------------------------
 * ONE MESSAGE FOR EVERY REFUSAL — RULED 2026-08-09 (#304, ruling 2)
 * ----------------------------------------------------------------------------
 *
 * Restoring the targeted path re-opened an enumeration oracle: an authenticated
 * admin could type any address and read back which of four things was true of
 * the person behind it — no account (an open invitation is created), an account
 * we cannot invite, a plant whose oversight slot ANOTHER org holds, or one that
 * is already ours. Three of those are facts about somebody else's tenancy, and
 * the probe costs nothing but a form submission.
 *
 * So every refusal on an EMAIL-RESOLVED target — which is every target in the
 * product, because the admin only ever types an address and the server resolves
 * it (`resolveInvitationTarget`, "WHY THERE IS NO PICKER") — is this constant
 * and nothing else. `assertTargetSlotFree` no longer has a message of its own;
 * `slotRefusalMessage` below is the whole of its vocabulary.
 *
 * WHAT AN ADMIN LOSES, and why it is acceptable: they are no longer told that
 * the plant they aimed at already belongs to somebody, or to them. Their OWN
 * org's state is still legible in the two places that hold it — the pending
 * invitations list on `/oversight/invitations` and the plants directory — and
 * neither of those names anything outside their own tenancy.
 *
 * The wording therefore has to be true of all of them at once: it names no
 * role, no organization and no relationship, and it points at the two lists
 * that answer "is this already handled?" without asking the server about a
 * stranger.
 */
export const ACCOUNT_NOT_INVITABLE_MESSAGE =
  "We cannot invite that email address — check your plants and pending invitations, or invite the planter's own address, or one that has not signed up yet";

/**
 * The fields that decide WHAT association an accept makes: the target entity and
 * the org it is being bound to. Shared by `associationStatement` (the write) and
 * `unboundTargetSlot` (the guard on the claim batched with it), so the two can
 * never be built from different premises.
 */
export type AssociationFacts = Pick<
  OrganizationInvitation,
  | "type"
  | "targetChurchId"
  | "targetSendingChurchId"
  | "sendingChurchId"
  | "sendingNetworkId"
>;

/**
 * The row to insert, fully resolved. No expiry field: the window is
 * `INVITATION_EXPIRY_DAYS` and `insertInvitation` applies it, so there is no
 * value for a client to influence and no call site that could pass one on.
 */
export interface ResolvedInvitation {
  type: OrganizationInvitationType;
  inviterUserId: string;
  inviteeEmail: string;
  targetChurchId: string | null;
  targetSendingChurchId: string | null;
  sendingChurchId: string | null;
  sendingNetworkId: string | null;
}

export type ResolveResult =
  | { ok: true; values: ResolvedInvitation }
  | { ok: false; error: string };

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** True for a well-formed uuid. Anything else is a client that guessed. */
export function isUuid(value: unknown): value is string {
  return typeof value === "string" && UUID_RE.test(value);
}

/**
 * Decide what invitation the actor is allowed to issue. Pure — no database —
 * so the authority rules are unit-testable.
 *
 * Only an oversight tenancy invites, and only ON BEHALF OF ITS OWN ORG:
 * - a sending-church tenancy → invites a church plant into THEIR sending church
 * - a network tenancy        → invites a church plant, or a sending church,
 *                              into THEIR network
 *
 * The inviting org therefore comes from the session and the `type` follows from
 * the tenancy plus WHAT is being invited. At most one target may be named, and an
 * invitation with NO target is legitimate: the invitee has no account yet, so
 * there is no row to point at until they register (`bindOpenInvitationTarget`).
 * The `type` of such an "open" invitation comes from `inviteAs`, which is why a
 * network admin has to say which kind of org they are inviting and a sending
 * church admin does not.
 */
export function resolveInvitationRequest(
  actor: InvitationActor,
  request: InvitationRequest
): ResolveResult {
  const targetChurchId = request.targetChurchId ?? null;
  const targetSendingChurchId = request.targetSendingChurchId ?? null;
  const inviteeEmail = normalizeInviteeEmail(request.inviteeEmail);

  if (!EMAIL_RE.test(inviteeEmail)) {
    return { ok: false, error: INVALID_EMAIL_MESSAGE };
  }
  if (targetChurchId && targetSendingChurchId) {
    return { ok: false, error: "Invite one organization at a time" };
  }
  if (targetChurchId && !isUuid(targetChurchId)) {
    return { ok: false, error: "That is not a church we can invite" };
  }
  if (targetSendingChurchId && !isUuid(targetSendingChurchId)) {
    return { ok: false, error: "That is not a sending church we can invite" };
  }

  // What is being invited: whatever the resolved target IS, or — with no target
  // yet — whatever the admin said they were inviting.
  const kind: InvitationTargetKind = targetSendingChurchId
    ? "sending_church"
    : targetChurchId
      ? "church"
      : (request.inviteAs ?? "church");

  const base = {
    inviterUserId: actor.id,
    inviteeEmail,
    targetChurchId,
    targetSendingChurchId,
  };

  // THE SEAT HALF IS THE ROLE ALLOWLIST, MIGRATED — not #498's new enforcement.
  // `sending_church_admin` and `network_admin` each meant "the Owner seat in
  // this kind of org", so a seatless org row and an org Member were already
  // refused here. `isOrgOwner` asks for both halves; #498 decides only whether
  // `admin` joins `owner`, not whether the arm looks at the seat at all.
  const actorOrg = isOrgOwner(actor) ? oversightOrgOf(actor) : null;

  if (actorOrg?.type === "sending_church") {
    if (kind === "sending_church") {
      return {
        ok: false,
        error: "A sending church can only invite church plants",
      };
    }
    return {
      ok: true,
      values: {
        ...base,
        type: "church_to_sending_church",
        sendingChurchId: actor.sendingChurchId,
        sendingNetworkId: null,
      },
    };
  }

  if (actorOrg?.type === "network") {
    return {
      ok: true,
      values: {
        ...base,
        type:
          kind === "sending_church"
            ? "sending_church_to_network"
            : "church_to_network",
        sendingChurchId: null,
        sendingNetworkId: actor.sendingNetworkId,
      },
    };
  }

  return {
    ok: false,
    error: "Only a sending church or network admin can invite an organization",
  };
}

/**
 * The SECOND pass of `resolveInvitationRequest` — the one that runs after the
 * typed address has been resolved to a target — with its refusals collapsed.
 * Pure, so the property the ruling demands is executable without a database.
 *
 * WHY THIS EXISTS — RULED 2026-08-09 (#304, ruling 2). A refusal produced on a
 * SERVER-RESOLVED target is a statement about the stranger behind the probed
 * address, not about the actor, and so it must speak with the one voice
 * (`ACCOUNT_NOT_INVITABLE_MESSAGE`). Left legible, this call reopened the exact
 * oracle the ruling closed: a `sending_church_admin` who typed an address
 * belonging to ANOTHER sending church admin read back "A sending church can
 * only invite church plants" — a third outcome, distinguishable from both
 * success and the one message, that says "that address is a sending-church
 * admin who has an organization".
 *
 * The collapse is HERE and not inside `resolveInvitationRequest`, because that
 * function is also run on the target-less AUTHORITY pass in
 * `createInvitationAs` — which happens BEFORE any address is looked up, whose
 * messages describe the actor's own role and org ("Set up your sending church
 * first"), and which therefore leaks nothing and must stay legible.
 *
 * The condition is on whether a target was actually resolved, not on which
 * branch refused: it is the *reachability after resolution* that makes a
 * message an oracle, so a rule added to `resolveInvitationRequest` later is
 * collapsed by construction rather than needing to be found.
 *
 * ----------------------------------------------------------------------------
 * THE REQUEST IS BUILT FROM SCRATCH — #304 ruling 4, fix 1 (HR4 2026-08-09)
 * ----------------------------------------------------------------------------
 *
 * This used to compose `{ ...request, ...target }`, and a spread is not a
 * filter. `target` is `{}` for an address nobody has registered, and an object
 * spread contributes no keys at all in that case — so a caller-supplied
 * `targetChurchId` survived untouched and became the invitation's target. That
 * is a FORGED TARGET: `createInvitation` is a `"use server"` endpoint whose
 * parameter is a typed object, `InvitationRequest` declares both target keys
 * (they are the channel `resolveInvitationTarget` writes on), and TypeScript
 * erases at runtime. A POST naming any plant's uuid with an unregistered
 * address enrolled that plant into the caller's org the moment its planter
 * pressed Accept. `target.targetChurchId ?? request.targetChurchId` would not
 * have closed it either, and neither does a partial spread — the only shape
 * with no hole is naming every key from the SERVER-RESOLVED value.
 *
 * So the object below is constructed key by key: the two target keys come from
 * `target` and from nowhere else, and the two request keys are the only things
 * a client is ever allowed to say (`InvitationRequest`). A key added to that
 * type later is not silently forwarded — it has to be written in here, which is
 * the point.
 *
 * `createInvitationAs` ALSO strips them at its call site, so the hole is closed
 * twice: defence in depth, because this function is exported and a future
 * caller may not read this comment.
 */
export function resolveInvitationForResolvedTarget(
  actor: InvitationActor,
  request: InvitationRequest,
  target: InviteeTarget
): ResolveResult {
  const targeted =
    target.targetChurchId != null || target.targetSendingChurchId != null;

  const resolved = resolveInvitationRequest(actor, {
    inviteeEmail: request.inviteeEmail,
    inviteAs: request.inviteAs,
    targetChurchId: target.targetChurchId,
    targetSendingChurchId: target.targetSendingChurchId,
  });
  if (resolved.ok || !targeted) return resolved;

  return { ok: false, error: ACCOUNT_NOT_INVITABLE_MESSAGE };
}

/**
 * Insert a resolved invitation. No authority check of its own — it writes
 * exactly what it is given, so every caller must have gone through
 * `resolveInvitationRequest` (the action layer) or be deliberately building an
 * odd row for a test harness.
 *
 * The expiry is applied HERE, from `INVITATION_EXPIRY_DAYS`, and is not part of
 * `values` — so there is exactly one place the window is decided and no
 * parameter for a caller (or a client, one layer up) to name it in.
 */
export async function insertInvitation(
  values: ResolvedInvitation
): Promise<OrganizationInvitation> {
  const expiresAt = new Date(
    Date.now() + INVITATION_EXPIRY_DAYS * 24 * 60 * 60 * 1000
  );

  const row: NewOrganizationInvitation = {
    type: values.type,
    inviterUserId: values.inviterUserId,
    inviteeEmail: values.inviteeEmail,
    targetChurchId: values.targetChurchId,
    targetSendingChurchId: values.targetSendingChurchId,
    sendingChurchId: values.sendingChurchId,
    sendingNetworkId: values.sendingNetworkId,
    status: "pending",
    expiresAt,
  };

  const [invitation] = await db
    .insert(organizationInvitations)
    .values(row)
    .returning();

  return invitation;
}

/**
 * WHAT ORGANIZATION does an existing account speak for? `undefined` for an
 * address nobody has registered (the open-invitation path), a target for an
 * account we can invite, and a user-facing message for one we cannot.
 *
 * Pure, so the whole rule is executable without a database (#304 restores the
 * targeted path; see `ACCOUNT_NOT_INVITABLE_MESSAGE` for the history):
 *
 *   * `planter` WITH a `church_id`  → their plant is the target.
 *   * `sending_church_admin` WITH a `sending_church_id` → their sending church.
 *   * everything else — a team member, a coach, a network admin, and a planter
 *     who has not created their plant yet — is refused, with ONE message.
 *
 * Only these two roles map to something an oversight org can associate with, and
 * the mapping is the account's OWN organization: there is no parameter here a
 * caller could aim at somebody else's church, and `resolveInvitationRequest`
 * still decides independently whether the actor may invite that KIND of org at
 * all (a sending church admin inviting a sending church is refused there).
 */
export type InviteeTarget = Pick<
  InvitationRequest,
  "targetChurchId" | "targetSendingChurchId"
>;

export function inviteeAccountTarget(
  existingAccount: SeatFields | undefined
): { ok: true; target: InviteeTarget } | { ok: false; error: string } {
  // Nobody here yet — an open invitation, redeemed by registering.
  if (!existingAccount) return { ok: true, target: {} };

  // THE TWO ARMS ARE THE TWO OLD ROLES, EXACTLY — BOTH HALVES, BOTH ARMS.
  // `planter` was a plant tenancy plus the Owner seat and
  // `sending_church_admin` was a sending-church tenancy plus the Owner seat, so
  // neither arm may ask the tenancy alone: no role mapped to a seatless org row
  // or to an org Member, and admitting one here would WIDEN who an org can
  // address rather than migrate the rule. An Admin or a Member of either kind
  // gets the stranger's answer, by the positional rule this whole path lives
  // by. #498 decides only whether `admin` joins `owner`.
  if (isPlantOwner(existingAccount) && existingAccount.churchId) {
    return { ok: true, target: { targetChurchId: existingAccount.churchId } };
  }

  const org = isOrgOwner(existingAccount)
    ? oversightOrgOf(existingAccount)
    : null;

  if (org?.type === "sending_church") {
    return { ok: true, target: { targetSendingChurchId: org.id } };
  }

  return { ok: false, error: ACCOUNT_NOT_INVITABLE_MESSAGE };
}

/**
 * Turn the one thing the admin typed — an email — into a target row, if there
 * is one.
 *
 * WHY THERE IS NO PICKER. An oversight admin sees only the plants their org is
 * associated with (`getAccessibleChurchIds`), and a dropdown of "church plants
 * you could invite" would have to list every plant in the product to every org
 * — a directory leak dressed as a form field. So the admin addresses an email,
 * and the server decides privately whether that address already belongs to an
 * organization.
 *
 * Three outcomes since #304 restored the targeted path:
 *   * no account at all → an OPEN invitation with no target. The invite link
 *     carries the token to `/register`, where the organization is created and
 *     bound in one go (`bindOpenInvitationTarget`);
 *   * an account that speaks for an organization → that organization is the
 *     target, and the invitee answers from `/settings/association`;
 *   * any other account → refused with `ACCOUNT_NOT_INVITABLE_MESSAGE`.
 *
 * The projection is exactly the columns `inviteeAccountTarget` reads — the
 * seat, and the three tenancy FKs the seat has to be read against.
 * Answering "which org is this" must not pull `password_hash` into application
 * memory — the same reasoning as `accessColumns` in
 * `@/lib/notifications/enqueue`.
 *
 * The refusal lives HERE rather than in the form: this is the path a forged
 * direct call to `createInvitation` takes too (`createInvitationAs` below), so
 * skipping the UI does not skip the rule.
 */
export async function resolveInvitationTarget(
  inviteeEmail: string
): Promise<{ ok: true; target: InviteeTarget } | { ok: false; error: string }> {
  const [existing] = await db
    .select({
      seat: users.seat,
      churchId: users.churchId,
      sendingChurchId: users.sendingChurchId,
      sendingNetworkId: users.sendingNetworkId,
    })
    .from(users)
    .where(eq(users.email, inviteeEmail))
    .limit(1);

  return inviteeAccountTarget(existing);
}

/**
 * The occupied-slot refusal, RULED 2026-08-03 (#23), with its message collapsed
 * RULED 2026-08-09 (#304, ruling 2) — see `ACCOUNT_NOT_INVITABLE_MESSAGE`.
 *
 * Reads the target's own oversight FK and refuses when it is held. `null`
 * targets (an open invitation) have nothing to check: the organization does not
 * exist yet, and the accept path's guard covers it when it does.
 *
 * This is NOT the concurrency boundary and does not pretend to be one — a
 * SELECT-then-INSERT guard never is (`memory/invariants.md`). Two admins racing
 * still both get an invitation created; what stops BOTH being honoured is
 * `unboundTargetSlot` + `lockTargetRow` at accept time, which is untouched. The
 * value of this check is that the admin is stopped NOW, in the form, instead of
 * the invitee discovering it when they try to accept.
 *
 * It refuses with the SAME sentence `resolveInvitationTarget` uses, so "the
 * account cannot be invited", "the slot is another org's" and "the slot is
 * already ours" are one outcome as far as the client can tell. The verdict
 * itself stays three-valued — that is what is true of the row, and collapsing
 * the FACT rather than the MESSAGE would make the next reader think the
 * distinction was never there — but nothing derived from it reaches the
 * response.
 */
export async function assertTargetSlotFree(
  values: ResolvedInvitation
): Promise<void> {
  const held = await heldOversightSlot(values);
  const refusal = slotRefusalMessage(held);
  if (!refusal) return;
  throw new InvitationError(refusal);
}

/**
 * The verdict → what the admin reads. Pure and total, so the collapse is
 * executable rather than a claim about a branch: EVERY non-free verdict maps to
 * the one message, and a test can enumerate the whole domain.
 */
export function slotRefusalMessage(
  held: "ours" | "other" | null
): string | null {
  return held === null ? null : ACCOUNT_NOT_INVITABLE_MESSAGE;
}

/** `"ours"` / `"other"` when the target's slot is taken, `null` when it is free. */
async function heldOversightSlot(
  values: ResolvedInvitation
): Promise<"ours" | "other" | null> {
  const verdict = (held: string | null, ours: string | null) =>
    !held ? null : held === ours ? ("ours" as const) : ("other" as const);

  switch (values.type) {
    case "church_to_sending_church":
    case "church_to_network": {
      if (!values.targetChurchId) return null;
      const [plant] = await db
        .select({
          sendingChurchId: churches.sendingChurchId,
          sendingNetworkId: churches.sendingNetworkId,
        })
        .from(churches)
        .where(eq(churches.id, values.targetChurchId))
        .limit(1);
      if (!plant) return null;
      return values.type === "church_to_sending_church"
        ? verdict(plant.sendingChurchId, values.sendingChurchId)
        : verdict(plant.sendingNetworkId, values.sendingNetworkId);
    }

    case "sending_church_to_network": {
      if (!values.targetSendingChurchId) return null;
      const [org] = await db
        .select({ sendingNetworkId: sendingChurches.sendingNetworkId })
        .from(sendingChurches)
        .where(eq(sendingChurches.id, values.targetSendingChurchId))
        .limit(1);
      if (!org) return null;
      return verdict(org.sendingNetworkId, values.sendingNetworkId);
    }

    default: {
      // Fail CLOSED, like every other switch on `type` in this file.
      const unknownType: never = values.type;
      console.error("invitation type has no slot rule", { type: unknownType });
      throw new InvitationError(NOT_AUTHORIZED_MESSAGE);
    }
  }
}

/**
 * "Aimed at THIS organization", whatever address named it — `null` when the
 * invitation has no target at all (the open path).
 *
 * WHY IT EXISTS — #304 ruling 4, fix 4 (HR4 2026-08-09). Both create-time caps
 * counted rows by `invitee_email`, and an ADDRESS is not the thing being
 * protected. The banner OV-005 puts on a screen belongs to an ORGANIZATION, and
 * an organization can have several accounts that resolve to it — every
 * `sending_church_admin` of one sending church maps to that sending church, and
 * a plant may carry more than one `planter`. So an org that had exhausted its
 * three attempts at `admin1@…` simply typed `admin2@…` and had a fresh
 * allowance against the same target, and `assertNoDuplicatePending` never saw
 * the standing invitation either. Counting the resolved TARGET as well as the
 * address is what makes both caps count the thing they defend.
 */
export function targetReachFilter(
  values: Pick<ResolvedInvitation, "targetChurchId" | "targetSendingChurchId">
): SQL | null {
  if (values.targetChurchId) {
    return eq(organizationInvitations.targetChurchId, values.targetChurchId);
  }
  if (values.targetSendingChurchId) {
    return eq(
      organizationInvitations.targetSendingChurchId,
      values.targetSendingChurchId
    );
  }
  return null;
}

/**
 * THE CAP RESETS AFTER A SEVER (#304 round 10, RULED 2026-08-11).
 *
 * Both count queries carry this, and it is one predicate rather than two so the
 * address scope and the target scope cannot drift into two definitions of "does
 * this invitation still count".
 *
 * WHY. The cap counts EVERY status, which is what defeats a decline–reinvite
 * loop — and the same blindness made the three severs this track ships spend
 * the allowance. A plant that joined and left inside the 30-day window burned
 * the org's three attempts on invitations it had ANSWERED, and the org that
 * `remove-plant-dialog.tsx` promises "you can invite them back later" could
 * not: the 4th was refused by a message asserting a pending answer while
 * nothing was pending. A cap defending "an org cannot keep a banner up" must
 * not also punish an association that ran its full course.
 *
 * WHAT IT SAYS, per row: this invitation counts unless the org has an
 * `association_events` row about ITS OWN subject that is NEWER than the
 * invitation. The most recent event for the (org, subject) pair is therefore
 * the floor, and a join-then-leave cycle refunds exactly the invitations it
 * answered — never a decline, which writes no event at all.
 *
 * THE SUBJECT IS MATCHED BY FK, not by `subject_type`: the exactly-one CHECK on
 * `association_events` makes a non-null `church_id` mean `subject_type =
 * 'church'` and a non-null `subject_sending_church_id` mean `'sending_church'`,
 * so comparing the invitation's own target column to the matching subject
 * column is the discriminator. An OPEN invitation names no target, matches no
 * event, and so always counts — it has no association to have severed.
 *
 * The ORG side is the caller's own, and it is compared as the discriminated
 * pair the audit table stores (`org_type` + `org_id`, no FK). An org with
 * neither id — impossible for a row `resolveInvitationRequest` produced —
 * matches no event and every invitation counts, which is the fail-CLOSED
 * direction for a cap.
 */
export function afterTheLastAssociationEventFilter(
  values: Pick<ResolvedInvitation, "sendingChurchId" | "sendingNetworkId">
): SQL {
  const org = values.sendingChurchId
    ? and(
        eq(associationEvents.orgType, "sending_church"),
        eq(associationEvents.orgId, values.sendingChurchId)
      )
    : values.sendingNetworkId
      ? and(
          eq(associationEvents.orgType, "network"),
          eq(associationEvents.orgId, values.sendingNetworkId)
        )
      : sql`false`;

  return notExists(
    db
      .select({ one: sql`1` })
      .from(associationEvents)
      .where(
        and(
          org,
          or(
            eq(
              associationEvents.churchId,
              organizationInvitations.targetChurchId
            ),
            eq(
              associationEvents.subjectSendingChurchId,
              organizationInvitations.targetSendingChurchId
            )
          ),
          gt(associationEvents.createdAt, organizationInvitations.createdAt)
        )
      )
  );
}

/**
 * Refuse a second pending invitation from the SAME org to the same address, or
 * — since #304 ruling 4 — to the same resolved TARGET under any address.
 *
 * Not a concurrency guard (invariants.md) — a duplicate is a nuisance, not a
 * correctness problem, and both would still be refused at accept time by the
 * slot rule. It exists so the list stays readable.
 *
 * TWO SCOPES, TWO MESSAGES, and the split is the oracle rule rather than a
 * style choice. The ADDRESS scope describes the actor's own org state about an
 * address the actor itself typed — a pending invitation their own list already
 * shows them — so it stays legible. The TARGET scope can only fire on a
 * DIFFERENT address that resolved to the same organization, and saying so would
 * tell the admin that two addresses they typed belong to one org: a fact about
 * somebody else's tenancy, which is exactly what ruling 2 collapsed. It refuses
 * with the one message (`ACCOUNT_NOT_INVITABLE_MESSAGE`).
 */
async function assertNoDuplicatePending(
  values: ResolvedInvitation
): Promise<void> {
  const ourPending = and(
    eq(organizationInvitations.status, "pending"),
    invitingOrgFilter(values.sendingChurchId, values.sendingNetworkId)
  );

  const [duplicateAddress] = await db
    .select({ id: organizationInvitations.id })
    .from(organizationInvitations)
    .where(
      and(
        ourPending,
        eq(organizationInvitations.inviteeEmail, values.inviteeEmail)
      )
    )
    .limit(1);

  if (duplicateAddress) {
    throw new InvitationError(
      "There is already a pending invitation to that address — revoke it first"
    );
  }

  const reach = targetReachFilter(values);
  if (!reach) return;

  const [duplicateTarget] = await db
    .select({ id: organizationInvitations.id })
    .from(organizationInvitations)
    .where(and(ourPending, reach))
    .limit(1);

  if (duplicateTarget) {
    throw new InvitationError(ACCOUNT_NOT_INVITABLE_MESSAGE);
  }
}

/**
 * What an admin reads when their org has used up its attempts at one address.
 *
 * It names the org's OWN behaviour and nothing else — how many invitations THEY
 * sent, to an address THEY typed — so it is legible without being an oracle
 * (see `assertInviteRateLimit` for why position, not wording, is what makes that
 * true here).
 *
 * "Wait for an answer" is TRUE of every state that can now reach it (round 10).
 * The rows this message counts are all unanswered-or-refused ones: an accepted
 * association that was later severed no longer counts at all, because
 * `afterTheLastAssociationEventFilter` drops every invitation older than the
 * sever. Widen the count again and this sentence has to be re-checked with it.
 */
export const INVITE_RATE_LIMITED_MESSAGE =
  "Your organization has already sent that address several invitations recently — wait for an answer, or reach them another way";

/**
 * The statement behind the cap. Exported so a test can read its bound
 * parameters: the scope is the ORG's own rows and the window is the SERVER's
 * instant, neither of which a request can influence.
 *
 * No `status` predicate on purpose. The abuse this exists to stop is a
 * decline–reinvite loop, and every one of those rows reads `declined`; counting
 * only pending ones would count exactly the invitations that are not the
 * problem. `limit` is the cap itself — the question is "are there at least N?",
 * so there is no reason to read the whole history.
 *
 * TWO FLOORS, not one (#304 round 10). The window is the older of them; the
 * newer is `afterTheLastAssociationEventFilter`, which drops every invitation
 * this org sent BEFORE its most recent association event about the same
 * subject. Counting every status and never forgiving a completed association is
 * what locked an org out of re-inviting a plant it had legitimately parted
 * with.
 */
export function invitesFromOrgToAddressQuery(
  values: Pick<
    ResolvedInvitation,
    "inviteeEmail" | "sendingChurchId" | "sendingNetworkId"
  >,
  since: Date
) {
  return db
    .select({ id: organizationInvitations.id })
    .from(organizationInvitations)
    .where(
      and(
        eq(organizationInvitations.inviteeEmail, values.inviteeEmail),
        invitingOrgFilter(values.sendingChurchId, values.sendingNetworkId),
        gte(organizationInvitations.createdAt, since),
        afterTheLastAssociationEventFilter(values)
      )
    )
    .limit(INVITES_PER_INVITEE_PER_WINDOW);
}

/**
 * The same cap, counted against the resolved TARGET instead of the address
 * (#304 ruling 4, fix 4). Exported for the same reason as the address query:
 * a test reads its bound parameters rather than trusting the prose.
 *
 * `reach` is the caller's, not this function's, so there is exactly one place
 * that decides what "aimed at this org" means (`targetReachFilter`) and no way
 * for the cap and the duplicate check to drift into two definitions of it.
 *
 * It carries the SAME post-sever floor as the address query (#304 round 10) and
 * from the same function, for the same reason: two copies of "does this
 * invitation still count" is how the two scopes start answering differently for
 * one org.
 */
export function invitesFromOrgToTargetQuery(
  values: Pick<ResolvedInvitation, "sendingChurchId" | "sendingNetworkId">,
  reach: SQL,
  since: Date
) {
  return db
    .select({ id: organizationInvitations.id })
    .from(organizationInvitations)
    .where(
      and(
        reach,
        invitingOrgFilter(values.sendingChurchId, values.sendingNetworkId),
        gte(organizationInvitations.createdAt, since),
        afterTheLastAssociationEventFilter(values)
      )
    )
    .limit(INVITES_PER_INVITEE_PER_WINDOW);
}

/**
 * Refuse an org that has already addressed this ADDRESS
 * `INVITES_PER_INVITEE_PER_WINDOW` times inside the window (#304, HR4).
 *
 * PRE-RESOLUTION ONLY. Its target-scoped twin is `assertTargetInviteRateLimit`
 * below, and they are two functions rather than one on purpose (ruling 5,
 * 2026-08-10): this is the only one that can compose the legible message, so
 * keeping it out of the post-resolution call is a fact about the call graph
 * instead of a comment asking the next reader to preserve an ordering. Its
 * parameter is narrowed to the three fields it reads for the same reason — a
 * `ResolvedInvitation` here would invite somebody to pass the resolved values.
 *
 * WHERE IT RUNS IS THE SECURITY PROPERTY, not the wording. Every refusal
 * reachable AFTER `resolveInvitationTarget` has to be the one message
 * (`ACCOUNT_NOT_INVITABLE_MESSAGE`) because it would otherwise describe a
 * stranger. This one is deliberately placed BEFORE the address is looked up, so
 * it cannot be that kind of refusal by construction: it reads only rows the
 * caller's own org wrote, to an address the caller itself typed, and it answers
 * identically whether or not an account exists behind it.
 *
 * That ordering also closes the obvious variant of the same oracle. A cap that
 * applied only to the TARGETED path would itself be a probe — "this address is
 * rate-limited, therefore somebody has an account here" — so the cap applies to
 * every invitation the org addresses, open ones included.
 *
 * Like `assertNoDuplicatePending` this is SELECT-then-INSERT and therefore not a
 * concurrency guard (`memory/invariants.md`): two simultaneous submissions can
 * both pass the fourth attempt. That is acceptable — the property being defended
 * is "an org cannot keep a banner up indefinitely", which one extra row does not
 * threaten, and the alternative is a counter table for a nuisance control.
 */
export async function assertInviteRateLimit(
  values: Pick<
    ResolvedInvitation,
    "inviteeEmail" | "sendingChurchId" | "sendingNetworkId"
  >,
  now = new Date()
): Promise<void> {
  const recent = await invitesFromOrgToAddressQuery(
    values,
    rateLimitWindowStart(now)
  );

  if (recent.length >= INVITES_PER_INVITEE_PER_WINDOW) {
    throw new InvitationError(INVITE_RATE_LIMITED_MESSAGE);
  }
}

/**
 * The window every invitation cap counts inside — the SERVER's instant, never a
 * request's.
 *
 * Exported since #495: the seat cap counts over the same window by the same
 * ruling, and it had its own copy of this arithmetic until the review found it.
 */
export function rateLimitWindowStart(now: Date): Date {
  return new Date(now.getTime() - INVITATION_EXPIRY_DAYS * 24 * 60 * 60 * 1000);
}

/**
 * THE SECOND SCOPE — the same cap, counted against the resolved TARGET (#304
 * ruling 4 fix 4; split out of `assertInviteRateLimit` by ruling 5,
 * 2026-08-10).
 *
 * IT IS A SEPARATE FUNCTION BECAUSE THE TWO PASSES SPEAK DIFFERENTLY, and the
 * difference is positional. `assertInviteRateLimit` runs BEFORE
 * `resolveInvitationTarget` and may therefore be legible: it reads only rows the
 * caller's own org wrote, to an address the caller itself typed. This one runs
 * AFTER, where every refusal has to be the ONE message
 * (`ACCOUNT_NOT_INVITABLE_MESSAGE`) — a target-scoped refusal fires on an
 * address the org has NOT exhausted, so naming the cap would say "this address
 * and one you already used belong to the same organization" (ruling 2,
 * `memory/invariants.md` → Multi-Tenancy).
 *
 * While they were one function the post-resolution call re-ran the ADDRESS pass
 * first, which could throw `INVITE_RATE_LIMITED_MESSAGE` from a post-resolution
 * position — the legible message on the collapsed path, reachable whenever a row
 * landed between the two calls. Nothing about the wording changed to fix that;
 * the pass that composes the legible message simply no longer runs down there,
 * which is a property of the CALL GRAPH and not of anybody remembering an
 * ordering rule.
 *
 * An org with no reach filter — a target that resolved to nothing addressable —
 * is not capped here at all. It was already capped by address, above.
 */
export async function assertTargetInviteRateLimit(
  values: ResolvedInvitation,
  now = new Date()
): Promise<void> {
  const reach = targetReachFilter(values);
  if (!reach) return;

  const recentToTarget = await invitesFromOrgToTargetQuery(
    values,
    reach,
    rateLimitWindowStart(now)
  );

  if (recentToTarget.length >= INVITES_PER_INVITEE_PER_WINDOW) {
    throw new InvitationError(ACCOUNT_NOT_INVITABLE_MESSAGE);
  }
}

/**
 * What a create produces: the row, and whether the invitee was actually told.
 *
 * The two are reported separately because they FAIL separately (OV-003b / #293).
 * The row is durable and the email is best-effort, so `emailSent: false` is not
 * an error — it is the case where the invitee has not been told yet, and the
 * surface says exactly that instead of claiming an invitation was "sent" when
 * nothing left the building. The recovery is **Resend email** on the row, not a
 * link the admin forwards: #304 ruling 4 item 5 removed the admin's copy of the
 * `/register?invitation=` URL from this whole page, and #293 is the delivery it
 * was a stopgap for (`./create-notice`).
 */
export interface CreatedInvitation {
  invitation: OrganizationInvitation;
  /** Did the provider accept the invitation email? See `./email`. */
  emailSent: boolean;
}

/** Resolve + guard + insert + send. The path the action layer takes. */
export async function createInvitationAs(
  actor: InvitationActor,
  request: InvitationRequest
): Promise<CreatedInvitation> {
  const inviteeEmail = normalizeInviteeEmail(request.inviteeEmail);
  const inviteAs = request.inviteAs ?? "church";

  // AUTHORITY FIRST, and specifically before the address is looked up. The
  // lookup below reads `users` and its refusals distinguish "no such account"
  // from "a planter with no church" from "cannot be invited" — which is an
  // account-enumeration oracle for anyone who may not invite at all. So the
  // role, the actor's own org and the kind are settled against a target-less
  // request, exactly the same pure rules, before a single row is read.
  const authority = resolveInvitationRequest(actor, {
    inviteeEmail,
    inviteAs,
  });
  if (!authority.ok) {
    throw new InvitationError(authority.error);
  }

  // THE CAP, and it runs HERE — before the lookup — on purpose (#304, HR4
  // 2026-08-09). A targeted invitation puts a banner on a planter's dashboard
  // that OV-005 makes dismissible only by answering, so an org that could
  // re-issue after every decline would own a permanent, attacker-chosen slot on
  // a stranger's screen. Placing the cap ahead of `resolveInvitationTarget`
  // keeps it out of the post-resolution rule (`ACCOUNT_NOT_INVITABLE_MESSAGE`):
  // it reads only the caller's own org's rows and answers the same whether or
  // not an account exists behind the address, so it discloses nothing to probe.
  await assertInviteRateLimit(authority.values);

  // A client never names a target; it is resolved from the address here. An
  // account that speaks for no invitable organization is refused with the one
  // message (RULED 2026-08-09, `ACCOUNT_NOT_INVITABLE_MESSAGE`). This runs
  // inside the logic layer, so a forged POST straight at `createInvitation` is
  // refused by the same statement the form is.
  const resolvedTarget = await resolveInvitationTarget(inviteeEmail);
  if (!resolvedTarget.ok) {
    throw new InvitationError(resolvedTarget.error);
  }

  // THE CALLER'S TARGET KEYS DO NOT TRAVEL (#304 ruling 4, fix 1 — defence in
  // depth). `request` is a typed object that arrived at a `"use server"`
  // endpoint, so at runtime it may carry anything, `targetChurchId` included —
  // and `InvitationRequest` declares that key because the SERVER writes on it.
  // The two fields below are the whole of what a client may say; the target
  // comes from `resolvedTarget`, which was derived from the address alone.
  // `resolveInvitationForResolvedTarget` rebuilds its request from scratch as
  // well, so a forged key is dropped twice on this path.
  const resolved = resolveInvitationForResolvedTarget(
    actor,
    { inviteeEmail, inviteAs },
    resolvedTarget.target
  );
  if (!resolved.ok) {
    throw new InvitationError(resolved.error);
  }

  // THE CAP AGAIN, now that there is a target to count (#304 ruling 4, fix 4) —
  // and it is a DIFFERENT function, which is the point (ruling 5, 2026-08-10).
  // The pass above ran on the address alone and owns the legible message; this
  // one adds the scope that actually matters — an ORG cannot be re-addressed
  // through a second one of its admins' accounts — and can only refuse with
  // `ACCOUNT_NOT_INVITABLE_MESSAGE`, because it contains no other. Calling the
  // combined function here re-ran the address pass from a post-resolution
  // position, where the legible message must not be reachable at all.
  await assertTargetInviteRateLimit(resolved.values);

  // Everything below is also post-resolution, and audited to the same rule:
  // `assertTargetSlotFree` composes no message of its own (`slotRefusalMessage`
  // is its whole vocabulary, and it is the one constant), and
  // `assertNoDuplicatePending` reports the ACTOR's own org state under the
  // address it typed — a pending invitation their own list already shows them —
  // while its TARGET scope speaks with the one message.
  await assertTargetSlotFree(resolved.values);
  await assertNoDuplicatePending(resolved.values);

  const invitation = await insertInvitation(resolved.values);

  // LAST, and deliberately after the committed row — an invitation that exists
  // but was not emailed is repaired by Resend email on its row; an email sent
  // for a row that failed to insert is a link to nothing. `emailInvitee` never
  // throws.
  return { invitation, emailSent: await emailInvitee(invitation) };
}

/**
 * Tell the invitee. Best-effort by construction, and the boundary that keeps it
 * that way is HERE: `sendInvitationEmail` swallows its own transport failures,
 * and this wrapper swallows the one thing it cannot — a failed org-name lookup,
 * which is a database read and can throw like any other.
 *
 * The name is derived from `type` (`lookupInvitingOrgName` below), not from
 * whichever FK column happens to be populated, for the same reason
 * `announceInvitationAcceptedForChurch` derives its audience that way: nothing
 * constrains a row to one FK, and an email that misnames who invited you is
 * indistinguishable from a phishing attempt.
 *
 * EXPORTED, and it takes seams. This is the one link in the chain between the
 * action and the well-tested send path, and it was the only untested one: every
 * rule in `./email.ts` is proven against `sendInvitationEmail` directly, which
 * says nothing about whether anything CALLS it, with what, or what a thrown
 * org-name lookup does to the create. Both seams default to the real thing, so
 * production has one code path; `./core-email.test.ts` replaces them.
 */
export async function emailInvitee(
  invitation: OrganizationInvitation,
  deps: EmailInviteeDeps = {}
): Promise<boolean> {
  return (await emailInviteeOutcome(invitation, deps)).sent;
}

export interface EmailInviteeDeps {
  /** The org-name read. A database query in production, and it can throw. */
  lookupOrgName?: (
    invitation: OrganizationInvitation
  ) => Promise<string | null>;
  /** Passed straight to `sendInvitationEmail`; see `InvitationEmailDeps`. */
  send?: InvitationEmailDeps["send"];
  /** Which send this is — create (the default) or a deliberate resend. */
  occasion?: InvitationSendOccasion;
}

/**
 * The same send, reporting WHY it did not happen.
 *
 * `emailInvitee` above is this function with the reason thrown away, because
 * the create path has nothing to do with it: a failed send there is reported to
 * the admin as one fact ("created — email could not be sent"), pointing at the
 * Resend email control on the row the create just added. The RESEND path is the
 * opposite — its entire product is the send, so the admin has to be told which
 * of "no longer pending" and "the provider refused it" happened, and those
 * words are derived from this reason code (`resendRefusalMessage`).
 *
 * Two shapes, ONE implementation, deliberately: a second call site that
 * re-decided any of the guards would be the duplicated decision this file keeps
 * hunting.
 */
export async function emailInviteeOutcome(
  invitation: OrganizationInvitation,
  deps: EmailInviteeDeps = {}
): Promise<InvitationEmailOutcome> {
  const lookupOrgName = deps.lookupOrgName ?? lookupInvitingOrgName;

  try {
    return await sendInvitationEmail(
      {
        invitationId: invitation.id,
        inviteeEmail: invitation.inviteeEmail,
        status: invitation.status,
        type: invitation.type,
        invitingOrgName: await lookupOrgName(invitation),
        expiresAt: invitation.expiresAt,
      },
      {
        ...(deps.send ? { send: deps.send } : {}),
        ...(deps.occasion ? { occasion: deps.occasion } : {}),
      }
    );
  } catch (error) {
    // No id, no address, no link: the invitation id is the register bearer
    // token (see `hasValidInvitationBypass`) and a log drain is not where it
    // belongs.
    console.error("invitation email could not be prepared", {
      type: invitation.type,
      message: redactForLog(error),
    });
    return { sent: false, reason: "preparation_threw" };
  }
}

// ============================================================================
// The org-scoped single-invitation read
// ============================================================================
//
// One query, shared by everything that acts on ONE invitation the actor's org
// issued. The resend path that used to live here moved to `./resend.ts` on
// 2026-08-12 (PR #392 warning (c)); this predicate did NOT go with it, because
// it is the same definition of "ours" the list and the revoke are built from
// and two copies of it are how a screen shows a row it would then refuse.
// ============================================================================

/**
 * `id = ? AND <the actor's own org issued it>` — the read behind a resend.
 *
 * Exported so a test can read the bound parameters, the same reason
 * `revokeInvitationQuery` and `invitationsForOrgQuery` are: the org in the WHERE
 * comes from the SESSION, and nothing a client sent can put another org's id
 * there.
 */
export function orgInvitationQuery(
  actor: InvitationActor,
  invitationId: string
) {
  return db
    .select()
    .from(organizationInvitations)
    .where(
      and(eq(organizationInvitations.id, invitationId), invitingOrgOf(actor))
    )
    .limit(1);
}

/**
 * The inviting organization's name, chosen by `type`. THE one implementation —
 * never a second copy under any name, the same rule `daysUntilTarget` carries
 * (memory/invariants.md → Hierarchical Access Control), because the copy is
 * always the one that misses the fix.
 *
 * It had one, briefly: `(auth)/register/beta-gate.ts` answered the same
 * question for the register screen with its own SQL against `sendingChurches`
 * / `sendingNetworks`, which was both an R2 duplicated decision and an app
 * route reaching into another domain's tables instead of through its exports.
 * The two had already diverged — that copy took `type: string` and fell
 * through to `null`, so a fourth `OrganizationInvitationType` would break the
 * build HERE (the `never` guard below) and silently return `null` THERE,
 * blanking the inviting org on the invitee's register screen. Both callers now
 * come through this function; `./org-name.test.ts` fails if the copy returns.
 *
 * Deriving the name from `type` rather than from whichever FK is populated is
 * the security-relevant half: `insertInvitation` performs no type↔id
 * consistency check, so a row can carry a stray id, and an email or a register
 * screen that misnames who invited you is indistinguishable from a phishing
 * attempt.
 *
 * The parameter is structural so the register path can pass the row it already
 * holds, but `type` is narrowed to `OrganizationInvitationType` — a widened
 * `type: string` is exactly what let the copy fall through, and the `never`
 * guard is the property that makes ONE implementation safe.
 */
export async function lookupInvitingOrgName(invitation: {
  type: OrganizationInvitationType;
  sendingChurchId: string | null;
  sendingNetworkId: string | null;
}): Promise<string | null> {
  switch (invitation.type) {
    case "church_to_sending_church": {
      if (!invitation.sendingChurchId) return null;
      const [org] = await db
        .select({ name: sendingChurches.name })
        .from(sendingChurches)
        .where(eq(sendingChurches.id, invitation.sendingChurchId))
        .limit(1);
      return org?.name ?? null;
    }

    case "church_to_network":
    case "sending_church_to_network": {
      if (!invitation.sendingNetworkId) return null;
      const [org] = await db
        .select({ name: sendingNetworks.name })
        .from(sendingNetworks)
        .where(eq(sendingNetworks.id, invitation.sendingNetworkId))
        .limit(1);
      return org?.name ?? null;
    }

    default: {
      // Fail CLOSED, like every other switch on `type` in this file: with no
      // name there is nothing honest to put in the email, and `./email` refuses
      // to render one.
      const unknownType: never = invitation.type;
      console.error("invitation type has no inviting org to name", {
        type: unknownType,
      });
      return null;
    }
  }
}

// ============================================================================
// Respond
// ============================================================================

/**
 * Accept an invitation: LOCK the target row, CLAIM the invitation, then bind the
 * association — three statements in ONE `db.batch`, in that order.
 *
 * ORDER AND ATOMICITY — memory/invariants.md → Transactions / Atomicity. Both
 * writes are known up front, so they belong in one Neon batched transaction.
 * The claim (`respondToInvitationQuery`, a compare-and-set on
 * `status = 'pending'`) is statement TWO, and the association's own WHERE
 * additionally requires the invitation to read `accepted` — a value only that
 * claim can have written, and one statement THREE can see because it runs inside
 * the same transaction. So:
 *
 *   * the claim wins → the EXISTS holds → both writes commit together;
 *   * the claim loses, because a revoke or a decline committed first → the row
 *     is not `accepted`, the EXISTS fails, the association writes NOTHING, and
 *     the empty `returning()` becomes the error below.
 *
 * The read in `loadRespondableInvitation` is NOT the guard — two concurrent
 * accepts both pass it (invariants.md: a SELECT-then-write guard is not a
 * concurrency guard). And `db.batch` alone would not have been the guard
 * either: an empty `returning()` is not a driver error and does not roll a
 * batch back, so with the association written FIRST a lost claim still left the
 * plant bound to an oversight org — inside `getAccessibleChurchIds`, listed by
 * `getOversightPlantHealth` — with no accepted invitation anywhere to explain
 * it and no product path to undo it. Statement order is what closes that.
 *
 * WHY THERE IS A ROW LOCK (statement ONE, `lockTargetRow`). The slot guard below
 * reads a DIFFERENT table from the one the claim updates, and a subquery reads a
 * snapshot — it takes no lock. So two accepts of DIFFERENT invitations for the
 * SAME free slot contend on nothing: the claims update two different rows of
 * `organization_invitations`, and both `EXISTS (… churches … fk IS NULL)`
 * subqueries were true when each was evaluated. Both claims commit `accepted`,
 * while Postgres' READ COMMITTED re-check on the second association's UPDATE
 * (the row changed under it) makes that statement match nothing — so the loser
 * committed an acceptance with no association behind it, and announced the
 * milestone for it. Reproduced 6/10 runs on the previous revision (#265, HR4
 * evidence 2026-08-03).
 *
 * `SELECT … FROM <target> WHERE id = ? FOR UPDATE`, as statement ONE of the
 * batch, is what serialises them: the second accept blocks until the first
 * COMMITS, and because each statement of a READ COMMITTED transaction takes a
 * fresh snapshot, its claim then evaluates the slot guard against the row the
 * winner wrote — sees the slot taken, matches nothing, and refuses with
 * `ALREADY_ASSOCIATED_MESSAGE`, having written nothing at all. The lock is on
 * the row the ASSOCIATION writes, which is the resource actually being competed
 * for; locking the invitation instead would not have helped, since the two
 * accepts are two different invitations.
 *
 * `scripts/g3-oversight-model.ts` §3d case H races accept-vs-accept on a real
 * database for exactly this.
 *
 * A SECOND ACCEPT NEVER REPLACES AN ASSOCIATION — ruled here, 2026-08-03
 * (#265; the sever rules are #274 / `product-docs/features/oversight/frd.md`
 * OV-007). Plant P accepted sending church A; nothing stops B's admin inviting
 * P as well (`createInvitation` checks no membership), and P's planter has
 * authority over that invitation too. Left alone, accepting it would have set
 * `churches.sending_church_id = B` and severed A silently: no type-to-confirm,
 * no notification to A, no `association_events` audit row — the three things
 * OV-007 requires of a sever — while A's invitation still read `accepted` and A
 * had already been sent the "invitation accepted" milestone.
 *
 * So BOTH statements additionally require the target's slot to be free or to
 * already hold this very org (`unboundTargetSlot` / `associationStatement`).
 * Re-binding to the same org stays the idempotent no-op it was; binding OVER a
 * different one matches no row in statement ONE, so the invitation stays
 * `pending`, nothing is written, and the refusal says which of the two things
 * went wrong (`ALREADY_ASSOCIATED_MESSAGE` vs "no longer pending" — a lost claim
 * and an occupied slot are different facts and must not read alike). The plant
 * severs A through the audited path (#277) and then accepts B, which is exactly
 * the order OV-007 wants. Guarding statement ONE is what makes this atomic: with
 * the guard on the association alone, a committed claim would have left the
 * invitation reading `accepted` with the plant still bound to A.
 *
 * Residual, accepted: a crash between the committed batch and the milestone
 * notification loses the notification, not the acceptance — the notification is
 * best-effort by construction. A retry of THAT accept re-runs the whole batch:
 * the claim now matches no row (the invitation already reads `accepted`), so the
 * retry is refused with "no longer pending" and the notification stays lost. It
 * is a lost notification, not a lost or duplicated acceptance.
 */
export async function acceptInvitationAs(
  actor: InvitationActor,
  invitationId: string
): Promise<OrganizationInvitation> {
  // Authority first, then status: see `loadRespondableInvitation`.
  const invitation = await loadRespondableInvitation(actor, invitationId);

  // All of them built BEFORE anything is written, so an invitation whose FKs
  // contradict its `type` throws instead of half-applying.
  //
  // THE ORDER OF THESE LINES IS LOAD-BEARING, and it is ASSERTED rather than
  // argued (ruled 2026-08-13 on PR #423, #411). The audit line REFUSES a row
  // whose type-implied ids are missing, and one whose `type` is outside the union
  // — `requireAssociationPair` throws before `auditableAssociationOrg` (`./audit`)
  // is handed anything — and the only reason a planter never meets that throw is
  // that `lockTargetRow` and `associationStatement` are built FIRST and refuse
  // exactly the same rows a few lines earlier. That is an argument about reading
  // order, so the sweep that made the audit total left it one refactor from being
  // false: hoist the audit above these two and a defective row reaches it with
  // nothing having refused it, changing which refusal the planter reads.
  // `association.test.ts` §2 pins the ORDER, read off this function's own source.
  // Reorder these lines and that suite goes red.
  //
  // The PREMISE the order rests on — that the audit refuses no row the two
  // builders above have not already refused — is no longer a test at all. All
  // three ask ONE resolver, `requireAssociationPair`, so the subset relation is
  // a property of the call graph rather than of three switches that happen to be
  // spelled alike. `association.test.ts` §2b tests the resolver and the
  // delegation; it used to enumerate 64 rows because there was nothing else to
  // rest on.
  const lock = lockTargetRow(invitation);
  const association = associationStatement(invitation, invitationId);
  const slotIsOurs = unboundTargetSlot(invitation);

  // OV-008 — the audit row travels IN the batch, so an association cannot commit
  // without the record of who made it. It re-asserts the association's own
  // outcome rather than trusting the batch (see
  // `acceptedAssociationEventStatement`).
  //
  // BOTH HALVES OF THAT INVARIANT LIVE IN `./audit` — what an accept audits and
  // the statement that writes it, next to each other — so this line is the whole
  // of the accept's part in it: resolve the pair the way the two builders above
  // already did, and hand it over.
  //
  // ALL THREE INVITATION TYPES audit since #304 WS3 / migration 0036, the
  // sending-church subject included, and the two functions are TOTAL between
  // them: a subject comes back, or one of them throws. So there is exactly ONE
  // batch shape here — always audited. The shorter batch is not conditional, it
  // does not exist: an unaudited association is the state OV-008 forbids, so the
  // spelling of it is absent from this file rather than guarded by a ternary a
  // later edit could make reachable.
  //
  // CS-013's sharing write joins the batch on the same terms and for the same
  // reason (#620): TOTAL rather than conditional, so the count stays a fact
  // about this function instead of becoming a thing that depends on the
  // invitation's type. It is five statements now, and still one shape.
  const audit = acceptedAssociationEventStatement(actor, {
    ...auditableAssociationOrg(requireAssociationPair(invitation)),
    invitationId,
  });

  const claim = respondToInvitationQuery(
    actor,
    invitationId,
    "accepted",
    slotIsOurs
  );

  // CS-013 — the invite-origin sharing defaults, in the acceptance's own batch
  // so the toggles and the association commit together (ruling 2026-08-15
  // §187). It is TOTAL over the three invitation types and writes nothing for
  // the one with no plant in it, so this batch still has exactly ONE shape —
  // `sharingDefaultsStatement` (`@/lib/privacy/sharing-defaults`) carries the
  // whole argument, and this file stays ignorant of `church_privacy_settings`
  // the way it is of `coach_assignments`.
  //
  // BEFORE THE ASSOCIATION, and that placement is the rule rather than a
  // preference: it fires only for a plant whose two oversight FKs are still
  // NULL, so it has to read the row before the association write sets one.
  // Batched after it, every re-accept from an org a plant already belongs to
  // would reset toggles the planter had deliberately turned off.
  const sharing = sharingDefaultsStatement(actor.id, invitationId);

  const [, claimed, , associated] = await db.batch([
    lock,
    claim,
    sharing,
    association,
    audit,
  ]);

  const [updated] = claimed;

  if (!updated) {
    throw new InvitationError(await lostClaimReason(invitationId));
  }

  // The claim and the association carry the SAME slot rule, evaluated against a
  // row this transaction holds a lock on — so a won claim and an empty
  // association cannot both happen. Asserted rather than assumed, because the
  // consequence of being wrong is the state nothing in the product can repair:
  // an invitation reading `accepted`, no association, and a milestone announced
  // for it. Refusing here at least withholds the milestone and tells the user.
  if (associated.length === 0) {
    console.error("an accepted invitation wrote no association", {
      invitationId,
      type: invitation.type,
    });
    throw new InvitationError(ALREADY_ASSOCIATED_MESSAGE);
  }

  // F11 N-025 — milestone #1, announced at its source.
  //
  // Last, and after the committed batch, so it fires only on a genuine FIRST
  // acceptance (`updated` is the claim's own returned row) and a notification
  // failure cannot leave an invitation half-accepted (memory/invariants.md →
  // Atomicity). Neither emitter throws, and neither decides whether the plant is
  // sharing — `enqueue` does, per recipient, and writes nothing when it is not.
  //
  // BOTH SIDES OF THE HANDSHAKE NOW HAVE A RAIL (#304 WS3, ruling #351). This
  // used to be `if (updated.targetChurchId)` and nothing else: a sending church
  // joining a network names no plant, `notifications.church_id` was NOT NULL,
  // and the milestone was composed and dropped. Migration 0036 anchored a
  // notification to a church OR an org, so the plantless answer is announced to
  // the NETWORK that asked — the same consent-exempt own-relationship rail,
  // filed under the tenant that reads it.
  if (updated.targetChurchId) {
    await announceInvitationAcceptedForChurch(updated);
  } else if (updated.targetSendingChurchId) {
    await announceSendingChurchAcceptedFor(updated);
  }

  return updated;
}

/**
 * Announce a SENDING CHURCH's acceptance to the network that invited it (#304
 * WS3). Best-effort by construction, exactly like the plant-side twin, and the
 * network id comes from the invitation's own `sending_network_id` — the row that
 * names who asked — never from the sending church's FK, which by now points at
 * it and would be the same value for a second, uninvolved network tomorrow.
 */
async function announceSendingChurchAcceptedFor(
  invitation: OrganizationInvitation
): Promise<void> {
  const sendingChurchId = invitation.targetSendingChurchId;
  const sendingNetworkId = invitation.sendingNetworkId;
  if (!sendingChurchId || !sendingNetworkId) return;

  try {
    const name = await sendingChurchNameOf(sendingChurchId);
    if (!name) return;

    await announceSendingChurchJoinedNetwork({
      sendingNetworkId,
      sendingChurchName: name,
      invitationId: invitation.id,
    });
  } catch (error) {
    console.error("sending church acceptance milestone failed", {
      sendingChurchId,
      invitationId: invitation.id,
      error,
    });
  }
}

/**
 * Look up the plant's name and announce the milestone. Best-effort by
 * construction: `announceInvitationAccepted` swallows its own failures, and the
 * name lookup is guarded so a missing church cannot throw into an acceptance
 * that has already been recorded.
 *
 * The whole INVITATION is passed, not just the church id, because the audience
 * of this one milestone is the org that issued it, and `invitation.type` is
 * what names that org (`invitingOrgForInvitation`). It is the only oversight
 * notification `enqueue` writes without consent, so it has to be addressed
 * exactly, and there are two ways to get it wrong — both of them reachable:
 *
 *   * from the PLANT: `associationStatement` below sets one of the plant's two
 *     oversight FKs without clearing the other, so a plant can belong to a
 *     sending church AND a network at once, and the uninvolved one would have
 *     been notified without consent;
 *   * from the invitation's two FK COLUMNS: a row can carry a stray
 *     `sending_network_id` — `insertInvitation` performs no type↔id consistency
 *     check and there is no CHECK constraint — so a `church_to_sending_church`
 *     row would have reached the network too.
 *
 * Deriving from `type` closes both: it is the same field `applyAssociation`
 * switches on, so the notification goes to precisely the org whose association
 * was just made.
 */
async function announceInvitationAcceptedForChurch(
  invitation: OrganizationInvitation
): Promise<void> {
  const churchId = invitation.targetChurchId;
  if (!churchId) return;

  try {
    const plantName = await plantNameOf(churchId);
    if (!plantName) return;

    await announceInvitationAccepted({
      churchId,
      plantName,
      invitationId: invitation.id,
      invitation: {
        type: invitation.type,
        sendingChurchId: invitation.sendingChurchId,
        sendingNetworkId: invitation.sendingNetworkId,
      },
    });
  } catch (error) {
    console.error("oversight invitation milestone failed", {
      churchId,
      invitationId: invitation.id,
      error,
    });
  }
}

/**
 * Why an accept's claim matched no row — the two reasons told apart.
 *
 * The claim's WHERE has exactly three predicates: the id, `status = 'pending'`,
 * and the slot guard. Authority and status were already checked against a read,
 * so if the row STILL reads pending the slot guard is the only thing that can
 * have failed: the target is bound to a different org. Anything else means the
 * row was answered underneath us.
 *
 * One extra read, on the failure path only, and it decides a message rather than
 * a write — so it is not a concurrency guard and does not need to be.
 */
async function lostClaimReason(invitationId: string): Promise<string> {
  const current = await getInvitation(invitationId);
  return current?.status === "pending"
    ? ALREADY_ASSOCIATED_MESSAGE
    : "This invitation is no longer pending";
}

/**
 * Decline an invitation. The actor must have authority over the target entity —
 * which for a plant means the PLANTER and nobody else
 * (`verifyInvitationAuthority`, OV-010).
 *
 * ONE STATEMENT, no batch: a decline associates nothing, so there is no second
 * write to be atomic with, and nothing is audited — `association_events` records
 * associations and severs, and a declined invitation is neither (the invitation
 * row is its own record, carrying `responded_by` and `responded_at`).
 *
 * OV-006 — the org that asked is told, LAST and best-effort, exactly like the
 * accept's milestone: the answer is recorded whether or not the announcement
 * lands, and `announceInvitationDeclined` never throws.
 */
export async function declineInvitationAs(
  actor: InvitationActor,
  invitationId: string
): Promise<OrganizationInvitation> {
  // Authority first, then status: see `loadRespondableInvitation`.
  await loadRespondableInvitation(actor, invitationId);

  const [updated] = await respondToInvitationQuery(
    actor,
    invitationId,
    "declined"
  );

  if (!updated) {
    throw new InvitationError("This invitation is no longer pending");
  }

  // BOTH SIDES, since #304 WS3 / ruling #351 — the mirror of the accept path
  // above. A sending church declining a network names no plant; the milestone is
  // anchored to the NETWORK instead of being dropped for want of a `church_id`.
  //
  // Both arms obey the same disclosure rule: a decline names the ADDRESS THE ORG
  // TYPED and nothing else (ruled 2026-08-09). The refused org never associated,
  // so neither the plant's name nor the sending church's is theirs to learn.
  if (updated.targetChurchId) {
    await announceInvitationDeclinedForChurch(updated);
  } else if (updated.targetSendingChurchId) {
    await announceSendingChurchDeclinedFor(updated);
  }

  return updated;
}

/**
 * Announce a SENDING CHURCH's decline to the network that invited it (#304 WS3).
 *
 * Names `invitee_email` and never looks the sending church up — the same rule,
 * and the same reason, as `announceInvitationDeclinedForChurch`: naming the
 * organization behind an address the network may simply have guessed is the
 * disclosure `ACCOUNT_NOT_INVITABLE_MESSAGE` exists to prevent, arriving two
 * steps later by another route.
 */
async function announceSendingChurchDeclinedFor(
  invitation: OrganizationInvitation
): Promise<void> {
  const sendingNetworkId = invitation.sendingNetworkId;
  const inviteeEmail = invitation.inviteeEmail;
  if (!sendingNetworkId || !inviteeEmail) return;

  try {
    await announceSendingChurchDeclinedNetwork({
      sendingNetworkId,
      inviteeEmail,
      invitationId: invitation.id,
    });
  } catch (error) {
    console.error("sending church decline milestone failed", {
      invitationId: invitation.id,
      error,
    });
  }
}

/**
 * Announce the decline to the org that issued the invitation. Best-effort by
 * construction, and a mirror of `announceInvitationAcceptedForChurch` —
 * including the reason the whole invitation is passed rather than a church id:
 * the audience is derived from `invitation.type` by `invitingOrgForInvitation`,
 * never from the plant's FKs, so a plant that already belongs to another org
 * cannot leak this to it.
 *
 * IT DOES NOT LOOK THE PLANT'S NAME UP, and the absent read is the point (#304,
 * ruled 2026-08-09). The org that was refused never became associated with this
 * plant, so the notification names the ADDRESS THE ORG ITSELF TYPED — the
 * invitation's own `invitee_email` — and nothing else. Naming the plant told a
 * stranger what organization sits behind an address they had guessed at, which
 * is the disclosure the whole invitation surface is otherwise careful about
 * (see `ACCOUNT_NOT_INVITABLE_MESSAGE`).
 */
async function announceInvitationDeclinedForChurch(
  invitation: OrganizationInvitation
): Promise<void> {
  const churchId = invitation.targetChurchId;
  if (!churchId) return;

  // `invitee_email` is nullable — rows predating #23 recorded no address at all
  // — and it is the ONLY identifier this org may be given back. With nothing to
  // name, the milestone is skipped rather than composed around a blank or, far
  // worse, quietly re-pointed at the plant's name. The decline itself is
  // already recorded; this notification is best-effort by construction.
  const inviteeEmail = invitation.inviteeEmail;
  if (!inviteeEmail) return;

  try {
    await announceInvitationDeclined({
      churchId,
      inviteeEmail,
      invitationId: invitation.id,
      invitation: {
        type: invitation.type,
        sendingChurchId: invitation.sendingChurchId,
        sendingNetworkId: invitation.sendingNetworkId,
      },
    });
  } catch (error) {
    console.error("oversight invitation decline milestone failed", {
      churchId,
      invitationId: invitation.id,
      error,
    });
  }
}

/** The sending church's display name, or null when there is no such row. */
async function sendingChurchNameOf(
  sendingChurchId: string
): Promise<string | null> {
  const [org] = await db
    .select({ name: sendingChurches.name })
    .from(sendingChurches)
    .where(eq(sendingChurches.id, sendingChurchId))
    .limit(1);

  return org?.name ?? null;
}

/** The plant's display name, or null when there is no such row. */
async function plantNameOf(churchId: string): Promise<string | null> {
  const [plant] = await db
    .select({ name: churches.name })
    .from(churches)
    .where(eq(churches.id, churchId))
    .limit(1);

  return plant?.name ?? null;
}

/**
 * The statement that records a response. Exported so a test can read the bound
 * parameters: `responded_by` is the SESSION's user and the WHERE clause is a
 * compare-and-set on `pending`.
 *
 * The compare-and-set matters twice. Two concurrent accepts both pass the read
 * in `loadPendingInvitation` (memory/invariants.md — a SELECT-then-write guard
 * is not a concurrency guard), so without it the loser would write a second
 * "accepted" and emit a second milestone notification; and a response can never
 * overwrite an answer that is already recorded.
 *
 * `slotGuard` is how an ACCEPT adds `unboundTargetSlot(invitation)` to the same
 * statement, so that a claim which would replace somebody else's association
 * matches no row and writes nothing (see `acceptInvitationAs`). A DECLINE passes
 * none: declining an invitation says nothing about who the plant is bound to.
 */
export function respondToInvitationQuery(
  actor: InvitationActor,
  invitationId: string,
  status: Extract<OrganizationInvitationStatus, "accepted" | "declined">,
  slotGuard?: SQL
) {
  return db
    .update(organizationInvitations)
    .set({
      status,
      respondedBy: actor.id,
      respondedAt: new Date(),
    })
    .where(and(pendingInvitation(invitationId), slotGuard))
    .returning();
}

/** `(<fk> is null or <fk> = <org>)` — the slot is free, or already ours. */
function freeOrHolds(column: AnyPgColumn, value: string): SQL {
  return sql`(${column} is null or ${column} = ${value})`;
}

/**
 * An invitation whose type-implied ID PAIR is present, narrowed to the two
 * columns that type actually means. The output of `requireAssociationPair`, and
 * the only shape the three pair consumers below ever see.
 *
 * The fields are named after the COLUMNS they come from rather than the roles
 * they play, so a consumer reads the same identifier before and after the
 * narrowing. That is deliberate: `sendingChurchId` is the INVITING org in
 * `church_to_sending_church` and the TARGET in `sending_church_to_network`, so a
 * role-shaped pair (`{ churchId, sendingChurchId }`) is one careless arm away
 * from binding a plant to itself.
 */
export type AssociationPair =
  | {
      type: "church_to_sending_church";
      targetChurchId: string;
      sendingChurchId: string;
    }
  | {
      type: "church_to_network";
      targetChurchId: string;
      sendingNetworkId: string;
    }
  | {
      type: "sending_church_to_network";
      targetSendingChurchId: string;
      sendingNetworkId: string;
    };

/**
 * WHICH TWO IDS A TYPE IMPLIES — decided ONCE, for every consumer that needs the
 * pair.
 *
 * `organization_invitations` constrains none of this: `type` is a bare
 * `varchar(40)` with a TypeScript-only `$type<>` cast, all four FK columns are
 * nullable, and `insertInvitation` validates neither (see
 * `verifyInvitationAuthority`). So "a `church_to_network` row means
 * `targetChurchId` AND `sendingNetworkId`, and a row missing either is refused"
 * is a real decision that somebody has to make, and the same decision every time.
 *
 * IT WAS MADE THREE TIMES (swept 2026-08-13, #411 review round 1).
 * `unboundTargetSlot`, `associationStatement` and the audit derivation each
 * carried their own switch over `type`, their own pair of `if (!invitation.<fk>)`
 * guards per arm, their own literal copy of the three "Invalid invitation:
 * missing …" messages and their own fail-closed `default:` — character-identical
 * in three places, agreeing only because they had been pasted on the same day.
 * The tell was the test that had to be written to make that safe: a 4 types × 16
 * nullable-FK-mask cross-product calling all three builders on 64 rows, to
 * establish by enumeration that one function's guards were a superset of
 * another's. That relation is now true BY CONSTRUCTION — there is one set of
 * guards — so the property needs no cross-product to hold it up.
 *
 * THE THIRD CONSUMER IS NOW IN ANOTHER MODULE, and `AssociationPair` is what
 * carries the decision to it: `auditableAssociationOrg` (`./audit`) takes the
 * narrowed pair, so it cannot re-derive one, and it cannot ask for one either —
 * that module reaches this one for TYPES ONLY, deliberately.
 *
 * IT IS TOTAL: it returns a narrowed pair or it THROWS, and there is no third
 * answer. The `never` makes a FOURTH `OrganizationInvitationType` a compile error
 * here rather than a silent arm in three places; the throw is what refuses the
 * row that is already in the table.
 *
 * `lockTargetRow` deliberately does NOT come through here. Statement one of the
 * accept batch locks the TARGET only, so its guard is narrower on purpose, and
 * routing it through the pair would change which message an accept throws for a
 * row whose inviting-org id is the missing one.
 */
export function requireAssociationPair(
  invitation: AssociationFacts
): AssociationPair {
  switch (invitation.type) {
    case "church_to_sending_church": {
      if (!invitation.targetChurchId || !invitation.sendingChurchId) {
        throw new InvitationError(
          "Invalid invitation: missing church or sending church"
        );
      }
      return {
        type: invitation.type,
        targetChurchId: invitation.targetChurchId,
        sendingChurchId: invitation.sendingChurchId,
      };
    }

    case "church_to_network": {
      if (!invitation.targetChurchId || !invitation.sendingNetworkId) {
        throw new InvitationError(
          "Invalid invitation: missing church or network"
        );
      }
      return {
        type: invitation.type,
        targetChurchId: invitation.targetChurchId,
        sendingNetworkId: invitation.sendingNetworkId,
      };
    }

    case "sending_church_to_network": {
      if (!invitation.targetSendingChurchId || !invitation.sendingNetworkId) {
        throw new InvitationError(
          "Invalid invitation: missing sending church or network"
        );
      }
      return {
        type: invitation.type,
        targetSendingChurchId: invitation.targetSendingChurchId,
        sendingNetworkId: invitation.sendingNetworkId,
      };
    }

    default: {
      const unknownType: never = invitation.type;
      console.error("invitation type has no association rule", {
        type: unknownType,
      });
      throw new InvitationError(NOT_AUTHORIZED_MESSAGE);
    }
  }
}

/**
 * `SELECT id FROM <target> WHERE id = ? FOR UPDATE` — statement ONE of the accept
 * batch, and the only thing that makes the slot rule hold under concurrency.
 *
 * The slot rule is a predicate on the TARGET's row, but the claim it guards
 * updates `organization_invitations`. Two accepts of two different invitations
 * for one free slot therefore write two different rows and contend on nothing:
 * each `EXISTS (… fk IS NULL …)` reads a snapshot, takes no lock, and is true for
 * both. This locks the row they are actually competing for, so the second
 * transaction waits for the first to COMMIT and then — new statement, new READ
 * COMMITTED snapshot — evaluates the slot rule against what the winner wrote.
 *
 * It writes nothing, which is the point: the lock is the whole contribution, and
 * it is released by the same COMMIT that applies the two writes.
 *
 * Same two rules as `associationStatement` and `unboundTargetSlot`: throws on a
 * row whose FKs contradict its `type`, and fails CLOSED on a `type` no arm knows,
 * so an accept can never proceed with nothing locked.
 *
 * IT DOES NOT GO THROUGH `requireAssociationPair`, and that is deliberate. This
 * statement locks the TARGET row and nothing else, so it has no business
 * refusing a row for a missing INVITING-org id — routing it through the pair
 * would widen its guard and change which message an accept throws. Its arms are
 * therefore narrower than the pair's by design, not by omission: they refuse a
 * strict SUBSET of what the three pair consumers refuse.
 */
export function lockTargetRow(invitation: AssociationFacts) {
  switch (invitation.type) {
    case "church_to_sending_church":
    case "church_to_network": {
      if (!invitation.targetChurchId) {
        throw new InvitationError("Invalid invitation: missing church");
      }
      return db
        .select({ id: churches.id })
        .from(churches)
        .where(eq(churches.id, invitation.targetChurchId))
        .for("update");
    }

    case "sending_church_to_network": {
      if (!invitation.targetSendingChurchId) {
        throw new InvitationError("Invalid invitation: missing sending church");
      }
      return db
        .select({ id: sendingChurches.id })
        .from(sendingChurches)
        .where(eq(sendingChurches.id, invitation.targetSendingChurchId))
        .for("update");
    }

    default: {
      const unknownType: never = invitation.type;
      console.error("invitation type has no target row to lock", {
        type: unknownType,
      });
      throw new InvitationError(NOT_AUTHORIZED_MESSAGE);
    }
  }
}

/**
 * `EXISTS (SELECT … WHERE <target>.id = ? AND (<fk> IS NULL OR <fk> = ?))` — the
 * predicate that stops an accept from REPLACING an association, expressed for a
 * statement that updates a different table (the claim; see `acceptInvitationAs`).
 *
 * `associationStatement` needs the same rule on the row it is already updating,
 * where it is a plain column predicate and no subquery is required — hence the
 * two spellings of one idea. They are kept next to each other, and the unit
 * tests read BOTH off the generated SQL, because a guard on only one of the two
 * statements is worse than neither: it would commit the claim and skip the bind.
 *
 * A subquery reads a snapshot and takes no lock, so this predicate is a guard
 * against a SEQUENTIAL second accept and nothing more. What makes it hold
 * against a CONCURRENT one is `lockTargetRow` running first in the same batch —
 * see `acceptInvitationAs`.
 *
 * A row whose FK columns contradict its `type`, and a `type` no arm knows, are
 * both refused by `requireAssociationPair` before this function chooses a table
 * — the same one decision `associationStatement` asks and the accept's audit
 * (`./audit` → `auditableAssociationOrg`) is handed, so the three cannot
 * disagree about which pair a type implies.
 */
export function unboundTargetSlot(invitation: AssociationFacts): SQL {
  const pair = requireAssociationPair(invitation);

  switch (pair.type) {
    case "church_to_sending_church": {
      return exists(
        db
          .select({ id: churches.id })
          .from(churches)
          .where(
            and(
              eq(churches.id, pair.targetChurchId),
              freeOrHolds(churches.sendingChurchId, pair.sendingChurchId)
            )
          )
      );
    }

    case "church_to_network": {
      return exists(
        db
          .select({ id: churches.id })
          .from(churches)
          .where(
            and(
              eq(churches.id, pair.targetChurchId),
              freeOrHolds(churches.sendingNetworkId, pair.sendingNetworkId)
            )
          )
      );
    }

    case "sending_church_to_network": {
      return exists(
        db
          .select({ id: sendingChurches.id })
          .from(sendingChurches)
          .where(
            and(
              eq(sendingChurches.id, pair.targetSendingChurchId),
              freeOrHolds(
                sendingChurches.sendingNetworkId,
                pair.sendingNetworkId
              )
            )
          )
      );
    }
  }
}

/**
 * The statement that revokes an invitation. Exported so a test can read the
 * bound parameters: the org in the WHERE clause comes from the SESSION, and
 * nothing a client sent can put another org's id there.
 *
 * SCOPED TO THE ORG, NOT THE INVITER — RULED 2026-08-04 (#23). The pending list
 * is org-scoped (`invitationsForOrgQuery`, same `invitingOrgOf` predicate), so
 * a second admin of the same sending church sees a queue they could not act on:
 * the invitation their colleague sent to the wrong address stayed open for 30
 * days with a Revoke button that refused. Whoever may issue an invitation on the
 * org's behalf may close one, and both facts are read from the same helper so
 * the list and the button can never disagree about what "ours" means.
 *
 * The role check is not relaxed by this: `invitingOrgOf` matches nothing for any
 * role that does not invite, and nothing for an admin with no org of their own.
 */
export function revokeInvitationQuery(
  actor: InvitationActor,
  invitationId: string
) {
  return db
    .update(organizationInvitations)
    .set({ status: "revoked" })
    .where(and(pendingInvitation(invitationId), invitingOrgOf(actor)))
    .returning();
}

/**
 * Revoke a pending invitation the actor's ORG sent. The check is part of the
 * UPDATE, so an admin of another org — or any non-oversight caller — matches no
 * row and writes nothing.
 */
export async function revokeInvitationAs(
  actor: InvitationActor,
  invitationId: string
): Promise<OrganizationInvitation> {
  if (!isUuid(invitationId)) {
    throw new InvitationError("Invitation not found");
  }

  const [updated] = await revokeInvitationQuery(actor, invitationId);

  if (!updated) {
    throw new InvitationError(
      "Invitation not found, not pending, or not sent by your organization"
    );
  }

  return updated;
}

// ============================================================================
// Disassociation
// ============================================================================
//
// These three sever an association that an invitation created. They are
// primitives with no authority check of their own and NO action wrapper here.
// They used to be `"use server"` exports taking a bare id, which meant an
// anonymous POST could detach any church from its oversight by guessing a uuid.
//
// NOT DEAD CODE — deliberately kept, deliberately unexposed. RULED 2026-08-03
// (#274; canon in `product-docs/features/oversight/frd.md` OV-007/OV-010):
// BOTH SIDES may sever. The plant's planter does it from the settings
// association area (#277) and the org's admin from the plant detail page
// (#278), each behind a type-to-confirm dialog, each notifying the other side,
// each writing an `association_events` audit row. Those units import these
// primitives, so do not delete them and do not narrow their exports.
//
// What they must NOT get is a wrapper in `service.ts`. #265's whole finding is
// that an action layer is an endpoint list; the authenticated wrappers belong
// with the surfaces that own the authority rule and the audit write, and they
// derive the entity from the session (as `setOversightSharingAction` does:
// whose plant it is must not be an argument) rather than re-exporting these.
//
// HOW #277/#278 IMPORT THEM. `service.test.ts` → "no 'use server' module
// republishes the invitation logic layer" enforces two things transitively,
// barrels included: no action module may RE-EXPORT anything from this file
// (ever), and a `"use server"` module may only REACH this file at all if it is
// named in that test's `CORE_REACHING_ACTION_MODULES` allowlist, with the reason.
// So each of those units adds its own action module to that list in the same
// diff — deliberately, and reviewed — instead of discovering that routing the
// import through a barrel makes the guardrail quiet.
//
// BOTH SIDES NOW HAVE ONE, and NEITHER CALLS THESE THREE: `leaveOversightOrgAs`
// (the planter, #304/OV-007a) and `removePlantFromOrgAs` (the org's admin,
// #304/OV-007b) both go through `severAssociationWithAuditStatement` in
// `./audit`. `set fk = null where id = ?` — the shape below — cannot express the
// tenancy assertion a sever needs (it severs whichever org happens to be there,
// for whoever asks), and it has no place to put the audit row that has to commit
// with it.
//
// So the three are now genuinely unreferenced, and they are kept anyway, for one
// reason: `service.test.ts`'s guardrail-mutation recipes are written in terms of
// them, and those recipes are the evidence that the endpoint-surface tests have
// been WATCHED to fail. Removing the primitives would silently retire that
// evidence. They stay exported, unwrapped, and not endpoints; nothing new may
// call them.
// ============================================================================

/**
 * Remove a church plant's association with its sending church.
 * Sets `churches.sending_church_id` back to null.
 */
export async function disassociateChurchFromSendingChurch(
  churchId: string
): Promise<void> {
  await db
    .update(churches)
    .set({
      sendingChurchId: null,
      updatedAt: new Date(),
    })
    .where(eq(churches.id, churchId));
}

/**
 * Remove a church plant's direct association with a network.
 * Sets `churches.sending_network_id` back to null.
 */
export async function disassociateChurchFromNetwork(
  churchId: string
): Promise<void> {
  await db
    .update(churches)
    .set({
      sendingNetworkId: null,
      updatedAt: new Date(),
    })
    .where(eq(churches.id, churchId));
}

/**
 * Remove a sending church's association with a network.
 * Sets `sending_churches.sending_network_id` back to null.
 */
export async function disassociateSendingChurchFromNetwork(
  sendingChurchId: string
): Promise<void> {
  await db
    .update(sendingChurches)
    .set({
      sendingNetworkId: null,
      updatedAt: new Date(),
    })
    .where(eq(sendingChurches.id, sendingChurchId));
}

// WHAT AN ACCEPT AUDITS IS NOT IN THIS FILE. `auditableAssociationOrg` — which
// subject and which org an invitation's association names — lives in `./audit`,
// next to `acceptedAssociationEventStatement`, the statement it is derived for.
// The two are halves of one OV-008 invariant, and holding them 730 lines apart
// here is what let a `default:` arm fall off the end of a switch and read as
// correct at both ends. It takes the pair `requireAssociationPair` narrows, so
// the decision about which two ids a `type` implies stays here, made once, for
// the three consumers that share it.

// ----------------------------------------------------------------------------
// The planter's sever (#304 / OV-007a, OV-010)
// ----------------------------------------------------------------------------

/** The two orgs a plant can leave, as the planter's surface names them. */
export const oversightOrgTypes = ["sending_church", "network"] as const;

export function isAssociationOrgType(
  value: unknown
): value is AssociationOrgType {
  return (
    typeof value === "string" &&
    (oversightOrgTypes as readonly string[]).includes(value)
  );
}

export const NOT_ASSOCIATED_MESSAGE =
  "Your plant is not part of that organization";

export const PLANTER_ONLY_SEVER_MESSAGE =
  "Only the church planter can leave a sending church or network";

/**
 * LEAVE AN OVERSIGHT ORG — the planter side of the #274 sever ruling (OV-007a).
 *
 * THE ENTITY IS NOT AN ARGUMENT. There is no `churchId` parameter and there
 * never may be: the plant is the actor's own (`actor.churchId`), minted from the
 * session, which is the same shape `setOversightSharingAction` uses and the rule
 * `memory/invariants.md` → Authentication states. All a caller says is WHICH OF
 * ITS TWO oversight associations to end, and that is a two-valued enum, not an
 * id.
 *
 * OWNER ONLY, SERVER-SIDE (OV-010, ruled #274; AS-003 puts leaving an
 * association on the Owner-only list). A plant Member or a coach is refused
 * here, in the logic layer, so a forged POST straight at the action is refused
 * by the same statement the button is. The check is repeated in the SQL by
 * construction — the statement's WHERE names `actor.churchId`, so an actor with
 * no plant matches nothing whatever their seat — but the explicit refusal is
 * what produces a legible message rather than a silent no-op.
 *
 * ONE STATEMENT does the FK null and the audit row (`./audit` →
 * `severAssociationWithAuditStatement`), so the association and the record of
 * how it ended commit together or not at all. Its WHERE is the tenancy
 * assertion: the FK is nulled only if it still points at the org being left, so
 * a plant that belongs to a sending church AND a network keeps the other one,
 * and a request naming an org the plant does not belong to writes nothing at
 * all.
 *
 * THE ORG IS TOLD LAST, after the commit and best-effort — the sever is not
 * undone by a notification failure, and `announceAssociationEnded` never throws.
 * It has to be last for a second reason too: its recipients are told about a
 * plant that is, by then, outside their access, and `enqueue` rests that on the
 * `association_events` row this statement just wrote
 * (`OVERSIGHT_OWN_RELATIONSHIP_TYPES`). Announcing first would have been a
 * message saying a plant had left before it had.
 */
export async function leaveOversightOrgAs(
  actor: InvitationActor,
  orgType: AssociationOrgType
): Promise<{ orgType: AssociationOrgType; orgId: string }> {
  if (!isPlantOwner(actor)) {
    throw new InvitationError(PLANTER_ONLY_SEVER_MESSAGE);
  }
  if (!actor.churchId) {
    throw new InvitationError("Create your church plant first");
  }

  const [plant] = await db
    .select({
      name: churches.name,
      sendingChurchId: churches.sendingChurchId,
      sendingNetworkId: churches.sendingNetworkId,
    })
    .from(churches)
    .where(eq(churches.id, actor.churchId))
    .limit(1);

  const orgId =
    orgType === "sending_church"
      ? (plant?.sendingChurchId ?? null)
      : (plant?.sendingNetworkId ?? null);

  // A read, so not the guard — the statement below carries the same rule and is
  // what actually decides. This only turns "nothing to leave" into a message.
  if (!plant || !orgId) {
    throw new InvitationError(NOT_ASSOCIATED_MESSAGE);
  }

  const severed = await severAssociationWithAuditStatement(actor, {
    subject: churchSubject(actor.churchId),
    orgType,
    orgId,
  });

  // No audit row means the UPDATE matched nothing: the association moved between
  // the read above and the write. Nothing was written — not the null, not the
  // row — so the refusal is honest.
  if (!severed) {
    throw new InvitationError(NOT_ASSOCIATED_MESSAGE);
  }

  await announceAssociationEndedFor({
    churchId: actor.churchId,
    plantName: plant.name,
    orgType,
    orgId,
    occurrence: severed.id,
  });

  return { orgType, orgId };
}

// ----------------------------------------------------------------------------
// The org's sever (#304 / OV-007b, OV-011)
// ----------------------------------------------------------------------------

export const ORG_ADMIN_ONLY_SEVER_MESSAGE =
  "Only a sending church or network admin can remove a plant from their organization";

/**
 * ONE message for "no such plant", "not a uuid" and "belongs to somebody else".
 *
 * The same symmetry `/oversight/plants/[id]` gets from its 404
 * (`getOversightPlantDetail` answers null for all three): a refusal that told
 * "exists, but not yours" apart from "does not exist" would answer a question
 * about ANOTHER org's portfolio, one guessed uuid at a time, to an admin who is
 * authenticated but not party to it.
 */
export const PLANT_NOT_IN_ORG_MESSAGE =
  "That church plant is not part of your organization";

/**
 * WHICH oversight org a user speaks for — the org side's answer to "which of
 * the plant's two associations is this about", and it is not an argument.
 *
 * A `sending_church_admin` can only ever end the plant's SENDING CHURCH
 * association, a `network_admin` only its NETWORK one, and the id is their own
 * (`memory/invariants.md` → Authentication: an entity implied by the actor is
 * not an argument). So the org KIND is not a parameter here either — unlike the
 * planter's `leaveOversightOrgAs`, where one actor genuinely has two
 * associations to choose between.
 *
 * Pure, and deliberately structural rather than branded: the page renders the
 * button from the same derivation the write is guarded by, so what an admin can
 * see and what they can do cannot come from two different rules. Every actual
 * WRITE still takes an `InvitationActor`.
 */
export function oversightOrgOfUser(
  user: TenancyFields
): { orgType: AssociationOrgType; orgId: string } | null {
  const org = oversightOrgOf(user);

  return org ? { orgType: org.type, orgId: org.id } : null;
}

/**
 * `churches.<fk> = <org>` — "this plant is ours", as a predicate on the plant's
 * own row. Built from the two-valued org kind, so there is no column name here
 * that a request could influence.
 *
 * Exported so a test can read the generated SQL: which of the two independent
 * oversight FKs a kind maps to is exactly the sort of thing an edit inverts
 * silently, and a network admin whose predicate named `sending_church_id` would
 * read and sever another org's associations.
 */
export function plantHeldByOrg(org: {
  orgType: AssociationOrgType;
  orgId: string;
}): SQL {
  return org.orgType === "sending_church"
    ? eq(churches.sendingChurchId, org.orgId)
    : eq(churches.sendingNetworkId, org.orgId);
}

/**
 * REMOVE A PLANT FROM THE CALLER'S OWN ORG — the org side of the #274 sever
 * ruling (OV-007b), and the mirror of `leaveOversightOrgAs` above.
 *
 * WHAT IS AN ARGUMENT AND WHAT IS NOT. `churchId` is, and has to be: an org has
 * many plants, so which one is a genuine choice the admin makes. Nothing else
 * is. The ORG comes from the session (`oversightOrgOfUser`), and so does the org
 * KIND — a sending church admin has exactly one association with this plant to
 * end, and a network admin has the other one. There is therefore no parameter on
 * this function that could aim it at another org's association, which is the
 * whole of the "an admin of a different org cannot sever this org's
 * association" rule.
 *
 * THE TENANCY ASSERTION IS THE WRITE'S OWN WHERE, not the read above it
 * (#304's high-risk extra). `severAssociationWithAuditStatement` nulls the FK
 * only while it still points at THIS org, so:
 *
 *   * a plant in another org matches nothing, and nothing is written — the read
 *     that precedes it only turns that into a legible message;
 *   * a plant that belongs to a sending church AND a network keeps the other
 *     one: the statement does not mention the other column at all;
 *   * the `association_events` row is written FROM that UPDATE, so a refused
 *     sever cannot leave an audit row claiming one happened.
 *
 * The moment it commits, `churches.<fk>` is null — which is the same column
 * `getAccessibleChurchIds` resolves an oversight admin's reach from and the same
 * one `listOversightPlants` filters on. So the plant leaves the directory, the
 * detail page and the org's notification fan-out together, with no second write
 * to keep in step.
 *
 * THE PLANTER IS TOLD LAST, after the commit and best-effort. Unlike the org's
 * side of the planter's sever, this notification is an ordinary church-role one:
 * its recipient is inside the plant, `canAccessChurch` is true for them by
 * construction, and no oversight consent toggle applies (their tenancy is the
 * plant). Announcing before the write would tell a planter they had
 * been removed while they still had not been.
 */
export async function removePlantFromOrgAs(
  actor: InvitationActor,
  churchId: string
): Promise<{
  orgType: AssociationOrgType;
  orgId: string;
  plantName: string;
}> {
  // The Owner seat AND the org tenancy — the role allowlist this replaces
  // (`sending_church_admin` / `network_admin`) meant both. See `isOrgOwner`.
  if (!isOrgOwner(actor)) {
    throw new InvitationError(ORG_ADMIN_ONLY_SEVER_MESSAGE);
  }

  // Non-null by construction: `isOrgOwner` above is `seat === "owner" &&
  // oversightOrgOf(...) !== null`, and `oversightOrgOfUser` is that same
  // resolution. The `if (!org)` arm this replaced was unreachable, and so was
  // the message it threw.
  const org = oversightOrgOfUser(actor)!;

  if (!isUuid(churchId)) {
    throw new InvitationError(PLANT_NOT_IN_ORG_MESSAGE);
  }

  // Scoped by the SAME predicate the write carries, so this read can never say
  // yes to a plant the write would refuse. It is not the guard — a read never is
  // (`memory/invariants.md`) — it exists for the message and for the plant's
  // name, which the notification needs and which must not be read unscoped.
  const [plant] = await db
    .select({ name: churches.name })
    .from(churches)
    .where(and(eq(churches.id, churchId), plantHeldByOrg(org)))
    .limit(1);

  if (!plant) {
    throw new InvitationError(PLANT_NOT_IN_ORG_MESSAGE);
  }

  const severed = await severAssociationWithAuditStatement(actor, {
    subject: churchSubject(churchId),
    orgType: org.orgType,
    orgId: org.orgId,
  });

  // No audit row means the UPDATE matched nothing: the association moved between
  // the read and the write. Nothing was written — not the null, not the row — so
  // the refusal is honest and the planter is told nothing.
  if (!severed) {
    throw new InvitationError(PLANT_NOT_IN_ORG_MESSAGE);
  }

  await announcePlantRemovedFor({
    churchId,
    orgType: org.orgType,
    orgId: org.orgId,
    occurrence: severed.id,
  });

  return { orgType: org.orgType, orgId: org.orgId, plantName: plant.name };
}

/** Tell the plant it was removed. Best-effort; never throws into a committed sever. */
async function announcePlantRemovedFor(input: {
  churchId: string;
  orgType: AssociationOrgType;
  orgId: string;
  occurrence: string;
}): Promise<void> {
  try {
    await announceRemovedFromOversightOrg(input);
  } catch (error) {
    console.error("plant removal announcement failed", {
      churchId: input.churchId,
      orgType: input.orgType,
      error,
    });
  }
}

/** Tell the org that was left. Best-effort; never throws into a committed sever. */
async function announceAssociationEndedFor(input: {
  churchId: string;
  plantName: string;
  orgType: AssociationOrgType;
  orgId: string;
  occurrence: string;
}): Promise<void> {
  try {
    await announceAssociationEnded({
      churchId: input.churchId,
      plantName: input.plantName,
      // The ONE org that was left, spelled out — never the plant's remaining
      // FKs, which is how the other org would have been told about a change
      // that did not involve it.
      org: {
        sendingChurchId:
          input.orgType === "sending_church" ? input.orgId : null,
        sendingNetworkId: input.orgType === "network" ? input.orgId : null,
      },
      occurrence: input.occurrence,
    });
  } catch (error) {
    console.error("association ended announcement failed", {
      churchId: input.churchId,
      orgType: input.orgType,
      error,
    });
  }
}

// ----------------------------------------------------------------------------
// The sending church's sever (#304 WS3 / OV-013)
// ----------------------------------------------------------------------------

export const SENDING_CHURCH_ADMIN_ONLY_SEVER_MESSAGE =
  "Only a sending church admin can leave their network";

export const NOT_IN_A_NETWORK_MESSAGE =
  "Your sending church is not part of a network";

/**
 * LEAVE THE NETWORK — the sending church's own sever (OV-013), and the third
 * member of the #274 family alongside `leaveOversightOrgAs` (the planter) and
 * `removePlantFromOrgAs` (the org's admin).
 *
 * IT SHIPPED WITH #304 WS3 AND NOT BEFORE, and the reason is worth keeping. A
 * sever has to be audited (#274 / OV-007: type-to-confirm, a notification, an
 * `association_events` row) and until migration 0036 the audit table's subject
 * was a CHURCH, NOT NULL — so this button could only have been a sever with no
 * record of who ended it, which is the one thing that ruling forbids. #351 gave
 * the table a subject discriminator; this is what it unblocked.
 *
 * NOTHING IS AN ARGUMENT. Not the sending church (it is the actor's own,
 * `actor.sendingChurchId`), not the network (it is whatever that sending church
 * currently points at), and not the org kind (a sending church has exactly one
 * association, and it is always with a network). So there is no parameter a
 * forged POST could aim at another org — the "only the sending church's admin
 * may sever" rule is structural before it is a check.
 *
 * ADMIN ONLY, SERVER-SIDE. A `team_member` who happens to carry a
 * `sending_church_id` is refused here, in the logic layer, so a request that
 * never loaded the dialog meets the same refusal the button does. The statement
 * repeats it by construction — its WHERE names `actor.sendingChurchId`, which a
 * user without one does not have — but the explicit check is what makes the
 * refusal legible rather than a silent no-op.
 *
 * ONE STATEMENT for the FK null and the audit row, and the NETWORK IS TOLD LAST:
 * the same two rules, for the same two reasons, as the planter's sever above.
 */
export async function leaveNetworkAsSendingChurchAdmin(
  actor: InvitationActor
): Promise<{ orgType: AssociationOrgType; orgId: string }> {
  // The Owner seat AND the sending-church tenancy — see `isOrgOwner`.
  //
  // ONE refusal, not two, and the id comes OUT of the same resolution. The
  // `if (!actor.sendingChurchId)` arm that used to sit behind this could never
  // fire — `oversightOrgOf` answers `sending_church` only when that FK is
  // non-null — so it is gone, and reading the id off `actorOrg` is what keeps
  // that provable rather than re-asserted with a `!`.
  const actorOrg = isOrgOwner(actor) ? oversightOrgOf(actor) : null;
  if (actorOrg?.type !== "sending_church") {
    throw new InvitationError(SENDING_CHURCH_ADMIN_ONLY_SEVER_MESSAGE);
  }
  const actorSendingChurchId = actorOrg.id;

  const [org] = await db
    .select({
      name: sendingChurches.name,
      sendingNetworkId: sendingChurches.sendingNetworkId,
    })
    .from(sendingChurches)
    .where(eq(sendingChurches.id, actorSendingChurchId))
    .limit(1);

  // A read, so not the guard — the statement below carries the same rule and is
  // what actually decides. This only turns "nothing to leave" into a message.
  if (!org?.sendingNetworkId) {
    throw new InvitationError(NOT_IN_A_NETWORK_MESSAGE);
  }

  const severed = await severAssociationWithAuditStatement(actor, {
    subject: sendingChurchSubject(actorSendingChurchId),
    orgType: "network",
    orgId: org.sendingNetworkId,
  });

  // No audit row means the UPDATE matched nothing: the association moved between
  // the read and the write. Nothing was written — not the null, not the row — so
  // the refusal is honest and the network is told nothing.
  if (!severed) {
    throw new InvitationError(NOT_IN_A_NETWORK_MESSAGE);
  }

  await announceSendingChurchLeftNetworkFor({
    sendingNetworkId: org.sendingNetworkId,
    sendingChurchName: org.name,
    occurrence: severed.id,
  });

  return { orgType: "network", orgId: org.sendingNetworkId };
}

/** Tell the network that was left. Best-effort; never throws into a committed sever. */
async function announceSendingChurchLeftNetworkFor(input: {
  sendingNetworkId: string;
  sendingChurchName: string;
  occurrence: string;
}): Promise<void> {
  try {
    await announceSendingChurchLeftNetwork(input);
  } catch (error) {
    console.error("sending church association ended announcement failed", {
      sendingNetworkId: input.sendingNetworkId,
      error,
    });
  }
}

// ============================================================================
// Query Invitations
// ============================================================================
//
// Reads. They are here rather than in the action layer because a reader is
// never a mutation and one of them has to work with NO session at all:
// `hasValidInvitationBypass` (register/beta-gate.ts) checks an invitation id
// before an account exists. Callers that render invitations to a user are
// responsible for their own access check.
// ============================================================================

/**
 * Get a single invitation by ID.
 */
export async function getInvitation(
  id: string
): Promise<OrganizationInvitation | null> {
  if (!isUuid(id)) return null;

  const [invitation] = await db
    .select()
    .from(organizationInvitations)
    .where(eq(organizationInvitations.id, id))
    .limit(1);

  return invitation ?? null;
}

// THE TWO TARGET-SIDE PENDING LISTS ARE NOT HERE, and their absence is the rule
// (swept 2026-08-13, #411).
//
// `getPendingInvitationsForChurch` and `getPendingInvitationsForSendingChurch`
// lived here, uncalled, from #265 until this sweep. Both selected
// `target_* = ? and status = 'pending'` and stopped there — and
// `memory/invariants.md` → Multi-Tenancy says that shape is WRONG for a list
// that offers an answer: expiry is LAZY in this product, a row is stamped
// `expired` only when somebody tries to answer it (`expireInvitationQuery`), so
// `pending` alone returns invitations whose window closed weeks ago. The
// dashboard reminder OV-005 raises is dismissible only by ANSWERING, so a
// lapsed row rendered from such a list is a banner the planter can neither
// answer nor remove — the bug #304 HR4 fixed once, on the surface.
//
// The answering surfaces own the corrected pair, both carrying
// `(expires_at is null or expires_at > now)` and both resolving the inviting
// org's name: `getPendingInvitationsForPlant` and
// `getPendingInvitationsForSendingChurch` in
// `src/app/(dashboard)/settings/association/queries.ts`. The second one had the
// SAME NAME as the copy that used to be here, which is what makes a dead copy
// worse than no copy: the next implementer greps the name, finds this module
// first because this module owns everything else about invitations, and ships
// the version without the clause. A read that no caller has and that an
// invariant forbids is not a starting point — it is a trap with a docstring.
//
// `getInvitationsSentByUser` went in the same pass, for the plainer reason: no
// caller anywhere in `src/` or `scripts/`, and it scoped by INVITER rather than
// by org, which is the scope the 2026-08-04 revoke ruling replaced everywhere
// else (`invitingOrgOf`).

/**
 * `sending_church_id = ?` or `sending_network_id = ?` — WHICH ORG issued the
 * invitation. Shared by the org-scoped list and the duplicate check so the two
 * can never disagree about what "our invitations" means.
 *
 * Both null is impossible for a row `resolveInvitationRequest` produced (each
 * role arm sets exactly one), but a hand-written row could have neither — so
 * this returns a predicate that matches NOTHING rather than `undefined`, which
 * `and()` would drop and turn the query into "every invitation in the product".
 */
function invitingOrgFilter(
  sendingChurchId: string | null,
  sendingNetworkId: string | null
): SQL {
  if (sendingChurchId) {
    return eq(organizationInvitations.sendingChurchId, sendingChurchId);
  }
  if (sendingNetworkId) {
    return eq(organizationInvitations.sendingNetworkId, sendingNetworkId);
  }
  return sql`false`;
}

/**
 * "The invitations OUR org issued" — the READ scope, and the ORG half of the
 * write one below.
 *
 * THE FK ALONE, NO SEAT (AS-007, ruling 185 (3), #500). An org Member reads
 * everything its Owner reads, and this list is one of those reads: it is the
 * org's own pending queue, on the same footing as the plants directory and the
 * health portfolio. The seat used to be in here because a sending church had
 * exactly one account, so "belongs to this org" and "is its Owner" were the
 * same row — and while that held, the read and the write could share one
 * predicate.
 *
 * An account whose FKs name no org — or name TWO — still matches nothing:
 * `oversightOrgOf` answers only for exactly one FK, and
 * `invitingOrgFilter(null, null)` is `false`.
 */
function readableOrgOf(actor: InvitationActor): SQL {
  const org = oversightOrgOf(actor);

  if (org?.type === "sending_church") {
    return invitingOrgFilter(org.id, null);
  }
  if (org?.type === "network") {
    return invitingOrgFilter(null, org.id);
  }
  return sql`false`;
}

/**
 * The same scope, plus the seat — the predicate every WRITE over this table
 * carries (the revoke and the resend).
 *
 * IT IS THE READ SCOPE AND-ED WITH THE OWNER CHECK, never a second derivation,
 * so the two can only ever differ by that one clause. The 2026-08-04 rule the
 * shared predicate protected — "a screen that shows an admin a pending
 * invitation and then refuses their Revoke" — is now kept on the OTHER side:
 * `/oversight/invitations` renders the Revoke and Resend controls only when the
 * caller holds `org.invitation.manage`, so what a reader is offered and what
 * this predicate admits still cannot disagree. The list is wider than the verbs
 * on purpose, which is what an org Member's read parity means.
 */
function invitingOrgOf(actor: InvitationActor): SQL {
  if (!isOrgOwner(actor)) return sql`false`;
  return readableOrgOf(actor);
}

/**
 * The list statement. Exported alongside `revokeInvitationQuery` so a test can
 * read both WHERE clauses and assert they carry the same ORG predicate — that
 * is the property the 2026-08-04 revoke ruling turns on, and prose cannot hold
 * it. Since #500 the revoke's carries one clause more (the Owner check); the
 * org half is still one derivation, `readableOrgOf`.
 */
export function invitationsForOrgQuery(actor: InvitationActor) {
  return db
    .select()
    .from(organizationInvitations)
    .where(readableOrgOf(actor))
    .orderBy(desc(organizationInvitations.createdAt));
}

/**
 * Every invitation the actor's ORG has issued, newest first — the read behind
 * `/oversight/invitations` (#23 / OV-003).
 *
 * Scoped to the org rather than the inviting USER: a second admin of the same
 * sending church has to see the same pending queue, or two people invite the
 * same planter twice. The scoping is also the leak guard — the WHERE names the
 * actor's own org id, which comes from the session, so there is no argument a
 * request could put another org's id into.
 *
 * Returns raw rows, not `InvitationView`, so the page can shape its own list
 * without a second query. Since 2026-08-04 the page needs nothing from
 * `inviterUserId` — any admin of the inviting org may revoke — and must still
 * not hand it to the client.
 */
export async function getInvitationsForOrg(
  actor: InvitationActor
): Promise<OrganizationInvitation[]> {
  // Nobody outside an oversight org has a queue to read, so the round trip is
  // skipped rather than made — and it is the SAME question `readableOrgOf`
  // asks, so the two cannot disagree about whose queue this is. It is
  // `isOversightUser` and not `isOrgOwner` since #500: an org MEMBER reads this
  // list in full and may change none of it (AS-007).
  if (!isOversightUser(actor)) {
    return [];
  }

  return invitationsForOrgQuery(actor);
}

/**
 * Point an OPEN invitation (one addressed to somebody with no account) at the
 * organization its invitee just created, so the ordinary accept path can run.
 *
 * This is the compare-and-set that makes an invite link SINGLE USE. The WHERE
 * requires the row to still be `pending`, unexpired, and to have NO target yet
 * — so of two registrations racing one link, exactly one binds and the loser
 * gets no row back and simply registers unassociated. `expires_at` is checked
 * here rather than trusted from the read that preceded it, and `respondedBy` is
 * set to the account that just redeemed it.
 *
 * It deliberately does NOT touch `status`: the invitation stays `pending` with
 * a target, which is precisely the state `acceptInvitationAs` expects. A crash
 * between this write and the accept therefore leaves a consistent, recoverable
 * row (pending, unbound) rather than an acceptance with no association behind
 * it — the one state nothing in the product can repair
 * (`memory/invariants.md` → Multi-Tenancy).
 */
export function bindOpenInvitationTargetQuery(
  invitationId: string,
  target: { targetChurchId?: string; targetSendingChurchId?: string },
  respondedBy: string,
  now: Date
) {
  return db
    .update(organizationInvitations)
    .set({
      targetChurchId: target.targetChurchId ?? null,
      targetSendingChurchId: target.targetSendingChurchId ?? null,
      respondedBy,
    })
    .where(
      and(
        pendingInvitation(invitationId),
        sql`${organizationInvitations.targetChurchId} is null`,
        sql`${organizationInvitations.targetSendingChurchId} is null`,
        sql`(${organizationInvitations.expiresAt} is null or ${organizationInvitations.expiresAt} > ${now})`
      )
    )
    .returning();
}

/** Run the bind. `null` means somebody else already redeemed the link. */
export async function bindOpenInvitationTarget(
  invitationId: string,
  target: { targetChurchId?: string; targetSendingChurchId?: string },
  respondedBy: string,
  now = new Date()
): Promise<OrganizationInvitation | null> {
  if (!isUuid(invitationId)) return null;

  const [updated] = await bindOpenInvitationTargetQuery(
    invitationId,
    target,
    respondedBy,
    now
  );

  return updated ?? null;
}

// ============================================================================
// Internal Helpers
// ============================================================================

/** `id = ? AND status = 'pending'` — the compare-and-set every write uses. */
function pendingInvitation(invitationId: string): SQL | undefined {
  return and(
    eq(organizationInvitations.id, invitationId),
    eq(organizationInvitations.status, "pending")
  );
}

/**
 * `EXISTS (SELECT 1 FROM organization_invitations WHERE id = ? AND status =
 * 'accepted')` — the predicate that ties the association write to the claim it
 * is batched with. Parameterized; nothing is interpolated.
 */
function claimedInvitation(invitationId: string): SQL {
  return exists(
    db
      .select({ id: organizationInvitations.id })
      .from(organizationInvitations)
      .where(
        and(
          eq(organizationInvitations.id, invitationId),
          eq(organizationInvitations.status, "accepted")
        )
      )
  );
}

/**
 * The statement that auto-expires an invitation whose window has closed.
 *
 * Exported so a test can read the bound parameters: the WHERE is the same
 * compare-and-set the responses use, so an expiry can never overwrite an answer
 * a concurrent request already recorded — two requests straddling the expiry
 * instant (a double-clicked Accept is enough) used to be able to stamp
 * `expired` over a committed `accepted` and its association. `expires_at < now`
 * is belt and braces: a row whose window was extended between the read and this
 * write is not expired either.
 */
export function expireInvitationQuery(invitationId: string, now: Date) {
  return db
    .update(organizationInvitations)
    .set({ status: "expired" })
    .where(
      and(
        pendingInvitation(invitationId),
        lt(organizationInvitations.expiresAt, now)
      )
    );
}

/**
 * Load an invitation the actor may respond to, auto-expiring it if its window
 * has closed. Throws an `InvitationError` otherwise.
 *
 * AUTHORITY FIRST, then status. The order is the security property, not a
 * style choice: these messages reach the client verbatim, so checking status
 * first turned any authenticated user with an invitation id into a reader of
 * "no such row" vs "already accepted/declined/revoked" vs "expired" vs "not
 * yours" — and invitation ids are not secrets held by the invitee alone, they
 * double as unauthenticated beta-gate bearer tokens (`hasValidInvitationBypass`
 * in `(auth)/register/beta-gate.ts`) and travel in registration links. Checking
 * status first also let any such caller TRIGGER the auto-expire write below
 * against an arbitrary invitation.
 *
 * A missing invitation answers `NOT_AUTHORIZED_MESSAGE` too — with no row there
 * is nothing to have authority over, and "not found" and "not yours" must be
 * indistinguishable for the same reason.
 */
async function loadRespondableInvitation(
  actor: InvitationActor,
  invitationId: string
): Promise<OrganizationInvitation> {
  const invitation = await getInvitation(invitationId);

  if (!invitation) {
    throw new InvitationError(NOT_AUTHORIZED_MESSAGE);
  }

  verifyInvitationAuthority(invitation, actor);

  if (invitation.status !== "pending") {
    throw new InvitationError(`Invitation is already ${invitation.status}`);
  }

  const now = new Date();
  if (invitation.expiresAt && invitation.expiresAt < now) {
    await expireInvitationQuery(invitationId, now);
    throw new InvitationError("Invitation has expired");
  }

  return invitation;
}

/**
 * The statement that creates the association, by setting the target entity's
 * FK — guarded on the invitation already reading `accepted`.
 *
 * Exported so a test can read the bound parameters: the WHERE carries the
 * `EXISTS ... status = 'accepted'` that makes this write impossible unless the
 * claim it is batched with won (see `acceptInvitationAs`). It builds a
 * statement rather than executing one for the same reason — the caller batches
 * it, so neither write can apply without the other.
 *
 * The WHERE also carries the slot rule — `(fk IS NULL OR fk = <this org>)`, the
 * same rule `unboundTargetSlot` puts on the claim: an accept may bind a free
 * slot or re-bind its own, never replace another org's (see
 * `acceptInvitationAs`). It `returning()`s the id it touched so the caller can
 * tell "bound" from "matched nothing" — the association's own rowcount, not the
 * claim's, is what gates the oversight milestone.
 *
 * A row whose FK columns contradict its `type` throws before anything is
 * written, and so does a `type` no arm knows — both in `requireAssociationPair`,
 * which is where that decision lives for every consumer of the pair. Failing
 * CLOSED on the unknown type is load-bearing rather than tidy: the switch this
 * function grew out of fell through and wrote nothing, which reads as safe but
 * was not — silence here is how an unknown type could still be marked `accepted`
 * and still announce a milestone.
 */
export function associationStatement(
  invitation: AssociationFacts,
  invitationId: string
) {
  const claimed = claimedInvitation(invitationId);
  const pair = requireAssociationPair(invitation);

  switch (pair.type) {
    case "church_to_sending_church": {
      return db
        .update(churches)
        .set({
          sendingChurchId: pair.sendingChurchId,
          updatedAt: new Date(),
        })
        .where(
          and(
            eq(churches.id, pair.targetChurchId),
            claimed,
            freeOrHolds(churches.sendingChurchId, pair.sendingChurchId)
          )
        )
        .returning({ id: churches.id });
    }

    case "church_to_network": {
      return db
        .update(churches)
        .set({
          sendingNetworkId: pair.sendingNetworkId,
          updatedAt: new Date(),
        })
        .where(
          and(
            eq(churches.id, pair.targetChurchId),
            claimed,
            freeOrHolds(churches.sendingNetworkId, pair.sendingNetworkId)
          )
        )
        .returning({ id: churches.id });
    }

    case "sending_church_to_network": {
      return db
        .update(sendingChurches)
        .set({
          sendingNetworkId: pair.sendingNetworkId,
          updatedAt: new Date(),
        })
        .where(
          and(
            eq(sendingChurches.id, pair.targetSendingChurchId),
            claimed,
            freeOrHolds(sendingChurches.sendingNetworkId, pair.sendingNetworkId)
          )
        )
        .returning({ id: sendingChurches.id });
    }
  }
}

/**
 * Verify the actor has authority over the invitation's target entity.
 * - church_to_sending_church → actor must be planter for that church
 * - sending_church_to_network → actor must be admin of the target sending church
 * - church_to_network → actor must be planter for that church
 *
 * Pure, exported, and unit-tested: this is the check that stood between an
 * anonymous POST and a stranger's association, and it can only ever be handed
 * an actor minted from a session.
 *
 * It FAILS CLOSED on an unrecognised `type`. That matters because the column is
 * a bare `varchar(40)` with a TypeScript-only `$type<>` cast
 * (`src/db/schema/organization-invitation.ts`) and `insertInvitation` validates
 * nothing, so "the type is one of three literals" is a compile-time belief, not
 * a database fact: a switch with no `default:` returned normally — authority
 * GRANTED — for `"CHURCH_TO_NETWORK"`, `"church_to_sending_church "` or
 * anything else. Making the column a pg enum or adding a CHECK constraint would
 * remove the premise, but that is DDL and a separate unit (this one has an empty
 * schema delta on purpose); noted here rather than smuggled in.
 */
export function verifyInvitationAuthority(
  invitation: Pick<
    OrganizationInvitation,
    "type" | "targetChurchId" | "targetSendingChurchId"
  >,
  actor: InvitationActor
): void {
  switch (invitation.type) {
    case "church_to_sending_church":
    case "church_to_network": {
      // The target is a church — the actor must be the OWNER of that church.
      // The seat half is not new (#265): "belongs to the church" used to be
      // enough, so any team member could bind the plant to a sending church or
      // network.
      //
      // RATIFIED 2026-08-03 (#274 (a); canon in
      // `product-docs/features/oversight/frd.md` OV-010): the Owner only.
      // Joining an oversight org is a plant-level decision and the Owner's to
      // make (AS-003), the same rule `setOversightSharingAction` applies to what
      // the plant then shares, and OV-010 pins the same rule for severing. A
      // Member or a coach of the target church may do neither — server-side,
      // not merely hidden in a UI.
      if (
        !isPlantOwner(actor) ||
        actor.churchId !== invitation.targetChurchId
      ) {
        throw new InvitationError(NOT_AUTHORIZED_MESSAGE);
      }
      break;
    }
    case "sending_church_to_network": {
      // The target is a sending church — the actor's own tenancy must BE that
      // sending church
      // The Owner seat AND the tenancy: `sending_church_admin` meant both, so
      // a Member of the target sending church is refused here exactly as it
      // was before the migration. See `isOrgOwner`.
      const actorOrg = isOrgOwner(actor) ? oversightOrgOf(actor) : null;
      if (
        actorOrg?.type !== "sending_church" ||
        actorOrg.id !== invitation.targetSendingChurchId
      ) {
        throw new InvitationError(NOT_AUTHORIZED_MESSAGE);
      }
      break;
    }
    default: {
      // Unknown type → nobody has authority over it. The `never` assignment
      // makes adding a fourth `OrganizationInvitationType` a compile error, so a
      // new type cannot silently reach the granting path.
      const unknownType: never = invitation.type;
      console.error("invitation type has no authority rule", {
        type: unknownType,
      });
      throw new InvitationError(NOT_AUTHORIZED_MESSAGE);
    }
  }
}
