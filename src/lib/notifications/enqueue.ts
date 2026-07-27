import { and, eq, sql } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/db";
import {
  notificationCategories,
  notifications,
  users,
  type NewNotification,
  type Notification,
} from "@/db/schema";
import { canAccessChurch } from "@/lib/auth/access";

// ============================================================================
// The enqueue contract (N-001, N-002, N-011).
//
// This module is the whole public surface a feature needs to adopt F11:
//
//   enqueue(input)          record a pending notification. Never sends.
//   cancelByEntity(input)   the subject went away — do not announce it.
//
// Two rules it exists to keep:
//
//   1. Enqueue is NEVER a synchronous send (N-002). Nothing in this file's
//      import graph reaches an email provider; delivery is the dispatcher's
//      job, and it is a separate unit. A caller returns as soon as the row is
//      recorded.
//   2. `dedupeKey` is idempotent (N-001) PER RECIPIENT. Idempotency is enforced
//      by the partial unique index on (church_id, recipient_user_id,
//      dedupe_key) via ON CONFLICT DO NOTHING — not by a SELECT-then-INSERT
//      guard, which two concurrent enqueues would both pass
//      (memory/invariants.md → Atomicity). The recipient belongs in that key
//      because the natural caller for a fan-out ("remind all six attendees")
//      composes ONE key per event and loops the recipients; without it,
//      attendee #1 would silently swallow #2..N.
//   3. The recipient must belong to the church the row is filed under. That is
//      checked, not assumed — see `recipientBelongsToChurch` below.
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
    entityType: z.string().trim().min(1).max(32).optional(),
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

export const cancelByEntitySchema = z.object({
  churchId: z.string().uuid(),
  entityType: z.string().trim().min(1).max(32),
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

export interface EnqueueDeps {
  /**
   * Does this user have access to this church at all? A scoped existence check
   * against the same source `src/lib/auth/access.ts` uses, so a caller that
   * derived `recipientUserId` from request input cannot file a notification for
   * a stranger into a tenant they do not belong to.
   */
  recipientBelongsToChurch(
    churchId: string,
    recipientUserId: string
  ): Promise<boolean>;
  /**
   * `INSERT ... ON CONFLICT (church_id, recipient_user_id, dedupe_key)
   * DO NOTHING RETURNING *`. Resolves to null — never throws — when the key
   * already exists for that recipient.
   */
  insertIfAbsent(row: NewNotification): Promise<Notification | null>;
  /** Church- AND recipient-scoped read-back of the row that won a dedupe race. */
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
 * Idempotent on `dedupeKey` PER RECIPIENT: a second call with the same key for
 * the same user returns the first call's notification with `created: false` and
 * writes nothing, while the same key for a different user records its own row.
 *
 * Throws `RecipientOutsideChurchError` if the recipient has no access to the
 * church — the (church, recipient) relationship is checked here rather than
 * left to a comment about what callers have supposedly already done.
 */
export async function runEnqueue(
  deps: EnqueueDeps,
  input: EnqueueNotificationInput
): Promise<EnqueueResult> {
  const parsed = enqueueNotificationSchema.parse(input);

  if (
    !(await deps.recipientBelongsToChurch(
      parsed.churchId,
      parsed.recipientUserId
    ))
  ) {
    throw new RecipientOutsideChurchError(
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

export const dbEnqueueDeps: EnqueueDeps = {
  async recipientBelongsToChurch(churchId, recipientUserId) {
    const [recipient] = await db
      .select()
      .from(users)
      .where(eq(users.id, recipientUserId))
      .limit(1);

    if (!recipient) return false;

    // Deliberately the SAME resolution the rest of the app authorises reads
    // with, so "may be notified about this church" and "may see this church"
    // cannot drift apart: a coach reached via coach_assignments qualifies, a
    // planter in another plant does not.
    return canAccessChurch(recipient, churchId);
  },

  async insertIfAbsent(row) {
    const [inserted] = await db
      .insert(notifications)
      .values(row)
      // Matches `notifications_dedupe_key_unique_idx`. `target` alone is not
      // enough for a PARTIAL index — Postgres infers the arbiter index only
      // when the same predicate is supplied, so `where` here renders as the
      // ON CONFLICT index_predicate, not as a row filter.
      .onConflictDoNothing({
        target: [
          notifications.churchId,
          notifications.recipientUserId,
          notifications.dedupeKey,
        ],
        where: sql`${notifications.dedupeKey} is not null`,
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
          eq(notifications.dedupeKey, dedupeKey)
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
