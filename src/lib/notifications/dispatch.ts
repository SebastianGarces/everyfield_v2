import { and, count, eq, inArray, lte, sql } from "drizzle-orm";
import { db } from "@/db";
import {
  notificationChannels,
  notificationDeliveries,
  notificationPreferences,
  notifications,
  users,
  type Notification,
  type NotificationCategory,
  type NotificationChannel,
  type NotificationDelivery,
  type NotificationPreference,
  type NotificationStatus,
  type UserRole,
} from "@/db/schema";
import { sendEmail as sendProviderEmail } from "@/lib/email/client";

import {
  batchSubject,
  composeBatchEmail,
  type ComposeBatchEmailOptions,
  type NotificationEmailItem,
  type NotificationEmailRecipient,
  type OutboundEmail,
} from "./channels/email";
import {
  loadSuppressedAddresses as loadSuppressedAddressesFromDb,
  normalizeEmailAddress,
} from "./channels/suppression";
import { composePlanterDigestEmail } from "./channels/digest-email";
import { PLANTER_DIGEST_TYPE } from "./digest";
import { PERMANENT_FAILURE_PREFIX } from "./permanent-failure";
import { audienceForRole, isChannelEnabled } from "./preferences";

// The email channel's rendering lives in `./channels/email`; it is re-exported
// here because the dispatcher is the seam every caller already knows about.
export { batchSubject, composeBatchEmail };
export type { OutboundEmail };

// ============================================================================
// Scheduled dispatch (N-003, N-004, N-012, N-014, N-015, N-016, N-017).
//
// The recurring job that turns recorded notifications into actual deliveries.
// `enqueue` never sends; this is the only thing in F11 that touches a provider.
//
// ----------------------------------------------------------------------------
// At-most-once is the load-bearing guarantee, and it is a DATABASE property
// ----------------------------------------------------------------------------
//
// Two independent claims, both single statements, because
// `drizzle-orm/neon-http` has no interactive transactions (memory/invariants.md
// → Atomicity) and a SELECT-then-INSERT guard is not a concurrency guard:
//
//   1. THE ROW CLAIM. `claimDue` is one
//      `UPDATE ... WHERE id IN (SELECT ... FOR UPDATE SKIP LOCKED) RETURNING *`.
//      A row moves `pending → claimed` and comes back to exactly one run. A
//      second run that overlaps this one sees no `pending` row and takes
//      nothing. This is what makes "the dispatcher ran twice" harmless.
//
//   2. THE CHANNEL CLAIM. `claimDelivery` is one
//      `INSERT ... ON CONFLICT (notification_id, channel) DO UPDATE ... WHERE
//      the existing row is a retryable failure`, arbitrated by
//      `notification_deliveries_notification_channel_idx`. It returns a row only
//      when this run owns the attempt. That index is why a second delivery for
//      the same channel cannot exist, whatever the dispatcher believes.
//
// (1) alone is not enough: a run that crashes after claiming leaves rows stuck
// in `claimed`, and any recovery that re-pends them would re-send without (2).
// (2) alone is not enough either: without it every concurrent run would compose
// and send the same batch email before racing on the delivery row.
//
// A delivery row left in `queued` — a run that crashed between the claim and
// the send — is treated as IN FLIGHT and never retried. We cannot know whether
// the provider accepted it, and N-004 says which way to resolve that doubt.
//
// ----------------------------------------------------------------------------
// Retry and backoff without a migration (N-015)
// ----------------------------------------------------------------------------
//
// A transient failure leaves the delivery `failed` with its attempt count, and
// returns the NOTIFICATION to `pending` — but deliberately does NOT push
// `scheduled_for` forward. `scheduled_for` is also the feed's visibility gate
// (`queries.ts` → `feedVisibility`), so moving it to schedule an email retry
// would make an already-delivered in-app row vanish from the feed it is already
// sitting in. Backoff therefore lives on the CHANNEL: `channelEligibility`
// refuses a failed delivery until `retryDelayMs(attemptCount)` has elapsed since
// its `updated_at`. The row is re-claimed and re-pended by the runs in between,
// which is a handful of cheap statements and keeps one clock instead of two.
//
// A PERMANENT failure (invalid address, hard bounce) is never retried. The
// durable marker is the error text's `PERMANENT_FAILURE_PREFIX`, not the attempt
// count — burning the budget to fake exhaustion would lie about how many times
// we actually called the provider, and the attempt count is the thing N-015's
// acceptance criterion reads.
//
// ----------------------------------------------------------------------------
// Batching is a correctness requirement, not an optimisation (N-012)
// ----------------------------------------------------------------------------
//
// Twenty task notifications for one planter produce ONE email and twenty feed
// rows. Grouping is by (church, recipient, category) over the claimed batch —
// the run IS the batching window. Every grouped notification still gets its own
// delivery row per channel, all settled with the same provider message id, so
// "did this one send?" stays answerable per notification (N-016).
//
// ----------------------------------------------------------------------------
// N-014 — dispatch does not know what "resolved" means
// ----------------------------------------------------------------------------
//
// The owning feature registers a still-live predicate per `type`
// (FRD → Integration Contracts). Absent a predicate a notification is live: F11
// must not invent domain rules for a caller that never registered one. A
// predicate that THROWS resolves neither way, so the notification is deferred —
// left pending, nothing delivered, nothing cancelled — rather than guessed at.
//
// ----------------------------------------------------------------------------
// N-017 — a run that cannot finish leaves the remainder pending
// ----------------------------------------------------------------------------
//
// The claim is bounded by `MAX_DISPATCH_BATCH`; anything past it is simply not
// claimed and stays pending for the next tick. A soft budget stops the run
// mid-batch, and every claimed-but-unprocessed row is RELEASED back to
// `pending` before returning — claimed rows must never be stranded, because
// nothing else re-pends them.
// ============================================================================

// ----------------------------------------------------------------------------
// Bounds and policy constants
// ----------------------------------------------------------------------------

