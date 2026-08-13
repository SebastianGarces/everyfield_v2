import { and, eq, ne, sql } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/db";
import {
  notificationCategories,
  notificationEntityTypes,
  notifications,
  users,
  type NewNotification,
  type Notification,
  type NotificationCategory,
  type User,
} from "@/db/schema";
import {
  canAccessChurch,
  canAccessFeatureData,
  isOversightUser,
} from "@/lib/auth/access";

import { OVERSIGHT_ADMIN } from "./oversight-admin";

import {
  churchAnchor,
  toAnchorColumns,
  type NotificationAnchor,
  type OrgAnchor,
} from "./anchor";
import {
  isOwnRelationshipType,
  OVERSIGHT_SHARING_FEATURE,
  oversightGateFor,
} from "./categories";
import { orgHasRecordedRelationshipWithChurch } from "./oversight-relationship";

// ============================================================================
// The enqueue contract (N-001, N-002, N-011).
//
// This module is the whole public surface a feature needs to adopt F11:
//
//   enqueue(input)          record a pending notification. Never sends.
//   cancelByEntity(input)   the subject went away — do not announce it.
//
// Four rules it exists to keep:
//
//   1. Enqueue is NEVER a synchronous send (N-002). Nothing in this file's
//      import graph reaches an email provider; delivery is the dispatcher's
//      job, and it is a separate unit. A caller returns as soon as the row is
//      recorded.
//   2. `dedupeKey` is idempotent (N-001) PER RECIPIENT, and only among LIVE
//      rows. Idempotency is enforced by the partial unique index on
//      (church_id, recipient_user_id, dedupe_key) WHERE dedupe_key IS NOT NULL
//      AND status <> 'cancelled', via ON CONFLICT DO NOTHING — not by a
//      SELECT-then-INSERT guard, which two concurrent enqueues would both pass
//      (memory/invariants.md → Atomicity). The recipient belongs in that key
//      because the natural caller for a fan-out ("remind all six attendees")
//      composes ONE key per event and loops the recipients; without it,
//      attendee #1 would silently swallow #2..N. The liveness term belongs in
//      it because N-011 defines reschedule as cancel + re-enqueue: a cancelled
//      row that kept reserving its key would swallow the notification that
//      replaces it (migration 0025).
//   3. The recipient must be ALLOWED to be told. Three separate facts, all
//      checked here rather than assumed of the caller — see
//      `recipientMayBeNotified`:
//        a. they can access the church the row is filed under — or, for the
//           two own-relationship events of #304 alone, this org and this plant
//           have a relationship ON RECORD (an invitation, or an
//           `association_events` row). Those two report the END of a
//           relationship, so current access is false by construction; see the
//           branch itself and `OVERSIGHT_OWN_RELATIONSHIP_TYPES`,
//        b. if they are an oversight user, the category is one oversight may
//           receive at all — `milestones` or `digest`, never the granular
//           per-event stream (N-025), and
//        c. if they are an oversight user, the plant has turned on the single
//           sharing toggle (N-026) — UNLESS the notification's `type` is one of
//           the consent-exempt few (`OVERSIGHT_SHARING_EXEMPT_TYPES`, ruled
//           2026-08-01), which today is the invitation-accepted milestone
//           alone: the sending church's own event, not a disclosure about the
//           plant. Note the ordering — (b) is still asked first, so the
//           exemption can only relax the CONSENT question and can never let a
//           granular category through.
//      A recipient who fails any is SKIPPED, not thrown over: `enqueue`
//      returns `{status: "skipped", reason}` and writes nothing for them. The
//      natural caller is a fan-out ("remind all six attendees"), and a throw
//      there aborts the loop mid-way with rows already written for recipients
//      1..n-1 — so a meeting action would fail, and half-notify, because of one
//      recipient's notification permission. Skipping keeps the refusal total
//      for that recipient (no row, ever) while the other five still get theirs,
//      and the reason is in the return value rather than in an exception the
//      caller has to know to catch. Nothing is silent: a skip is a value the
//      caller can see, count and log.
//   4. `entityType`/`entityId` must be derived SERVER-SIDE from an entity the
//      actor is already authorised to mutate — never forwarded from request
//      input. `cancelByEntity` is a denial primitive that spans every recipient
//      in a church: given a forwarded (type, id) pair, any member could
//      suppress everyone else's pending notifications about that entity,
//      including delivery failures and financial alerts. The closed
//      `notificationEntityTypes` tuple narrows the target space; it does not
//      substitute for deriving the id.
//
// The orchestration is separated from its database access (`EnqueueDeps`,
// `CancelByEntityDeps`) so the ordering rules above are testable without a live
// Postgres. `enqueue`/`cancelByEntity` are the wired-up production entrypoints.
// ============================================================================

