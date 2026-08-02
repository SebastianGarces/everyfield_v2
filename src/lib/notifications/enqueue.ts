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

import { OVERSIGHT_SHARING_FEATURE, oversightGateFor } from "./categories";

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
//        a. they can access the church the row is filed under,
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
  churchId: string;
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
    churchId: string,
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

  const check = await deps.recipientMayBeNotified({
    churchId: parsed.churchId,
    recipientUserId: parsed.recipientUserId,
    category: parsed.category,
    type: parsed.type,
  });
  if (!check.allowed) {
    return skipped(check.reason);
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
    parsed.churchId,
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

export const dbEnqueueDeps: EnqueueDeps = {
  async recipientMayBeNotified({ churchId, recipientUserId, category, type }) {
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