/**
 * Notifications claimed per run. Each group costs at most one provider call, so
 * the real bound on wall-clock is groups, not rows — but rows are what we can
 * cap in the claim statement. Anything past the cap stays pending (N-017).
 */
export const MAX_DISPATCH_BATCH = 100;

/**
 * Soft wall-clock budget for one run, under the platform function timeout
 * (`maxDuration = 60` on the route). Crossing it stops the run between groups
 * and releases what is left, so the remainder is delayed rather than dropped.
 */
export const RUN_BUDGET_MS = 45_000;

/** Bounded retry (N-015). Attempts counted per (notification, channel). */
export const MAX_DELIVERY_ATTEMPTS = 3;

/** First retry lands this long after the failure; doubles from there. */
export const RETRY_BASE_DELAY_MS = 5 * 60_000;

/** Ceiling on the exponential, so a long-failing channel still ticks. */
export const MAX_RETRY_DELAY_MS = 60 * 60_000;

// `PERMANENT_FAILURE_PREFIX` used to be declared here. It now lives in the
// import-free leaf `./permanent-failure`, so the webhook route can reach it
// without pulling this module's graph (#263 item 2). It is deliberately NOT
// re-exported: importers name the leaf.

/** Backoff before attempt N+1, given the attempt count that just failed. */
export function retryDelayMs(attemptCount: number): number {
  const exponent = Math.max(attemptCount - 1, 0);
  return Math.min(RETRY_BASE_DELAY_MS * 2 ** exponent, MAX_RETRY_DELAY_MS);
}

/** True when this delivery's recorded error marks it permanently failed. */
export function isPermanentlyFailed(delivery: NotificationDelivery): boolean {
  return (delivery.error ?? "").startsWith(PERMANENT_FAILURE_PREFIX);
}

// ----------------------------------------------------------------------------
// Still-live predicates (N-014)
// ----------------------------------------------------------------------------

/**
 * "Is this notification's subject still worth announcing?"
 *
 * Registered per notification `type` by the feature that owns that type —
 * F5 registers `task.overdue`, F3 registers `meeting.reminder`. Dispatch calls
 * it immediately before delivering and never interprets the subject itself.
 */
export type StillLivePredicate = (
  notification: Notification
) => boolean | Promise<boolean>;

const stillLivePredicates = new Map<string, StillLivePredicate>();

/**
 * Register the predicate for one notification `type`.
 *
 * Re-registering the same type REPLACES the predicate rather than stacking,
 * which is what makes arming idempotent: `registerNotificationConsumers()`
 * (`src/lib/notifications/register-consumers.ts`) may be called any number of
 * times, and a hot reload does not accumulate handlers.
 *
 * REGISTRATION IS A CALL, NOT AN IMPORT. It used to be a module-load side effect
 * in the owning feature — and the dispatcher's own entrypoint imports no feature
 * module, so every predicate was MISSING in the cron runtime and
 * `resolveLiveness` treated all six types as live. See `register-consumers.ts`.
 */
export function registerStillLivePredicate(
  type: string,
  predicate: StillLivePredicate
): void {
  stillLivePredicates.set(type, predicate);
}

/**
 * The same registration for a whole family of types — a feature's tuple, so a
 * fourth reminder offset cannot ship registered for only three.
 */
export function registerStillLivePredicates(
  types: readonly string[],
  predicate: StillLivePredicate
): void {
  for (const type of types) {
    registerStillLivePredicate(type, predicate);
  }
}

export function unregisterStillLivePredicate(type: string): void {
  stillLivePredicates.delete(type);
}

/** Drop every registration. Test seam; nothing in production calls it. */
export function clearStillLivePredicates(): void {
  stillLivePredicates.clear();
}

export function stillLivePredicateFor(
  type: string
): StillLivePredicate | undefined {
  return stillLivePredicates.get(type);
}

/**
 * - `live` — no predicate registered, or the predicate said yes.
 * - `resolved` — the predicate said no. Cancel; announce nothing.
 * - `unknown` — the predicate threw. Defer: leave it pending and try next run.
 */
export type LivenessOutcome = "live" | "resolved" | "unknown";

/**
 * An UNREGISTERED type is live. The alternative — refusing to deliver anything
 * without a predicate — would mean F11 silently swallowed every notification
 * from a caller that has no resolution concept at all (a phase transition, a
 * delivery failure notice), which is worse than the stale send it prevents.
 */
export async function resolveLiveness(
  notification: Notification
): Promise<LivenessOutcome> {
  const predicate = stillLivePredicates.get(notification.type);
  if (!predicate) return "live";

  try {
    return (await predicate(notification)) ? "live" : "resolved";
  } catch (error) {
    console.error(
      `[notifications/dispatch] still-live predicate for "${notification.type}" threw; deferring notification ${notification.id}:`,
      error instanceof Error ? error.message : error
    );
    return "unknown";
  }
}

// ----------------------------------------------------------------------------
// Channel eligibility — the pure half of at-most-once
// ----------------------------------------------------------------------------

export type ChannelIneligibility =
  /** Already sent, suppressed or cancelled on this channel. Terminal. */
  | "already_settled"
  /** A `queued` row from a run that crashed mid-send. Never retried (N-004). */
  | "in_flight"
  /** Bounded retry exhausted, or a permanent failure. */
  | "attempts_exhausted"
  /** Failed, retryable, but the backoff has not elapsed yet. */
  | "in_backoff";

export type ChannelEligibility =
  | { eligible: true }
  | { eligible: false; reason: ChannelIneligibility };

/**
 * May this run attempt this channel?
 *
 * Pure, so the whole retry policy is assertable without a database. It does not
 * REPLACE the atomic claim — two concurrent runs can both read the same
 * `failed` row and both decide "eligible"; `claimDelivery`'s conditional
 * ON CONFLICT is what makes exactly one of them win. This decides policy; the
 * index decides who.
 */