// ----------------------------------------------------------------------------
// Validation
// ----------------------------------------------------------------------------

export const enqueueNotificationSchema = z
  .object({
    /**
     * Tenancy, the PLANT case. Verified against the recipient's own access, not
     * trusted.
     *
     * Optional since #304 WS3 only because it is one of two anchors — see
     * `anchorOrg` and the refinement below, which together make "exactly one"
     * a parse error rather than a database error. Every pre-existing caller
     * passes this and is unchanged.
     */
    churchId: z.string().uuid().optional(),
    /**
     * Tenancy, the ORG case (#304 WS3, ruling #351): a notification about a
     * SENDING CHURCH's own network membership, which names no plant.
     *
     * A nested object rather than two loose fields, so a caller cannot supply an
     * id without saying which kind of org it is.
     */
    anchorOrg: z
      .object({
        type: z.enum(["sending_church", "network"]),
        orgId: z.string().uuid(),
      })
      .optional(),
    /** A user, never a bare address — a `person` with no login is not a recipient. */
    recipientUserId: z.string().uuid(),
    category: z.enum(notificationCategories),
    /** Caller-defined discriminator within the category, e.g. `task.overdue`. */
    type: z.string().trim().min(1).max(64),
    /** Rendered by the caller. F11 does not template feature content. */
    title: z.string().trim().min(1).max(255),
    body: z.string().trim().min(1),
    /** Closed set — see `notificationEntityTypes` and rule 4 in the header. */
    entityType: z.enum(notificationEntityTypes).optional(),
    entityId: z.string().uuid().optional(),
    dedupeKey: z.string().trim().min(1).max(255).optional(),
    /** When it becomes eligible for dispatch. Defaults to now. */
    scheduledFor: z.date().optional(),
  })
  .refine(
    (value) =>
      (value.entityType === undefined) === (value.entityId === undefined),
    {
      message:
        "entityType and entityId must be provided together — a half-reference cannot be cancelled or linked",
      path: ["entityId"],
    }
  )
  // EXACTLY ONE ANCHOR, at the boundary. The database says the same thing
  // (`notifications_anchor_check`), and both are wanted: this one turns a
  // caller's mistake into a legible parse error at the call site, rather than a
  // constraint violation three layers down with no field name in it.
  .refine(
    (value) =>
      (value.churchId === undefined) !== (value.anchorOrg === undefined),
    {
      message:
        "a notification is anchored to exactly one tenant — pass churchId or anchorOrg, never both and never neither",
      path: ["churchId"],
    }
  );

export type EnqueueNotificationInput = z.input<
  typeof enqueueNotificationSchema
>;

/**
 * The anchor a parsed input describes. Total by construction — the refinement
 * above has already rejected "neither" and "both".
 */
function anchorOf(parsed: {
  churchId?: string;
  anchorOrg?: { type: "sending_church" | "network"; orgId: string };
}): NotificationAnchor {
  if (parsed.churchId) return churchAnchor(parsed.churchId);
  if (parsed.anchorOrg) {
    return { type: parsed.anchorOrg.type, orgId: parsed.anchorOrg.orgId };
  }
  // Unreachable through `enqueueNotificationSchema.parse`; a loud throw rather
  // than a guessed tenant if some future caller bypasses it.
  throw new Error("enqueue: a notification with no anchor");
}

