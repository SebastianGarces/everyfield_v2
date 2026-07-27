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

import { oversightPrivacyFeature } from "./categories";

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
//   3. The recipient must be ALLOWED to be told. Two separate facts, both
//      checked here rather than assumed of the caller — see
//      `recipientMayBeNotified`:
//        a. they can access the church the row is filed under, and
//        b. if they are an oversight user, the church has opted in to sharing
//           this category's feature data.
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
    /** Tenancy. Verified against the recipient's own access, not trusted. */
    churchId: z.string().uuid(),
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
  );

export type EnqueueNotificationInput = z.input<
  typeof enqueueNotificationSchema
>;

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

export interface EnqueueResult {
  /**
   * The recorded notification — the freshly inserted row, or the one an earlier
   * call with the same `dedupeKey` already created. Null only if that earlier
   * row was deleted between the conflicting insert and the read-back.
   */
  notification: Notification | null;
  /** False when the dedupe key collapsed this call into an existing row. */
  created: boolean;
}

/**
 * Why a recipient was refused — a reason rather than a bare boolean, so the two
 * refusals stay distinguishable at the throw site and in a log. They are
 * genuinely different facts: one is a tenancy error, the other is a church
 * exercising a privacy choice it is entitled to.
 */
export type RecipientRefusal = "outside_church" | "oversight_privacy";

export type RecipientCheck =
  | { allowed: true }
  | { allowed: false; reason: RecipientRefusal };

export interface EnqueueDeps {
  /**
   * May this user be told about this category, in this church?
   *
   * TWO gates, resolved against the same `src/lib/auth/access.ts` the rest of
   * the app authorises reads with:
   *
   *   1. `canAccessChurch` — a caller that derived `recipientUserId` from
   *      request input cannot file a notification for a stranger into a tenant
   *      they do not belong to.
   *   2. `canAccessFeatureData` for OVERSIGHT recipients — because (1) alone
   *      returns true for a network admin on every plant in the network,
   *      whatever `church_privacy_settings` says.
   *
   * The category is a parameter for gate (2): what an oversight user may be
   * told depends on which feature's copy the body carries.
   */
  recipientMayBeNotified(
    churchId: string,
    recipientUserId: string,
    category: NotificationCategory
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
    churchId: string,
    recipientUserId: string,
    dedupeKey: string
  ): Promise<Notification | null>;
}

/** Thrown when a notification is addressed to a user outside its church. */
export class RecipientOutsideChurchError extends Error {
  constructor(churchId: string, recipientUserId: string) {
    super(
      `enqueue: recipient ${recipientUserId} does not belong to church ${churchId}`
    );
    this.name = "RecipientOutsideChurchError";
  }
}

/**
 * Thrown when an oversight recipient's church has not opted in to sharing this
 * category's feature data (or when no privacy toggle covers the category at
 * all — `phase` and `digest`, see `oversightPrivacyFeature`).
 *
 * Distinct from `RecipientOutsideChurchError` on purpose: the recipient DOES
 * have access to the church. What they do not have is this church's consent to
 * receive item-level copy from this feature.
 */
export class OversightRecipientNotPermittedError extends Error {
  constructor(
    churchId: string,
    recipientUserId: string,
    category: NotificationCategory
  ) {
    super(
      `enqueue: oversight recipient ${recipientUserId} may not be notified about "${category}" for church ${churchId} — the church has not opted in to sharing this feature's data`
    );
    this.name = "OversightRecipientNotPermittedError";
  }
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
 * Throws `RecipientOutsideChurchError` if the recipient has no access to the
 * church, and `OversightRecipientNotPermittedError` if they are an oversight
 * user whose church has not opted in to this category's feature data. Both are
 * checked here rather than left to a comment about what callers have supposedly
 * already done.
 */
export async function runEnqueue(
  deps: EnqueueDeps,
  input: EnqueueNotificationInput
): Promise<EnqueueResult> {
  const parsed = enqueueNotificationSchema.parse(input);

  const check = await deps.recipientMayBeNotified(
    parsed.churchId,
    parsed.recipientUserId,
    parsed.category
  );
  if (!check.allowed) {
    throw check.reason === "oversight_privacy"
      ? new OversightRecipientNotPermittedError(
          parsed.churchId,
          parsed.recipientUserId,
          parsed.category
        )
      : new RecipientOutsideChurchError(
          parsed.churchId,
          parsed.recipientUserId
        );
  }

  const row: NewNotification = {
    churchId: parsed.churchId,
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
    return { notification: inserted, created: true };
  }

  // A conflict is only reachable through the dedupe-key index, so reaching here
  // without a key means the deps lied about why the insert produced no row.
  if (!parsed.dedupeKey) {
    throw new Error(
      "enqueue: insert produced no row for a notification with no dedupeKey"
    );
  }

  const existing = await deps.findByDedupeKey(
    parsed.churchId,
    parsed.recipientUserId,
    parsed.dedupeKey
  );
  return { notification: existing, created: false };
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

export const dbEnqueueDeps: EnqueueDeps = {
  async recipientMayBeNotified(churchId, recipientUserId, category) {
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

    // Gate 1 — the SAME resolution the rest of the app authorises reads with,
    // so "may be notified about this church" and "may see this church" cannot
    // drift apart: a coach reached via coach_assignments qualifies, a planter
    // in another plant does not.
    if (!(await canAccessChurch(recipient, churchId))) {
      return { allowed: false, reason: "outside_church" };
    }

    // Gate 2 — and it is a SECOND gate, not the same one. `canAccessChurch`
    // returns true for a sending-church or network admin on every plant beneath
    // them, unconditionally; memory/invariants.md → Hierarchical Access Control
    // says those users see aggregate metrics only, subject to the church's
    // opt-in `church_privacy_settings`. A notification body is item-level
    // feature copy, so it is subject to exactly that toggle.
    if (isOversightUser(recipient)) {
      const feature = oversightPrivacyFeature(category);
      if (feature === null) {
        return { allowed: false, reason: "oversight_privacy" };
      }
      if (!(await canAccessFeatureData(recipient, churchId, feature))) {
        return { allowed: false, reason: "oversight_privacy" };
      }
    }

    return { allowed: true };
  },

  async insertIfAbsent(row) {
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

  async findByDedupeKey(churchId, recipientUserId, dedupeKey) {
    const [existing] = await db
      .select()
      .from(notifications)
      .where(
        and(
          eq(notifications.churchId, churchId),
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