export function channelEligibility(
  existing: NotificationDelivery | undefined,
  now: Date,
  maxAttempts: number = MAX_DELIVERY_ATTEMPTS
): ChannelEligibility {
  if (!existing) return { eligible: true };

  if (existing.status !== "failed") {
    // `queued` is a claim someone else holds (or a crashed run's); every other
    // status is a terminal outcome we must not overwrite.
    return {
      eligible: false,
      reason: existing.status === "queued" ? "in_flight" : "already_settled",
    };
  }

  if (isPermanentlyFailed(existing) || existing.attemptCount >= maxAttempts) {
    return { eligible: false, reason: "attempts_exhausted" };
  }

  const readyAt =
    existing.updatedAt.getTime() + retryDelayMs(existing.attemptCount);
  if (now.getTime() < readyAt) {
    return { eligible: false, reason: "in_backoff" };
  }

  return { eligible: true };
}

// ----------------------------------------------------------------------------
// Provider seam
// ----------------------------------------------------------------------------

export type EmailSendOutcome =
  | { status: "sent"; providerMessageId: string | null }
  | {
      status: "failed";
      error: string;
      /** True for a hard bounce / invalid address — never retried (N-015). */
      permanent: boolean;
    };

/**
 * Provider errors that mean "this address will never work". Retrying them burns
 * sender reputation and cannot succeed, so N-015 excludes them by name.
 *
 * Matching is on the message text because the transactional client
 * (`src/lib/email/client.ts`) flattens the provider's error to a string. It is
 * a conservative list: anything unrecognised is treated as TRANSIENT and gets
 * its bounded retries, which fails toward delivery rather than toward silence.
 */
const PERMANENT_EMAIL_ERROR_PATTERNS = [
  // Resend spells this "Invalid `to` field", so the separator class has to
  // admit backticks and quotes as well as spaces and underscores.
  /invalid[\W_]{0,3}(to|from|recipient|address|email)\b/i,
  /hard[\s-]?bounce/i,
  /\bbounced\b/i,
  /does not exist/i,
  /no such (user|mailbox|address)/i,
  /mailbox (unavailable|not found)/i,
  /unsubscribed|suppress(ed|ion)/i,
  /blocked|blacklist/i,
  /validation[_\s-]?error/i,
  /\b5\.[1-7]\.\d+\b/,
];

export function isPermanentEmailError(message: string): boolean {
  return PERMANENT_EMAIL_ERROR_PATTERNS.some((pattern) =>
    pattern.test(message)
  );
}

// ----------------------------------------------------------------------------
// Composition — owned by ./channels/email, which is what makes an email an
// email (template, unsubscribe link, List-Unsubscribe header)
// ----------------------------------------------------------------------------

export interface DispatchRecipient {
  id: string;
  email: string;
  name: string | null;
  /**
   * The recipient's role — carried ONLY to pick which coded preference defaults
   * apply (`audienceForRole`, N-027). It is not an authorisation input: whether
   * this row should exist at all was settled by `enqueue` before it was written.
   */
  role: UserRole;
}

/**
 * One provider call per (anchor, recipient, category, run) — the anchor being
 * the plant or the org the rows are filed under (migration 0036). Stable across
 * a retry of the SAME attempt set, which is what the provider needs to dedupe a
 * send we were killed before recording.
 */
export function groupIdempotencyKey(
  anchorId: string,
  recipientUserId: string,
  category: NotificationCategory,
  notificationIds: readonly string[]
): string {
  const fingerprint = [...notificationIds].sort().join(",");
  return `notif:${anchorId}:${recipientUserId}:${category}:${hash(fingerprint)}`;
}

// ----------------------------------------------------------------------------
// Which template a group renders through
// ----------------------------------------------------------------------------

/**
 * A composer turns one dispatched group into the one email it becomes.
 *
 * `composeBatchEmail` is the shape, and every alternative has to be
 * signature-compatible with it: the dispatcher picks one and calls it, and
 * nothing downstream of the pick knows which it got.
 */
export type GroupEmailComposer = (
  recipient: NotificationEmailRecipient,
  category: NotificationCategory,
  items: readonly NotificationEmailItem[],
  idempotencyKey: string,
  options?: ComposeBatchEmailOptions
) => Promise<OutboundEmail>;

/**
 * The types that render through something other than the generic template.
 *
 * A STATIC DECISION, deliberately, and not a registry like
 * `registerStillLivePredicate` above. A registry has to be ARMED by a call in
 * the runtime that dispatches — the bug `./register-consumers.ts` exists to
 * close — and an unarmed composer registry would silently fall back to the
 * generic template in the cron runtime while every test passed. A decision
 * spelled in code cannot be unarmed.
 *
 * The cost is one edge from F11 back into a feature module, which is the same
 * cost `register-consumers.ts` already pays and for the same reason.
 *
 * WHY A FUNCTION AND NOT A MODULE-SCOPE TABLE. `./digest` reaches back into
 * this module through the tasks feature's own F11 registration
 * (`digest.ts` → `@/lib/tasks/service` → `@/lib/tasks/notifications` → here),
 * so the two modules are in a cycle. A `Record` built at module scope reads
 * `PLANTER_DIGEST_TYPE` while `./digest` is still initialising and throws a TDZ
 * `ReferenceError` on the import order that starts at `./digest` — which the
 * test suite for the digest does. Resolved on CALL, both modules finish loading
 * whichever is entered first.
 *
 * It also makes the lookup an EQUALITY rather than an index, so a stored `type`
 * of `"constructor"` cannot resolve through `Object.prototype` into something
 * callable (memory/invariants.md → the string-keyed accessor rule).
 *
 * Keyed on `type` rather than on `category`, because the `digest` CATEGORY
 * carries two unrelated things — this planter digest and the oversight activity
 * digest (`./oversight-digest.ts`), whose body has a different shape entirely.
 * Keying on the category would have rendered one through the other's template.
 */
function specialComposerFor(type: string): GroupEmailComposer | undefined {
  if (type === PLANTER_DIGEST_TYPE) return composePlanterDigestEmail;
  return undefined;
}