/**
 * Cancel-by-entity input.
 *
 * `entityType` is a code-defined value, not free text, and `entityId` must be
 * derived server-side from an entity the actor may already mutate (header rule
 * 4). This is a church-wide, cross-recipient write: the pair it is handed is
 * the whole of its aim.
 */
export const cancelByEntitySchema = z.object({
  churchId: z.string().uuid(),
  entityType: z.enum(notificationEntityTypes),
  entityId: z.string().uuid(),
  /** Narrow the cancellation to one category; omit to cancel all of them. */
  category: z.enum(notificationCategories).optional(),
});

export type CancelByEntityInput = z.infer<typeof cancelByEntitySchema>;

// ----------------------------------------------------------------------------
// Results + seams
// ----------------------------------------------------------------------------

/**
 * The outcome for ONE recipient — the grain `enqueue` works at, since a
 * fan-out is a caller-side loop over single-recipient calls.
 *
 * A discriminated union rather than a nullable field, so a caller cannot read
 * `notification` off a skip without the compiler making them check `status`
 * first. `created` is present on both arms so the common "did this write
 * anything?" question needs no narrowing.
 */
export type EnqueueResult =
  | {
      /** A row exists for this recipient — this call's, or an earlier one's. */
      status: "recorded";
      /**
       * The recorded notification — the freshly inserted row, or the one an
       * earlier call with the same `dedupeKey` already created. Null only if
       * that earlier row was deleted between the conflicting insert and the
       * read-back.
       */
      notification: Notification | null;
      /** False when the dedupe key collapsed this call into an existing row. */
      created: boolean;
      reason: null;
    }
  | {
      /** Nothing was written for this recipient, and nothing will be. */
      status: "skipped";
      notification: null;
      created: false;
      /** Which of the two refusals applied. */
      reason: RecipientRefusal;
    };

/**
 * Why a recipient was refused — a reason rather than a bare boolean, so the two
 * refusals stay distinguishable in the return value and in a log. They are
 * genuinely different facts: one is a tenancy mismatch, the other is what the
 * oversight model allows (a category oversight never receives, or a plant
 * exercising a privacy choice it is entitled to).
 *
 * Both produce a skip rather than a throw (header rule 3). `outside_church` is
 * not always a caller bug: a user whose church changed between the moment the
 * recipient list was built and the moment enqueue ran is a race, not a defect,
 * and aborting a whole fan-out over it would be the wrong answer. The tenancy
 * protection is unaffected either way — the row is never written.
 */
export type RecipientRefusal = "outside_church" | "oversight_privacy";

/** A skipped outcome, built in one place so both refusals stay identical. */
function skipped(reason: RecipientRefusal): EnqueueResult {
  return { status: "skipped", notification: null, created: false, reason };
}

export type RecipientCheck =
  | { allowed: true }
  | { allowed: false; reason: RecipientRefusal };

/**
 * What the recipient gate is asked about. An OBJECT, not four positional
 * strings: two of them are uuids and two are free-form, so a transposed pair
 * would type-check and silently gate the wrong thing.
 */
export interface RecipientNotifiableInput {
  /**
   * WHICH TENANT the row would be filed under, as a discriminated union rather
   * than a church id (#304 WS3). Gate 1 asks a genuinely different question of
   * each arm — "can this user reach that plant?" versus "is this user an admin
   * OF that org?" — and a bare id could be handed to the wrong one.
   */
  anchor: NotificationAnchor;
  recipientUserId: string;
  category: NotificationCategory;
  /** The caller's discriminator — read only by the consent exemption (gate 3). */
  type: string;
}

