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

import { and, desc, eq, exists, lt, sql, type SQL } from "drizzle-orm";
import type { AnyPgColumn } from "drizzle-orm/pg-core";

import { db } from "@/db";
import {
  churches,
  organizationInvitations,
  sendingChurches,
  users,
  type NewOrganizationInvitation,
  type OrganizationInvitation,
  type User,
  type UserRole,
} from "@/db/schema";
import type {
  OrganizationInvitationStatus,
  OrganizationInvitationType,
} from "@/db/schema/organization-invitation";
import { announceInvitationAccepted } from "@/lib/notifications/oversight";

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
  readonly role: UserRole;
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
    "id" | "role" | "churchId" | "sendingChurchId" | "sendingNetworkId"
  >;
}): InvitationActor {
  const { user } = session;
  return {
    id: user.id,
    role: user.role,
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
 * Already-taken slot, refused at CREATE time.
 *
 * RULED 2026-08-03 (#23): `createInvitation` refuses up front when the target
 * plant's oversight slot is already held, rather than letting the admin send an
 * invitation that `acceptInvitationAs` is guaranteed to refuse days later with
 * nobody watching. Defense in depth — the accept-time guard
 * (`unboundTargetSlot`) is the one that has to hold under concurrency and is
 * NOT replaced by this; this one exists so the admin is told immediately, in
 * the form. Once severing ships (#277/#278) the slot frees and the org
 * re-invites.
 */
export const SLOT_TAKEN_MESSAGE =
  "That organization already belongs to a sending church or network — it has to leave that one first";

export const ALREADY_OURS_MESSAGE =
  "That organization is already part of your organization";

export const NO_ORG_TO_INVITE_MESSAGE =
  "That account has not created its organization yet — ask them to set it up, then invite them";

export const CANNOT_INVITE_ACCOUNT_MESSAGE =
  "That account cannot be invited — invitations go to a church planter or a sending church admin";

export const KIND_MISMATCH_MESSAGE =
  "That email belongs to a different kind of organization than the one you chose";

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
 * Only oversight roles invite, and only ON BEHALF OF THEIR OWN ORG:
 * - `sending_church_admin` → invites a church plant into THEIR sending church
 * - `network_admin`        → invites a church plant, or a sending church, into
 *                            THEIR network
 *
 * The inviting org therefore comes from the session and the `type` follows from
 * the role plus WHAT is being invited. At most one target may be named, and an
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

  if (actor.role === "sending_church_admin") {
    if (!actor.sendingChurchId) {
      return { ok: false, error: "Set up your sending church first" };
    }
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

  if (actor.role === "network_admin") {
    if (!actor.sendingNetworkId) {
      return { ok: false, error: "Set up your network first" };
    }
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
 * Three outcomes:
 *   * a planter WITH a church, or (for a network admin) a sending church admin
 *     WITH a sending church → that row is the target, and the slot rule below
 *     applies to it;
 *   * no account at all → an OPEN invitation with no target. The invite link
 *     carries the token to `/register`, where the organization is created and
 *     bound in one go (`bindOpenInvitationTarget`);
 *   * an account that is neither → refused, with a message that says what kind
 *     of account can be invited.
 *
 * A planter who has not created their church yet is the third case in
 * disguise: there is no row to associate and they cannot register again, so
 * they are told to create the plant first rather than handed a dead link.
 */
export async function resolveInvitationTarget(
  actor: InvitationActor,
  inviteeEmail: string,
  inviteAs: InvitationTargetKind
): Promise<
  | {
      ok: true;
      target: Pick<
        InvitationRequest,
        "targetChurchId" | "targetSendingChurchId"
      >;
    }
  | { ok: false; error: string }
> {
  const [existing] = await db
    .select({
      role: users.role,
      churchId: users.churchId,
      sendingChurchId: users.sendingChurchId,
    })
    .from(users)
    .where(eq(users.email, inviteeEmail))
    .limit(1);

  // Nobody here yet — an open invitation, redeemed by registering.
  if (!existing) return { ok: true, target: {} };

  if (existing.role === "planter") {
    if (inviteAs !== "church") {
      return { ok: false, error: KIND_MISMATCH_MESSAGE };
    }
    if (!existing.churchId) {
      return { ok: false, error: NO_ORG_TO_INVITE_MESSAGE };
    }
    return { ok: true, target: { targetChurchId: existing.churchId } };
  }

  if (existing.role === "sending_church_admin") {
    // Only a network invites a sending church; `resolveInvitationRequest`
    // refuses it for a sending-church admin, but say so from the field the
    // admin actually filled in rather than from a type they never chose.
    if (actor.role !== "network_admin") {
      return {
        ok: false,
        error: "A sending church can only invite church plants",
      };
    }
    if (inviteAs !== "sending_church") {
      return { ok: false, error: KIND_MISMATCH_MESSAGE };
    }
    if (!existing.sendingChurchId) {
      return { ok: false, error: NO_ORG_TO_INVITE_MESSAGE };
    }
    return {
      ok: true,
      target: { targetSendingChurchId: existing.sendingChurchId },
    };
  }

  return { ok: false, error: CANNOT_INVITE_ACCOUNT_MESSAGE };
}

/**
 * The occupied-slot refusal, RULED 2026-08-03 (#23) — see `SLOT_TAKEN_MESSAGE`.
 *
 * Reads the target's own oversight FK and refuses when it is held. `null`
 * targets (an open invitation) have nothing to check: the organization does not
 * exist yet, and the accept path's guard covers it when it does.
 *
 * This is NOT the concurrency boundary and does not pretend to be one — a
 * SELECT-then-INSERT guard never is (`memory/invariants.md`). Two admins racing
 * still both get an invitation created; what stops BOTH being honoured is
 * `unboundTargetSlot` + `lockTargetRow` at accept time, which is untouched. The
 * value of this check is that the admin is told NOW, in the form, instead of
 * the invitee discovering it when they try to accept.
 */
export async function assertTargetSlotFree(
  values: ResolvedInvitation
): Promise<void> {
  const held = await heldOversightSlot(values);
  if (held === null) return;
  throw new InvitationError(
    held === "ours" ? ALREADY_OURS_MESSAGE : SLOT_TAKEN_MESSAGE
  );
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
 * Refuse a second pending invitation from the SAME org to the same address.
 * Not a concurrency guard (invariants.md) — a duplicate is a nuisance, not a
 * correctness problem, and both would still be refused at accept time by the
 * slot rule. It exists so the list stays readable.
 */
async function assertNoDuplicatePending(
  values: ResolvedInvitation
): Promise<void> {
  const [duplicate] = await db
    .select({ id: organizationInvitations.id })
    .from(organizationInvitations)
    .where(
      and(
        eq(organizationInvitations.status, "pending"),
        eq(organizationInvitations.inviteeEmail, values.inviteeEmail),
        invitingOrgFilter(values.sendingChurchId, values.sendingNetworkId)
      )
    )
    .limit(1);

  if (duplicate) {
    throw new InvitationError(
      "There is already a pending invitation to that address — revoke it first"
    );
  }
}

/** Resolve + guard + insert. The path the action layer takes. */
export async function createInvitationAs(
  actor: InvitationActor,
  request: InvitationRequest
): Promise<OrganizationInvitation> {
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

  // A client never names a target; it is resolved from the address here.
  const resolvedTarget = await resolveInvitationTarget(
    actor,
    inviteeEmail,
    inviteAs
  );
  if (!resolvedTarget.ok) {
    throw new InvitationError(resolvedTarget.error);
  }

  const resolved = resolveInvitationRequest(actor, {
    ...request,
    inviteeEmail,
    ...resolvedTarget.target,
  });
  if (!resolved.ok) {
    throw new InvitationError(resolved.error);
  }

  await assertTargetSlotFree(resolved.values);
  await assertNoDuplicatePending(resolved.values);

  return insertInvitation(resolved.values);
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

  // All three built BEFORE anything is written, so an invitation whose FKs
  // contradict its `type` throws instead of half-applying.
  const lock = lockTargetRow(invitation);
  const association = associationStatement(invitation, invitationId);
  const slotIsOurs = unboundTargetSlot(invitation);

  const [, claimed, associated] = await db.batch([
    lock,
    respondToInvitationQuery(actor, invitationId, "accepted", slotIsOurs),
    association,
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
  // Atomicity). `announceInvitationAccepted` never throws and never decides
  // whether the plant is sharing — `enqueue` does, per recipient, and writes
  // nothing when it is not.
  //
  // Only a PLANT-side acceptance is a milestone: `target_church_id` is set when
  // a sending church or a network invited a church plant, which is the "planter
  // accepted invitation" the ruling names. A sending church joining a network
  // is a different event with no plant to report on.
  if (updated.targetChurchId) {
    await announceInvitationAcceptedForChurch(updated);
  }

  return updated;
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
    const [plant] = await db
      .select({ name: churches.name })
      .from(churches)
      .where(eq(churches.id, churchId))
      .limit(1);

    if (!plant) return;

    await announceInvitationAccepted({
      churchId,
      plantName: plant.name,
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
 * Decline an invitation. The actor must have authority over the target entity.
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

  return updated;
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
 * Throws on a row whose FK columns contradict its `type`, and fails CLOSED on a
 * `type` no arm knows — the same two rules as `associationStatement`, for the
 * same reason.
 */
export function unboundTargetSlot(invitation: AssociationFacts): SQL {
  switch (invitation.type) {
    case "church_to_sending_church": {
      if (!invitation.targetChurchId || !invitation.sendingChurchId) {
        throw new InvitationError(
          "Invalid invitation: missing church or sending church"
        );
      }
      return exists(
        db
          .select({ id: churches.id })
          .from(churches)
          .where(
            and(
              eq(churches.id, invitation.targetChurchId),
              freeOrHolds(churches.sendingChurchId, invitation.sendingChurchId)
            )
          )
      );
    }

    case "church_to_network": {
      if (!invitation.targetChurchId || !invitation.sendingNetworkId) {
        throw new InvitationError(
          "Invalid invitation: missing church or network"
        );
      }
      return exists(
        db
          .select({ id: churches.id })
          .from(churches)
          .where(
            and(
              eq(churches.id, invitation.targetChurchId),
              freeOrHolds(
                churches.sendingNetworkId,
                invitation.sendingNetworkId
              )
            )
          )
      );
    }

    case "sending_church_to_network": {
      if (!invitation.targetSendingChurchId || !invitation.sendingNetworkId) {
        throw new InvitationError(
          "Invalid invitation: missing sending church or network"
        );
      }
      return exists(
        db
          .select({ id: sendingChurches.id })
          .from(sendingChurches)
          .where(
            and(
              eq(sendingChurches.id, invitation.targetSendingChurchId),
              freeOrHolds(
                sendingChurches.sendingNetworkId,
                invitation.sendingNetworkId
              )
            )
          )
      );
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
 * The statement that revokes an invitation. Exported so a test can read the
 * bound parameters: the inviter in the WHERE clause is the SESSION's user, and
 * nothing a client sent can put another id there.
 */
export function revokeInvitationQuery(
  actor: InvitationActor,
  invitationId: string
) {
  return db
    .update(organizationInvitations)
    .set({ status: "revoked" })
    .where(
      and(
        pendingInvitation(invitationId),
        eq(organizationInvitations.inviterUserId, actor.id)
      )
    )
    .returning();
}

/**
 * Revoke a pending invitation. Only the original inviter can revoke, and the
 * inviter is the actor — the check is part of the UPDATE, so a non-inviter
 * matches no row and writes nothing.
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
      "Invitation not found, not pending, or you are not the inviter"
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
// Until #277/#278 land, an accepted association has no in-product repair path.
// That is why `acceptInvitationAs` above must never be able to create one that
// was not accepted, and why it REFUSES to replace one that already exists
// (`memory/invariants.md` → Multi-Tenancy).
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

/**
 * Get pending invitations for a church plant (as target).
 */
export async function getPendingInvitationsForChurch(
  churchId: string
): Promise<OrganizationInvitation[]> {
  return db
    .select()
    .from(organizationInvitations)
    .where(
      and(
        eq(organizationInvitations.targetChurchId, churchId),
        eq(organizationInvitations.status, "pending")
      )
    )
    .orderBy(desc(organizationInvitations.createdAt));
}

/**
 * Get pending invitations for a sending church (as target).
 */
export async function getPendingInvitationsForSendingChurch(
  sendingChurchId: string
): Promise<OrganizationInvitation[]> {
  return db
    .select()
    .from(organizationInvitations)
    .where(
      and(
        eq(organizationInvitations.targetSendingChurchId, sendingChurchId),
        eq(organizationInvitations.status, "pending")
      )
    )
    .orderBy(desc(organizationInvitations.createdAt));
}

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
 * Every invitation the actor's ORG has issued, newest first — the read behind
 * `/oversight/invitations` (#23 / OV-003).
 *
 * Scoped to the org rather than the inviting USER: a second admin of the same
 * sending church has to see the same pending queue, or two people invite the
 * same planter twice. The scoping is also the leak guard — the WHERE names the
 * actor's own org id, which comes from the session, so there is no argument a
 * request could put another org's id into.
 *
 * Returns raw rows, not `InvitationView`: the caller is a Server Component that
 * needs `inviterUserId` to decide whether to render a Revoke button (only the
 * inviter may revoke) and must not pass that id to the client.
 */
export async function getInvitationsForOrg(
  actor: InvitationActor
): Promise<OrganizationInvitation[]> {
  if (actor.role === "sending_church_admin") {
    if (!actor.sendingChurchId) return [];
    return db
      .select()
      .from(organizationInvitations)
      .where(invitingOrgFilter(actor.sendingChurchId, null))
      .orderBy(desc(organizationInvitations.createdAt));
  }

  if (actor.role === "network_admin") {
    if (!actor.sendingNetworkId) return [];
    return db
      .select()
      .from(organizationInvitations)
      .where(invitingOrgFilter(null, actor.sendingNetworkId))
      .orderBy(desc(organizationInvitations.createdAt));
  }

  // No other role issues invitations, so no other role has any to list.
  return [];
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

/**
 * Get all invitations sent by a user (for tracking sent invitations).
 */
export async function getInvitationsSentByUser(
  userId: string
): Promise<OrganizationInvitation[]> {
  return db
    .select()
    .from(organizationInvitations)
    .where(eq(organizationInvitations.inviterUserId, userId))
    .orderBy(desc(organizationInvitations.createdAt));
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
 * A row whose FK columns contradict its `type` throws here, before anything is
 * written.
 */
export function associationStatement(
  invitation: AssociationFacts,
  invitationId: string
) {
  const claimed = claimedInvitation(invitationId);

  switch (invitation.type) {
    case "church_to_sending_church": {
      if (!invitation.targetChurchId || !invitation.sendingChurchId) {
        throw new InvitationError(
          "Invalid invitation: missing church or sending church"
        );
      }
      return db
        .update(churches)
        .set({
          sendingChurchId: invitation.sendingChurchId,
          updatedAt: new Date(),
        })
        .where(
          and(
            eq(churches.id, invitation.targetChurchId),
            claimed,
            freeOrHolds(churches.sendingChurchId, invitation.sendingChurchId)
          )
        )
        .returning({ id: churches.id });
    }

    case "church_to_network": {
      if (!invitation.targetChurchId || !invitation.sendingNetworkId) {
        throw new InvitationError(
          "Invalid invitation: missing church or network"
        );
      }
      return db
        .update(churches)
        .set({
          sendingNetworkId: invitation.sendingNetworkId,
          updatedAt: new Date(),
        })
        .where(
          and(
            eq(churches.id, invitation.targetChurchId),
            claimed,
            freeOrHolds(churches.sendingNetworkId, invitation.sendingNetworkId)
          )
        )
        .returning({ id: churches.id });
    }

    case "sending_church_to_network": {
      if (!invitation.targetSendingChurchId || !invitation.sendingNetworkId) {
        throw new InvitationError(
          "Invalid invitation: missing sending church or network"
        );
      }
      return db
        .update(sendingChurches)
        .set({
          sendingNetworkId: invitation.sendingNetworkId,
          updatedAt: new Date(),
        })
        .where(
          and(
            eq(sendingChurches.id, invitation.targetSendingChurchId),
            claimed,
            freeOrHolds(
              sendingChurches.sendingNetworkId,
              invitation.sendingNetworkId
            )
          )
        )
        .returning({ id: sendingChurches.id });
    }

    default: {
      // Fail CLOSED on a `type` this switch does not know. The old switch fell
      // through and wrote nothing, which reads as safe but was not: silence
      // here is why an unknown type could still be marked `accepted` and still
      // announce a milestone. The `never` makes a fourth
      // `OrganizationInvitationType` a compile error rather than a silent arm.
      const unknownType: never = invitation.type;
      console.error("invitation type has no association rule", {
        invitationId,
        type: unknownType,
      });
      throw new InvitationError(NOT_AUTHORIZED_MESSAGE);
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
      // The target is a church — the actor must be the planter for that church.
      // The role check is new (#265): "belongs to the church" used to be enough,
      // so any team member could bind the plant to a sending church or network.
      //
      // RATIFIED 2026-08-03 (#274 (a); canon in
      // `product-docs/features/oversight/frd.md` OV-010): planter only. Joining
      // an oversight org is a plant-level decision and the planter's to make,
      // the same rule `setOversightSharingAction` applies to what the plant then
      // shares, and OV-010 pins the same rule for severing. A `team_member` or
      // `coach` of the target church may do neither — server-side, not merely
      // hidden in a UI.
      if (
        actor.role !== "planter" ||
        !actor.churchId ||
        actor.churchId !== invitation.targetChurchId
      ) {
        throw new InvitationError(NOT_AUTHORIZED_MESSAGE);
      }
      break;
    }
    case "sending_church_to_network": {
      // The target is a sending church — the actor must be admin of that
      // sending church
      if (
        actor.role !== "sending_church_admin" ||
        !actor.sendingChurchId ||
        actor.sendingChurchId !== invitation.targetSendingChurchId
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