/**
 * The composer for one group, defaulting to the generic batch template.
 *
 * A MIXED group falls back. A special composer speaks for its own type and
 * knows how to read its own bodies; handed somebody else's rows it would render
 * them as blank lines, which is worse than the generic template rendering all
 * of them plainly. In practice a group is (anchor, recipient, category) so a
 * mix is only reachable if two types ever share a category for one recipient —
 * but that is exactly the case this guard is cheap insurance against.
 */
export function emailComposerForGroup(
  items: readonly Notification[]
): GroupEmailComposer {
  const first = items[0];
  if (!first) return composeBatchEmail;

  const composer = specialComposerFor(first.type);
  if (!composer) return composeBatchEmail;
  if (items.some((item) => item.type !== first.type)) return composeBatchEmail;

  return composer;
}

/** Small stable digest — this only has to be collision-resistant per group. */
function hash(value: string): string {
  let h = 2166136261;
  for (let i = 0; i < value.length; i += 1) {
    h ^= value.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return (h >>> 0).toString(36);
}

// ----------------------------------------------------------------------------
// Seams
// ----------------------------------------------------------------------------

export type DeliveryClaim =
  | { status: "claimed"; attemptCount: number }
  | { status: "lost" };

export interface SettleDeliveryInput {
  notificationId: string;
  channel: NotificationChannel;
  status: "sent" | "failed";
  error?: string | null;
  providerMessageId?: string | null;
  sentAt?: Date | null;
  now: Date;
}

export interface DispatchDeps {
  /**
   * Atomically move up to `limit` due `pending` rows to `claimed` and return
   * them. One statement; a concurrent run gets a disjoint set or nothing.
   */
  claimDue(now: Date, limit: number): Promise<Notification[]>;
  /** Due `pending` rows still unclaimed — the N-017 remainder. */
  countRemainingDue(now: Date): Promise<number>;
  /** Addressing for the run's recipients. One query, never per notification. */
  loadRecipients(userIds: readonly string[]): Promise<DispatchRecipient[]>;
  /** Stored preference rows. Absence is meaningful — see `preferences.ts`. */
  loadPreferences(
    userIds: readonly string[]
  ): Promise<NotificationPreference[]>;
  /** Existing delivery rows for the claimed batch. One query, never per row. */
  loadDeliveries(
    notificationIds: readonly string[]
  ): Promise<NotificationDelivery[]>;
  /**
   * Take ownership of one (notification, channel) attempt. Returns `lost` when
   * the unique index says someone else already owns it.
   */
  claimDelivery(
    notificationId: string,
    channel: NotificationChannel,
    maxAttempts: number
  ): Promise<DeliveryClaim>;
  /**
   * Record a non-attempt outcome (`suppressed_by_preference`, `cancelled`).
   * Must never overwrite an existing row — a channel already sent stays sent.
   */
  recordTerminalDelivery(
    notificationId: string,
    channel: NotificationChannel,
    status: "suppressed_by_preference" | "cancelled",
    now: Date
  ): Promise<void>;
  /** Record the outcome of an attempt this run owned. */
  settleDelivery(input: SettleDeliveryInput): Promise<void>;
  /** Move a processed queue row to its post-run status. */
  finishNotification(
    notificationId: string,
    status: NotificationStatus,
    now: Date
  ): Promise<void>;
  /** Hand claimed rows back to the queue untouched. Nothing else re-pends them. */
  releaseClaims(notificationIds: readonly string[], now: Date): Promise<void>;
  /**
   * Which of the run's recipient addresses are suppressed (#324), normalised.
   *
   * One query for the whole run, on the same rule as `loadRecipients`: this is
   * inside a function with a hard timeout, and a per-notification read would be
   * an N+1 in the hottest loop in F11.
   */
  loadSuppressedAddresses(emails: readonly string[]): Promise<string[]>;
  /** The one provider call. */
  sendEmail(message: OutboundEmail): Promise<EmailSendOutcome>;
}

export interface DispatchOptions {
  now?: Date;
  maxBatch?: number;
  budgetMs?: number;
  maxAttempts?: number;
  /** Elapsed-ms source, injectable so the budget is assertable. */
  elapsedMs?: () => number;
}

export interface DispatchRunSummary {
  claimed: number;
  /** Due rows left pending after the claim — N-017's "never dropped". */
  remainingPending: number;
  groups: number;
  /** Provider calls made. One per group with at least one eligible email. */
  emailsSent: number;
  delivered: number;
  cancelled: number;
  failed: number;
  /** Notifications returned to pending for a later attempt. */
  retryScheduled: number;
  /** Notifications left pending because a predicate could not answer. */
  deferred: number;
  /** Channel outcomes recorded as `suppressed_by_preference`. */
  suppressed: number;
  /**
   * Emails not composed because the recipient's ADDRESS is suppressed (#324).
   *
   * COUNTED, not thrown. A suppressed address is a normal, expected outcome —
   * somebody's mailbox died — and a throw here would strand every claimed row
   * in the run over one dead address. It is reported separately from
   * `suppressed` because the two are different refusals: that one is a user's
   * choice about a category, this one is a mailbox that does not exist.
   */
  addressSuppressed: number;
  /** Claimed rows released unprocessed when the budget ran out. */
  released: number;
  durationMs: number;
}

// ----------------------------------------------------------------------------
// Grouping (N-012)
// ----------------------------------------------------------------------------

export interface DispatchGroup {
  key: string;
  /**
   * The TENANT the group's rows are filed under — a plant's id, or an org's
   * (migration 0036). Named for what it is rather than `churchId`, because
   * since #304 WS3 a claimed row may be anchored to a sending church or a
   * network and have no `church_id` at all.
   */
  anchorId: string;
  recipientUserId: string;
  category: NotificationCategory;
  notifications: Notification[];
}

/**
 * Group the claimed batch by (anchor, recipient, category). Insertion order is
 * preserved — the claim already ordered by `scheduled_for, id`, so the oldest
 * notification decides where its group sits in the run.
 *
 * The ANCHOR is what N-012 always meant by "church": one provider call per
 * tenant per recipient per category. Grouping on a null `church_id` would have
 * put every org-anchored row in the product into ONE group keyed `null|…`, so a
 * network admin's milestone and a sending-church admin's could have shared an
 * idempotency key.
 */
export function groupForDispatch(
  claimed: readonly Notification[]
): DispatchGroup[] {
  const groups = new Map<string, DispatchGroup>();

  for (const notification of claimed) {
    const anchor = notification.churchId ?? notification.anchorOrgId;
    if (!anchor) {
      // Unreachable while `notifications_anchor_check` holds — a row satisfies
      // it only by carrying exactly one of the two. Skipped rather than grouped
      // under a guessed tenant: the row stays claimed and is reported, which is
      // loud, whereas a `null` key is silent and cross-tenant.
      console.error(
        `[notifications/dispatch] notification ${notification.id} has no anchor; skipping it`
      );
      continue;
    }

    const key = `${anchor}|${notification.recipientUserId}|${notification.category}`;
    const existing = groups.get(key);
    if (existing) {
      existing.notifications.push(notification);
      continue;
    }
    groups.set(key, {
      key,
      anchorId: anchor,
      recipientUserId: notification.recipientUserId,
      category: notification.category,
      notifications: [notification],
    });
  }

  return [...groups.values()];
}

// ----------------------------------------------------------------------------
// Per-channel result, and what it means for the queue row
// ----------------------------------------------------------------------------

export type ChannelResult =
  | { kind: "sent" }
  /** The user opted this channel out. Nothing was owed on it. */
  | { kind: "suppressed" }
  | { kind: "failed" }
  /** Still owed an attempt — a backoff window that has not elapsed. */
  | { kind: "retry" }
  /** Someone else already settled this channel; nothing owed here either. */
  | { kind: "settled" };

/**
 * The queue row's post-run status, from its channels' results.
 *
 * Three rules, in order:
 *
 *   1. A channel still owed an attempt outranks everything — the row goes back
 *      to `pending` so the next tick picks it up.
 *   2. SUPPRESSED channels do not vote. An opt-out is a choice, not an outcome
 *      to be judged: a notification whose only enabled channel bounced is
 *      `failed`, and one the user opted out of entirely is done, not failed.
 *   3. Otherwise `failed` only when every channel that was actually attempted
 *      failed. One delivered channel means the notification reached the user,
 *      whatever the other channel did.
 */
export function statusFromChannelResults(
  results: readonly ChannelResult[]
): NotificationStatus {
  if (results.some((result) => result.kind === "retry")) return "pending";

  const attempted = results.filter((result) => result.kind !== "suppressed");
  if (attempted.length === 0) return "delivered";
  if (attempted.every((result) => result.kind === "failed")) return "failed";
  return "delivered";
}

// ----------------------------------------------------------------------------
// The run
// ----------------------------------------------------------------------------

/**
 * One dispatch pass.
 *
 * Claims a bounded batch of due notifications, groups it per N-012, re-checks
 * each subject is still live per N-014, delivers per enabled channel and
 * records every outcome per N-016. Anything it does not get to is left pending
 * (N-017) — including rows it claimed but could not process before the budget
 * ran out, which are explicitly released.
 */
export async function runDispatch(
  deps: DispatchDeps,
  options: DispatchOptions = {}
): Promise<DispatchRunSummary> {
  const startedAt = Date.now();
  const elapsedMs = options.elapsedMs ?? (() => Date.now() - startedAt);
  const now = options.now ?? new Date();
  const maxAttempts = options.maxAttempts ?? MAX_DELIVERY_ATTEMPTS;
  const budgetMs = options.budgetMs ?? RUN_BUDGET_MS;
  const limit = Math.min(
    Math.max(options.maxBatch ?? MAX_DISPATCH_BATCH, 1),
    500
  );

  const summary: DispatchRunSummary = {
    claimed: 0,
    remainingPending: 0,
    groups: 0,
    emailsSent: 0,
    delivered: 0,
    cancelled: 0,
    failed: 0,
    retryScheduled: 0,
    deferred: 0,
    suppressed: 0,
    addressSuppressed: 0,
    released: 0,
    durationMs: 0,
  };

  const claimed = await deps.claimDue(now, limit);
  summary.claimed = claimed.length;
  // Read AFTER the claim, so it is genuinely "what is left over", which is the
  // number N-017's acceptance criterion asserts on.
  summary.remainingPending = await deps.countRemainingDue(now);

  if (claimed.length === 0) {
    summary.durationMs = elapsedMs();
    return summary;
  }

  const recipientIds = [...new Set(claimed.map((n) => n.recipientUserId))];
  const notificationIds = claimed.map((n) => n.id);

  // Three batched reads for the whole run. Anything per-notification here would
  // be an N+1 inside a function with a hard timeout.
  const [recipientRows, preferenceRows, deliveryRows] = await Promise.all([
    deps.loadRecipients(recipientIds),
    deps.loadPreferences(recipientIds),
    deps.loadDeliveries(notificationIds),
  ]);

  const recipients = new Map(recipientRows.map((row) => [row.id, row]));
  const preferences = new Map<string, NotificationPreference[]>();
  for (const row of preferenceRows) {
    const list = preferences.get(row.userId);
    if (list) list.push(row);
    else preferences.set(row.userId, [row]);
  }
  const deliveries = new Map<string, NotificationDelivery>();
  for (const row of deliveryRows) {
    deliveries.set(`${row.notificationId}|${row.channel}`, row);
  }

  // #324. A FOURTH batched read, and it has to follow the first three because
  // it is keyed on the addresses `loadRecipients` just returned. One extra
  // round trip per run, against a domain reputation that takes months to earn
  // back.
  const suppressedAddresses = new Set(
    await deps.loadSuppressedAddresses(
      recipientRows.map((row) => row.email).filter(Boolean)
    )
  );

  const groups = groupForDispatch(claimed);
  summary.groups = groups.length;

  for (let index = 0; index < groups.length; index += 1) {
    // Checked BETWEEN groups, never inside one: abandoning a group mid-send
    // would leave some of its notifications settled and some claimed, and the
    // grouped email already went out.
    if (index > 0 && elapsedMs() >= budgetMs) {
      const stranded = groups
        .slice(index)
        .flatMap((group) => group.notifications.map((n) => n.id));
      await deps.releaseClaims(stranded, now);
      summary.released = stranded.length;
      summary.groups = index;
      console.warn(
        `[notifications/dispatch] budget of ${budgetMs}ms reached; released ${stranded.length} claimed notification(s) back to pending.`
      );
      break;
    }

    await processGroup(groups[index], {
      deps,
      now,
      maxAttempts,
      summary,
      recipient: recipients.get(groups[index].recipientUserId),
      preferenceRows: preferences.get(groups[index].recipientUserId) ?? [],
      deliveries,
      suppressedAddresses,
    });
  }

  summary.durationMs = elapsedMs();
  return summary;
}

interface GroupContext {
  deps: DispatchDeps;
  now: Date;
  maxAttempts: number;
  summary: DispatchRunSummary;
  recipient: DispatchRecipient | undefined;
  preferenceRows: NotificationPreference[];
  deliveries: Map<string, NotificationDelivery>;
  /** Normalised addresses this run must not mail (#324). */
  suppressedAddresses: Set<string>;
}

async function processGroup(
  group: DispatchGroup,
  ctx: GroupContext
): Promise<void> {
  const { deps, now, maxAttempts, summary } = ctx;

  // --- N-014: what is still worth announcing -------------------------------
  const live: Notification[] = [];

  for (const notification of group.notifications) {
    const liveness = await resolveLiveness(notification);

    if (liveness === "live") {
      live.push(notification);
      continue;
    }

    if (liveness === "unknown") {
      // Neither delivered nor cancelled — hand it back and try next tick.
      await deps.releaseClaims([notification.id], now);
      summary.deferred += 1;
      continue;
    }

    // Resolved: the subject went away. Record it on every channel that has no
    // outcome yet, so "why did this never arrive?" is answerable (N-016).
    for (const channel of notificationChannels) {
      await deps.recordTerminalDelivery(
        notification.id,
        channel,
        "cancelled",
        now
      );
    }
    await deps.finishNotification(notification.id, "cancelled", now);
    summary.cancelled += 1;
  }

  if (live.length === 0) return;

  const results = new Map<string, ChannelResult[]>();
  const record = (notificationId: string, result: ChannelResult) => {
    const list = results.get(notificationId);
    if (list) list.push(result);
    else results.set(notificationId, [result]);
  };

  // Which coded defaults apply when this recipient has no explicit row. An
  // unknown recipient (deleted between claim and dispatch) falls back to the
  // church defaults — the conservative direction, and the delivery fails on the
  // missing address a few lines down anyway.
  const audience = ctx.recipient
    ? audienceForRole(ctx.recipient.role)
    : "church";

  const emailEnabled = isChannelEnabled(
    ctx.preferenceRows,
    group.category,
    "email",
    audience
  );
  const inAppEnabled = isChannelEnabled(
    ctx.preferenceRows,
    group.category,
    "in_app",
    audience
  );

  // --- in-app --------------------------------------------------------------
  // The notification row IS the feed row, so "delivery" here is recording that
  // the feed now carries it. It still goes through the same claim, so the feed
  // and the email cannot disagree about what happened (N-016), and twenty
  // grouped notifications stay twenty feed rows (N-012).
  for (const notification of live) {
    if (!inAppEnabled) {
      await deps.recordTerminalDelivery(
        notification.id,
        "in_app",
        "suppressed_by_preference",
        now
      );
      summary.suppressed += 1;
      record(notification.id, { kind: "suppressed" });
      continue;
    }

    const eligibility = channelEligibility(
      ctx.deliveries.get(`${notification.id}|in_app`),
      now,
      maxAttempts
    );
    if (!eligibility.eligible) {
      record(notification.id, resultForIneligible(eligibility.reason));
      continue;
    }

    const claim = await deps.claimDelivery(
      notification.id,
      "in_app",
      maxAttempts
    );
    if (claim.status === "lost") {
      record(notification.id, { kind: "settled" });
      continue;
    }

    await deps.settleDelivery({
      notificationId: notification.id,
      channel: "in_app",
      status: "sent",
      sentAt: now,
      now,
    });
    record(notification.id, { kind: "sent" });
  }

  // --- email (N-012: one call for the whole group) --------------------------
  const emailCandidates: Notification[] = [];

  for (const notification of live) {
    if (!emailEnabled) {
      await deps.recordTerminalDelivery(
        notification.id,
        "email",
        "suppressed_by_preference",
        now
      );
      summary.suppressed += 1;
      record(notification.id, { kind: "suppressed" });
      continue;
    }

    const eligibility = channelEligibility(
      ctx.deliveries.get(`${notification.id}|email`),
      now,
      maxAttempts
    );
    if (!eligibility.eligible) {
      record(notification.id, resultForIneligible(eligibility.reason));
      continue;
    }

    emailCandidates.push(notification);
  }

  if (emailCandidates.length > 0) {
    await deliverEmailGroup(group, emailCandidates, ctx, record);
  }

  // --- the queue row's post-run status --------------------------------------
  for (const notification of live) {
    const channelResults = results.get(notification.id) ?? [];
    const status = statusFromChannelResults(channelResults);

    await deps.finishNotification(notification.id, status, now);

    if (status === "pending") summary.retryScheduled += 1;
    else if (status === "failed") summary.failed += 1;
    else summary.delivered += 1;
  }
}

/** How an ineligible channel scores when the row's status is decided. */
function resultForIneligible(reason: ChannelIneligibility): ChannelResult {
  // Only backoff is still owed. `in_flight` is deliberately NOT retried — see
  // the module header: an unsettled claim from a crashed run cannot be proven
  // undelivered, and N-004 resolves that doubt against sending again.
  return reason === "in_backoff" ? { kind: "retry" } : { kind: "settled" };
}

async function deliverEmailGroup(
  group: DispatchGroup,
  candidates: readonly Notification[],
  ctx: GroupContext,
  record: (notificationId: string, result: ChannelResult) => void
): Promise<void> {
  const { deps, now, maxAttempts, summary } = ctx;

  if (!ctx.recipient?.email) {
    // No address is a permanent failure, not a transient one: no number of
    // retries produces an email address.
    const error = `${PERMANENT_FAILURE_PREFIX}recipient has no email address`;
    for (const notification of candidates) {
      const claim = await deps.claimDelivery(
        notification.id,
        "email",
        maxAttempts
      );
      if (claim.status === "lost") {
        record(notification.id, { kind: "settled" });
        continue;
      }
      await deps.settleDelivery({
        notificationId: notification.id,
        channel: "email",
        status: "failed",
        error,
        now,
      });
      record(notification.id, { kind: "failed" });
    }
    return;
  }

  // --- #324: is this address suppressed? -----------------------------------
  //
  // BEFORE COMPOSING, and REPORTED rather than thrown. A permanently-bounced
  // address is a normal outcome — somebody's mailbox died — and a throw here
  // would strand every claimed row in the run over one dead mailbox.
  //
  // The shape is deliberately IDENTICAL to the no-address branch above: claim
  // each notification's email channel, settle it `failed` with the permanent
  // prefix, and record it. That is what makes the skip answerable — "why did
  // this never arrive?" reads the delivery row's own error text (N-016), not a
  // log line that has since rotated — and the prefix is what stops
  // `channelEligibility` retrying it even after this check is passed.
  //
  // The claim still bumps `attempt_count` without a provider call, exactly as
  // the no-address branch does. That is consistent rather than a lie: the
  // number counts attempts to DELIVER, and this attempt was made and refused.
  if (ctx.suppressedAddresses.has(normalizeEmailAddress(ctx.recipient.email))) {
    const error = `${PERMANENT_FAILURE_PREFIX}address suppressed after a permanent bounce or spam complaint`;
    for (const notification of candidates) {
      const claim = await deps.claimDelivery(
        notification.id,
        "email",
        maxAttempts
      );
      if (claim.status === "lost") {
        record(notification.id, { kind: "settled" });
        continue;
      }
      await deps.settleDelivery({
        notificationId: notification.id,
        channel: "email",
        status: "failed",
        error,
        now,
      });
      record(notification.id, { kind: "failed" });
      summary.addressSuppressed += 1;
    }
    return;
  }

  // Claim every notification's email channel BEFORE composing. A notification
  // whose claim is lost to a concurrent run must not appear in the body of an
  // email this run sends, or that run's copy is duplicated in ours.
  const owned: { notification: Notification; attemptCount: number }[] = [];
  for (const notification of candidates) {
    const claim = await deps.claimDelivery(
      notification.id,
      "email",
      maxAttempts
    );
    if (claim.status === "lost") {
      record(notification.id, { kind: "settled" });
      continue;
    }
    owned.push({ notification, attemptCount: claim.attemptCount });
  }

  if (owned.length === 0) return;

  const items = owned.map((entry) => entry.notification);

  // Composition can fail — the unsubscribe link is minted here, and N-007 says
  // an email without a working one must not go out. Contain it: this group's
  // deliveries are settled as failures (transient, so the bounded retry picks
  // them up once the configuration is fixed) rather than letting the throw
  // escape `runDispatch` and strand every claimed row in the run.
  let message: OutboundEmail;
  try {
    // WHICH TEMPLATE is decided from the rows themselves, not from the
    // category: see `emailComposerForGroup`. The failure containment below is
    // unchanged and covers every composer equally.
    message = await emailComposerForGroup(items)(
      ctx.recipient,
      group.category,
      items,
      groupIdempotencyKey(
        group.anchorId,
        group.recipientUserId,
        group.category,
        items.map((item) => item.id)
      )
    );
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    console.error(
      `[notifications/dispatch] could not compose the email for group ${group.key}:`,
      reason
    );
    for (const { notification, attemptCount } of owned) {
      await deps.settleDelivery({
        notificationId: notification.id,
        channel: "email",
        status: "failed",
        error: `could not compose email: ${reason}`,
        now,
      });
      record(
        notification.id,
        attemptCount >= maxAttempts ? { kind: "failed" } : { kind: "retry" }
      );
    }
    return;
  }

  const outcome = await deps.sendEmail(message);
  summary.emailsSent += 1;

  if (outcome.status === "sent") {
    for (const { notification } of owned) {
      await deps.settleDelivery({
        notificationId: notification.id,
        channel: "email",
        status: "sent",
        providerMessageId: outcome.providerMessageId ?? null,
        sentAt: now,
        now,
      });
      record(notification.id, { kind: "sent" });
    }
    return;
  }

  for (const { notification, attemptCount } of owned) {
    const exhausted = outcome.permanent || attemptCount >= maxAttempts;
    await deps.settleDelivery({
      notificationId: notification.id,
      channel: "email",
      status: "failed",
      error: outcome.permanent
        ? `${PERMANENT_FAILURE_PREFIX}${outcome.error}`
        : outcome.error,
      now,
    });
    record(notification.id, exhausted ? { kind: "failed" } : { kind: "retry" });
  }
}

// ----------------------------------------------------------------------------
// Production wiring
// ----------------------------------------------------------------------------

/** Exactly the columns addressing needs. Never `select()` on `users`. */
const recipientColumns = {
  id: users.id,
  email: users.email,
  name: users.name,
  // Needed for `audienceForRole` — an oversight recipient's coded default for
  // `digest`/`in_app` differs (N-027). Still a projection, not `select()`:
  // `password_hash` has no business in a dispatcher run.
  role: users.role,
};

export const dbDispatchDeps: DispatchDeps = {
  async claimDue(now, limit) {
    // The due, unclaimed frontier, locked so a concurrent run's identical
    // statement skips these rows instead of blocking on them.
    const due = db
      .select({ id: notifications.id })
      .from(notifications)
      .where(
        and(
          eq(notifications.status, "pending"),
          lte(notifications.scheduledFor, now)
        )
      )
      .orderBy(notifications.scheduledFor, notifications.id)
      .limit(limit)
      .for("update", { skipLocked: true });

    // ONE statement: the select and the claim cannot be interleaved by another
    // run, which is what makes this a claim rather than a read followed by a
    // hope. `status = 'pending'` is repeated in the outer predicate so the
    // update is still correct if the subquery is ever hoisted or replanned.
    return db
      .update(notifications)
      .set({ status: "claimed", updatedAt: now })
      .where(
        and(eq(notifications.status, "pending"), inArray(notifications.id, due))
      )
      .returning();
  },

  async countRemainingDue(now) {
    const [row] = await db
      .select({ value: count() })
      .from(notifications)
      .where(
        and(
          eq(notifications.status, "pending"),
          lte(notifications.scheduledFor, now)
        )
      );
    return row?.value ?? 0;
  },

  async loadRecipients(userIds) {
    if (userIds.length === 0) return [];
    return db
      .select(recipientColumns)
      .from(users)
      .where(inArray(users.id, [...userIds]));
  },

  async loadPreferences(userIds) {
    if (userIds.length === 0) return [];
    // The dispatcher reads other users' consent records by necessity, so it
    // does NOT go through `loadUserPreferences` — that entrypoint takes a
    // `PreferenceOwner`, mintable only from a session, and weakening it to
    // accept a bare id would remove the guarantee it exists for. This is the
    // named, greppable exception, exactly as `listForDispatch` is for reads.
    return db
      .select()
      .from(notificationPreferences)
      .where(inArray(notificationPreferences.userId, [...userIds]));
  },

  async loadDeliveries(notificationIds) {
    if (notificationIds.length === 0) return [];
    return db
      .select()
      .from(notificationDeliveries)
      .where(
        inArray(notificationDeliveries.notificationId, [...notificationIds])
      );
  },

  async claimDelivery(notificationId, channel, maxAttempts) {
    const [claimed] = await db
      .insert(notificationDeliveries)
      .values({
        notificationId,
        channel,
        status: "queued",
        attemptCount: 1,
      })
      // Arbitrated by `notification_deliveries_notification_channel_idx`. The
      // DO UPDATE fires only for a retryable failure, so `sent`, `queued`,
      // `cancelled`, `suppressed_by_preference` and exhausted rows all yield NO
      // returned row — this run does not own the attempt and must not send.
      // That is at-most-once as a database property (N-004).
      .onConflictDoUpdate({
        target: [
          notificationDeliveries.notificationId,
          notificationDeliveries.channel,
        ],
        set: {
          status: "queued",
          attemptCount: sql`${notificationDeliveries.attemptCount} + 1`,
          updatedAt: new Date(),
        },
        setWhere: and(
          eq(notificationDeliveries.status, "failed"),
          sql`${notificationDeliveries.attemptCount} < ${maxAttempts}`,
          sql`coalesce(${notificationDeliveries.error}, '') not like ${`${PERMANENT_FAILURE_PREFIX}%`}`
        ),
      })
      .returning();

    return claimed
      ? { status: "claimed", attemptCount: claimed.attemptCount }
      : { status: "lost" };
  },

  async recordTerminalDelivery(notificationId, channel, status, now) {
    await db
      .insert(notificationDeliveries)
      .values({
        notificationId,
        channel,
        status,
        attemptCount: 0,
        createdAt: now,
        updatedAt: now,
      })
      // DO NOTHING, never DO UPDATE: a channel that already reached an outcome
      // keeps it. A late `cancelled` must not overwrite a `sent`.
      .onConflictDoNothing({
        target: [
          notificationDeliveries.notificationId,
          notificationDeliveries.channel,
        ],
      });
  },

  async settleDelivery({
    notificationId,
    channel,
    status,
    error,
    providerMessageId,
    sentAt,
    now,
  }) {
    await db
      .update(notificationDeliveries)
      .set({
        status,
        // Populated only on failure (schema contract), and cleared on success
        // so a retry that works does not leave the old error behind.
        error: status === "failed" ? (error ?? null) : null,
        providerMessageId: providerMessageId ?? null,
        sentAt: sentAt ?? null,
        updatedAt: now,
      })
      .where(
        and(
          eq(notificationDeliveries.notificationId, notificationId),
          eq(notificationDeliveries.channel, channel)
        )
      );
  },

  async finishNotification(notificationId, status, now) {
    // Scoped to `claimed` so this run can only settle what it claimed — a
    // cancel-by-entity that landed mid-run wins, and the row stays cancelled.
    await db
      .update(notifications)
      .set({ status, updatedAt: now })
      .where(
        and(
          eq(notifications.id, notificationId),
          eq(notifications.status, "claimed")
        )
      );
  },

  async releaseClaims(notificationIds, now) {
    if (notificationIds.length === 0) return;
    await db
      .update(notifications)
      .set({ status: "pending", updatedAt: now })
      .where(
        and(
          inArray(notifications.id, [...notificationIds]),
          eq(notifications.status, "claimed")
        )
      );
  },

  loadSuppressedAddresses(emails) {
    return loadSuppressedAddressesFromDb(emails);
  },

  async sendEmail(message) {
    const result = await sendProviderEmail({
      to: message.to,
      subject: message.subject,
      html: message.html,
      text: message.text,
      idempotencyKey: message.idempotencyKey,
      // `List-Unsubscribe`, so the mail client's own opt-out control works.
      headers: message.headers,
    });

    if (result.success) {
      return { status: "sent", providerMessageId: result.id ?? null };
    }

    const error = result.error ?? "unknown provider error";
    return { status: "failed", error, permanent: isPermanentEmailError(error) };
  },
};

/** The wired-up entrypoint the scheduled route calls. */
export function dispatchNotifications(
  options: DispatchOptions = {}
): Promise<DispatchRunSummary> {
  return runDispatch(dbDispatchDeps, options);
}