export interface EnqueueDeps {
  /**
   * May this user be told about this notification, in this church?
   *
   * THREE gates, resolved against the same `src/lib/auth/access.ts` the rest of
   * the app authorises reads with:
   *
   *   1. `canAccessChurch` — a caller that derived `recipientUserId` from
   *      request input cannot file a notification for a stranger into a tenant
   *      they do not belong to.
   *   2. For OVERSIGHT recipients, `isOversightEligibleCategory` — the
   *      oversight model (N-025) is a digest plus three milestones, so a
   *      granular category is refused for them unconditionally.
   *   3. For OVERSIGHT recipients, `canAccessFeatureData` on the single
   *      sharing toggle (N-026) — because (1) alone returns true for a network
   *      admin on every plant in the network, whatever the plant decided —
   *      UNLESS `type` is consent-exempt (`isOversightSharingExemptType`).
   *
   * `category` is the parameter for gate (2); `type` is the parameter for gate
   * (3)'s exemption and is read nowhere else. The ORDER is the safety property:
   * (2) before (3), so an exempt type can only ever skip the consent question
   * and can never promote a granular category into oversight's reach.
   */
  recipientMayBeNotified(
    input: RecipientNotifiableInput
  ): Promise<RecipientCheck>;
  /**
   * `INSERT ... ON CONFLICT (church_id, recipient_user_id, dedupe_key)
   * WHERE dedupe_key IS NOT NULL AND status <> 'cancelled' DO NOTHING
   * RETURNING *`. Resolves to null — never throws — when a LIVE row already
   * holds the key for that recipient.
   */
  insertIfAbsent(row: NewNotification): Promise<Notification | null>;
  /**
   * Church- AND recipient-scoped read-back of the LIVE row that won a dedupe
   * race. Must apply the same liveness filter as the index, or a genuine dedupe
   * hit could hand back a cancelled row.
   */
  findByDedupeKey(
    anchor: NotificationAnchor,
    recipientUserId: string,
    dedupeKey: string
  ): Promise<Notification | null>;
}

export interface CancelByEntityResult {
  cancelledCount: number;
  cancelledIds: string[];
}

export interface CancelByEntityDeps {
  /**
   * Move every PENDING notification for the entity to `cancelled` and return
   * the rows it touched. Resolves to an empty array when nothing matched.
   */
  cancelPending(input: CancelByEntityInput): Promise<{ id: string }[]>;
}

// ----------------------------------------------------------------------------
// Orchestration
// ----------------------------------------------------------------------------

/**
 * Record a pending notification. Makes no provider call, by construction.
 *
 * Idempotent on `dedupeKey` PER RECIPIENT and among LIVE rows: a second call
 * with the same key for the same user returns the first call's notification
 * with `created: false` and writes nothing, while the same key for a different
 * user records its own row — and a key whose only holder was CANCELLED is free
 * again, so cancel + re-enqueue (N-011 reschedule, and reopen) records a new
 * pending row instead of being silently swallowed.
 *
 * A recipient who may not be told is SKIPPED, not thrown over: the call
 * resolves to `{status: "skipped", reason}` having written nothing, so one
 * barred recipient in a fan-out costs that recipient their notification and
 * nobody else theirs. `reason` says which refusal applied —
 * `"outside_church"` (no access to the church) or `"oversight_privacy"` (an
 * oversight user asked to be told something the oversight model does not give
 * them, or whose plant has not turned sharing on). Both are checked here rather
 * than left to a comment about what callers have supposedly already done.
 *
 * The only things that still throw are a malformed input (the Zod parse, a
 * programming error at the boundary) and a dependency that misreports a
 * conflict — neither is a per-recipient outcome.
 */
export async function runEnqueue(
  deps: EnqueueDeps,
  input: EnqueueNotificationInput
): Promise<EnqueueResult> {
  const parsed = enqueueNotificationSchema.parse(input);
  const anchor = anchorOf(parsed);

  const check = await deps.recipientMayBeNotified({
    anchor,
    recipientUserId: parsed.recipientUserId,
    category: parsed.category,
    type: parsed.type,
  });
  if (!check.allowed) {
    return skipped(check.reason);
  }

  const row: NewNotification = {
    // The union becomes columns exactly once (`toAnchorColumns`), so the
    // "exactly one anchor" CHECK is satisfied by construction.
    ...toAnchorColumns(anchor),
    recipientUserId: parsed.recipientUserId,
    category: parsed.category,
    type: parsed.type,
    title: parsed.title,
    body: parsed.body,
    entityType: parsed.entityType ?? null,
    entityId: parsed.entityId ?? null,
    dedupeKey: parsed.dedupeKey ?? null,
    // Absent means "eligible now"; the column defaults to now() too, but being
    // explicit keeps the enqueued instant and the returned row in agreement.
    scheduledFor: parsed.scheduledFor ?? new Date(),
    status: "pending",
  };

  const inserted = await deps.insertIfAbsent(row);
  if (inserted) {
    return {
      status: "recorded",
      notification: inserted,
      created: true,
      reason: null,
    };
  }

  // A conflict is only reachable through the dedupe-key index, so reaching here
  // without a key means the deps lied about why the insert produced no row.
  if (!parsed.dedupeKey) {
    throw new Error(
      "enqueue: insert produced no row for a notification with no dedupeKey"
    );
  }

  const existing = await deps.findByDedupeKey(
    anchor,
    parsed.recipientUserId,
    parsed.dedupeKey
  );
  return {
    status: "recorded",
    notification: existing,
    created: false,
    reason: null,
  };
}

/**
 * Cancel pending notifications about an entity (N-011). Reschedule is
 * cancel + re-enqueue.
 *
 * Safe to call when nothing is pending: it resolves to zero and touches no rows
 * rather than throwing, so a delete path never has to know whether the entity
 * ever had a notification.
 *
 * Only `pending` rows are cancelled. A row a dispatcher has already claimed is
 * mid-flight and belongs to that run; N-014's still-live re-check is what stops
 * it, not a racing UPDATE.
 *
 * Cancelling RELEASES the row's `dedupeKey` for a later enqueue — not by
 * clearing the column (the key stays, so the audit trail survives) but because
 * the unique index is partial on `status <> 'cancelled'` (migration 0025). That
 * is what makes "reschedule is cancel + re-enqueue" actually work.
 *
 * `churchId` scopes it, but nothing here scopes it to a RECIPIENT: this is a
 * church-wide write by design (the meeting moved for everyone). It is therefore
 * a denial primitive, and header rule 4 applies — derive the entity pair
 * server-side, never from request input.
 */
export async function runCancelByEntity(
  deps: CancelByEntityDeps,
  input: CancelByEntityInput
): Promise<CancelByEntityResult> {
  const parsed = cancelByEntitySchema.parse(input);
  const cancelled = await deps.cancelPending(parsed);

  return {
    cancelledCount: cancelled.length,
    cancelledIds: cancelled.map((row) => row.id),
  };
}

// ----------------------------------------------------------------------------
// Production wiring
// ----------------------------------------------------------------------------

/**
 * Exactly the columns `canAccessChurch`/`canAccessFeatureData` consume.
 *
 * A projection rather than `select()`: answering a boolean must not pull the
 * Argon2 `password_hash` into application memory, where the next error capture,
 * Sentry breadcrumb or debug throw that serialises a failed enqueue's locals
 * would ship it off-box.
 */
const accessColumns = {
  id: users.id,
  role: users.role,
  churchId: users.churchId,
  sendingChurchId: users.sendingChurchId,
  sendingNetworkId: users.sendingNetworkId,
};

/**
 * IS THIS RECIPIENT AN ADMIN OF THIS ORG? — gate 1 for an ORG-ANCHORED row
 * (#304 WS3).
 *
 * The church arm of gate 1 asks `canAccessChurch`, which resolves an oversight
 * admin's reach THROUGH a plant's FKs. An org-anchored notification has no
 * plant, so there is nothing for that question to traverse, and the honest
 * question is the direct one: does this user's own org FK name the org the row
 * is filed under, and is their role an oversight one?
 *
 * Both halves matter. Without the ROLE check a `team_member` carrying a stray
 * `sending_church_id` would qualify; without the ID check every oversight admin
 * in the product would. It is deliberately NOT a hierarchy walk — a network
 * admin does not receive a sending church's own notifications, because the
 * notification is filed under the SENDING CHURCH and the network is a different
 * tenant (the same rule that keeps a plant's rows out of its network's feed).
 *
 * BOTH HALVES COME FROM `OVERSIGHT_ADMIN` (`./oversight-admin.ts`), NOT FROM
 * LITERALS HERE — the role AND the `users` column that carries that kind of
 * org. That file's header says why the pairing is one table; the consequence
 * here is that there is no `anchor.type === …` branch left to forget, and that
 * the role test subsumes `isOversightUser` (every row in the table names an
 * oversight role, so a separate floor could only re-admit what this line
 * already required).
 *
 * Pure, and exported so it can be tested over the whole role × org domain.
 */
export function recipientAdministersOrg(
  recipient: User,
  anchor: OrgAnchor
): boolean {
  const { role, fk } = OVERSIGHT_ADMIN[anchor.type];

  return recipient.role === role && recipient[fk] === anchor.orgId;
}

export const dbEnqueueDeps: EnqueueDeps = {
  async recipientMayBeNotified({ anchor, recipientUserId, category, type }) {
    const [projected] = await db
      .select(accessColumns)
      .from(users)
      .where(eq(users.id, recipientUserId))
      .limit(1);

    if (!projected) return { allowed: false, reason: "outside_church" };

    // The access helpers take a `User`; this row IS one, minus the columns
    // neither of them reads. The cast is what keeps `password_hash` out of the
    // query rather than out of the way.
    const recipient = projected as User;

    // ------------------------------------------------------------------------
    // THE ORG-ANCHORED ARM (#304 WS3, ruling #351) — a whole, separate gate.
    //
    // It returns before the church gates rather than weaving into them, and
    // that is the safety property: none of the three questions below has an
    // honest answer for a row with no plant. `canAccessChurch` has no church to
    // resolve; `canAccessFeatureData` would read a privacy toggle belonging to
    // a plant that is not the subject; and the recorded-relationship fallback
    // (`OVERSIGHT_OWN_RELATIONSHIP_TYPES`) exists precisely to substitute for a
    // plant FK that has just been nulled — which is not what happened here.
    //
    // What it asks instead: the recipient administers THIS org (tenancy), and
    // the category is one oversight may receive at all (N-025, unchanged).
    // Consent has no third party to come from — there is no plant to have
    // opted in — so a category that REQUIRES sharing is refused outright rather
    // than approximated. Today only the three consent-exempt own-relationship
    // milestones are org-anchored, so that refusal is a fail-closed floor and
    // not a live path.
    // ------------------------------------------------------------------------
    if (anchor.type !== "church") {
      if (!recipientAdministersOrg(recipient, anchor)) {
        return { allowed: false, reason: "outside_church" };
      }

      const gate = oversightGateFor(category, type);
      if (gate !== "exempt") {
        return { allowed: false, reason: "oversight_privacy" };
      }

      return { allowed: true };
    }

    const churchId = anchor.churchId;

    // Gate 1 — the SAME resolution the rest of the app authorises reads with,
    // so "may be notified about this church" and "may see this church" cannot
    // drift apart: a coach reached via coach_assignments qualifies, a planter
    // in another plant does not.
    if (!(await canAccessChurch(recipient, churchId))) {
      // ...with ONE alternative basis, for the two events that END an org's
      // relationship with a plant (#304, OV-006/OV-007). Both are structurally
      // unreachable through the check above — a declined invitation never put
      // the plant in the org's scope, and a sever takes it out in the very write
      // being announced — so composing them under the plant's `church_id`, which
      // is the only tenant an event about a plant can be filed under, would skip
      // them every time and the org would never learn its own relationship had
      // changed. See `OVERSIGHT_OWN_RELATIONSHIP_TYPES` in ./categories.ts.
      //
      // NOT a bypass, and the ordering says so. `type` must be one of two
      // server-composed literals (no caller-supplied string reaches this list),
      // the recipient must be an oversight user with an org of their own, and
      // there must be a RECORD in the database of a relationship between that
      // org and this plant — an invitation, or an `association_events` row. An
      // org with none of that is refused with the same `outside_church` it was
      // refused with before, and every other notification type in the product
      // — including the two gated milestones and the digest — cannot reach this
      // branch at all.
      //
      // AND THE ORG IS PAIRED TO THE ROLE (#304 round 8). `recipient` is a
      // whole `users` row and both oversight FKs live on it, so the probe used
      // to OR them together and a `network_admin` carrying a stray
      // `sending_church_id` could rest on an invitation THAT sending church
      // issued — the same hierarchy walk `recipientAdministersOrg` refuses one
      // arm up. `orgHasRecordedRelationshipWithChurch` now takes the recipient
      // rather than a pair of ids and pairs them itself, so there is no shape a
      // call site could get wrong.
      const mayRestOnRecord =
        isOwnRelationshipType(type) &&
        isOversightUser(recipient) &&
        (await orgHasRecordedRelationshipWithChurch(recipient, churchId));

      if (!mayRestOnRecord) {
        return { allowed: false, reason: "outside_church" };
      }
    }

    if (isOversightUser(recipient)) {
      // Gates 2 and 3 as one question, asked in that order. `oversightGateFor`
      // decides the MODEL first (N-025: a granular per-event category is
      // refused with sharing on and with sharing off alike), and only then
      // whether this particular `type` is consent-exempt. Both answers come
      // from already-loaded data, so a granular fan-out that happens to include
      // an oversight user costs no extra round trip.
      const gate = oversightGateFor(category, type);

      if (gate === "denied") {
        return { allowed: false, reason: "oversight_privacy" };
      }

      // Gate 3 — the plant's consent, and it is a SEPARATE gate from (1).
      // `canAccessChurch` returns true for a sending-church or network admin on
      // every plant beneath them, unconditionally; memory/invariants.md →
      // Hierarchical Access Control says those users see aggregate metrics
      // only, subject to the plant's opt-in `church_privacy_settings`. Read at
      // ENQUEUE time, every time — that is what makes a toggle flipped this
      // morning take effect on this afternoon's digest rather than on the next
      // deploy.
      //
      // `exempt` skips exactly THIS check and nothing above it. The recipient
      // has already cleared `canAccessChurch` and the category allow-list, so
      // an exemption can never reach a stranger's tenant nor widen what
      // oversight is eligible for — it relaxes consent for one server-composed
      // type, the invitation-accepted milestone (ruled 2026-08-01).
      if (
        gate === "requires_sharing" &&
        !(await canAccessFeatureData(
          recipient,
          churchId,
          OVERSIGHT_SHARING_FEATURE
        ))
      ) {
        return { allowed: false, reason: "oversight_privacy" };
      }
    }

    return { allowed: true };
  },

  async insertIfAbsent(row) {
    // TWO ARBITERS, ONE PER ANCHOR (migration 0036).
    //
    // A church-anchored row has a NULL `anchor_org_id` and an org-anchored row
    // has a NULL `church_id`, and NULLs never collide in a btree unique index —
    // so neither index can arbitrate the other's rows, and pointing ON CONFLICT
    // at the wrong one would silently turn `dedupeKey` back into a suggestion.
    // The branch is on the stored discriminator, so it cannot disagree with what
    // was written.
    if (row.anchorType !== "church") {
      const [insertedOrg] = await db
        .insert(notifications)
        .values(row)
        // Matches `notifications_org_dedupe_key_unique_idx` (migration 0036),
        // predicate included — the same byte-for-byte rule as the church index
        // below, and for the same reason.
        .onConflictDoNothing({
          target: [
            notifications.anchorOrgId,
            notifications.recipientUserId,
            notifications.dedupeKey,
          ],
          where: sql`${notifications.anchorOrgId} is not null and ${notifications.dedupeKey} is not null and ${notifications.status} <> 'cancelled'`,
        })
        .returning();

      return insertedOrg ?? null;
    }

    const [inserted] = await db
      .insert(notifications)
      .values(row)
      // Matches `notifications_dedupe_key_unique_idx` (migration 0025).
      // `target` alone is not enough for a PARTIAL index — Postgres infers the
      // arbiter index only when the same predicate is supplied, so `where` here
      // renders as the ON CONFLICT index_predicate, not as a row filter.
      //
      // *** This expression and the index predicate change TOGETHER. ***
      // A mismatch is not a subtle drift: it turns every keyed enqueue into
      // "there is no unique or exclusion constraint matching the ON CONFLICT
      // specification" at runtime. The literal 'cancelled' is inlined, not
      // parameterised, because inference matches against the stored predicate
      // and a bind parameter is not a constant it can match.
      .onConflictDoNothing({
        target: [
          notifications.churchId,
          notifications.recipientUserId,
          notifications.dedupeKey,
        ],
        where: sql`${notifications.dedupeKey} is not null and ${notifications.status} <> 'cancelled'`,
      })
      .returning();

    return inserted ?? null;
  },

  async findByDedupeKey(anchor, recipientUserId, dedupeKey) {
    // Scoped on the DISCRIMINATED column, never on a coalesced id: the read-back
    // decides which row a caller is handed as "already recorded", so a predicate
    // that could match the other anchor's column would hand a plant's row to an
    // org (and the reverse) on a shared key.
    const anchorWhere =
      anchor.type === "church"
        ? eq(notifications.churchId, anchor.churchId)
        : eq(notifications.anchorOrgId, anchor.orgId);

    const [existing] = await db
      .select()
      .from(notifications)
      .where(
        and(
          anchorWhere,
          eq(notifications.recipientUserId, recipientUserId),
          eq(notifications.dedupeKey, dedupeKey),
          // The same liveness term the index carries. Cancelled rows keep their
          // key for the audit trail, so without this the read-back on a genuine
          // dedupe hit could return the cancelled row instead of the live one
          // that actually holds the key.
          ne(notifications.status, "cancelled")
        )
      )
      .limit(1);

    return existing ?? null;
  },
};

export const dbCancelByEntityDeps: CancelByEntityDeps = {
  async cancelPending({ churchId, entityType, entityId, category }) {
    return db
      .update(notifications)
      .set({ status: "cancelled", updatedAt: new Date() })
      .where(
        and(
          eq(notifications.churchId, churchId),
          eq(notifications.entityType, entityType),
          eq(notifications.entityId, entityId),
          eq(notifications.status, "pending"),
          category ? eq(notifications.category, category) : undefined
        )
      )
      .returning({ id: notifications.id });
  },
};

/**
 * `enqueue(...)` — the contract every feature calls.
 *
 * Records a pending notification and returns. No provider call happens here;
 * the dispatcher resolves preferences and delivers on its own schedule, which
 * is why an opt-out is honoured at dispatch time rather than frozen at enqueue.
 *
 * Check `result.status` before reaching for `result.notification`: a recipient
 * who may not be told yields `"skipped"` with a `reason`, and the call is not
 * an error. Fan-out callers should loop, collect, and report the skips — one
 * barred recipient must not cost the other five their notification.
 */
export function enqueue(
  input: EnqueueNotificationInput
): Promise<EnqueueResult> {
  return runEnqueue(dbEnqueueDeps, input);
}

/** `cancelByEntity(...)` — the contract a delete or reschedule path calls. */
export function cancelByEntity(
  input: CancelByEntityInput
): Promise<CancelByEntityResult> {
  return runCancelByEntity(dbCancelByEntityDeps, input);
}
