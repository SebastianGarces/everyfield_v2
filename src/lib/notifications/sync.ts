import type { NotificationCategory } from "./categories";
import type {
  CancelByEntityInput,
  CancelByEntityResult,
  EnqueueNotificationInput,
  EnqueueResult,
} from "./enqueue";

// ============================================================================
// The consumer-side sync skeleton — cancel, plan, enqueue, tally (N-011).
//
// Every feature that puts rows on the F11 queue does the SAME eight things in
// the same order: decide whether to cancel, cancel by entity reference, build a
// plan, loop it into `enqueue`, count recorded / created / skipped / failed,
// keep one item's failure off the others, swallow the whole thing, and return a
// report. Only the middle step — the facts, the planner, the differ — is the
// feature's own.
//
// It lives HERE, beside `enqueue`/`cancelByEntity`, because it is a rule of the
// queue rather than of any subject: "a reschedule is cancel + re-enqueue", "a
// notification never fails the write that caused it", and "one recipient's
// failure does not cost the others theirs" are all F11's. Written per-feature it
// arrived as ~160 duplicated lines across `src/lib/tasks/notifications.ts` and
// `src/lib/meetings/notifications.ts` in one PR, already diverging (the two
// copies of this loop differed only in a log string), which is a fix that has to
// land twice and a reader who has to verify it twice.
//
// A THIRD CONSUMER IS A PLANNER PLUS A REGISTRATION. It writes its facts type,
// its `plan*`, its differ, its deps and its still-live predicate, calls this,
// and adds itself to `register-consumers.ts`. It writes no tally loop, no report
// shape and no `clampTitle`.
//
// BEST-EFFORT, ALWAYS. Nothing below throws: the subject is already written, and
// a notification must never be able to fail — or undo — the write that caused it
// (`memory/invariants.md` → Transactions / Atomicity).
// ============================================================================

/** The closed entity-reference vocabulary, borrowed from the cancel's parse. */
export type NotificationEntityType = CancelByEntityInput["entityType"];

/**
 * What a sync did, without throwing.
 *
 * `Reason` is the feature's own "why was nothing enqueued?" vocabulary — a
 * string union it defines — so a report says `"no_due_date"` or `"in_the_past"`
 * rather than a shared enum nobody can extend.
 */
export interface NotificationSyncReport<Reason extends string = string> {
  /** Pending rows cancelled before the re-enqueue. */
  cancelled: number;
  /** Enqueue calls made — one per (subject, recipient, condition). */
  considered: number;
  recorded: number;
  created: number;
  skipped: number;
  failed: number;
  /** Why nothing was enqueued, when nothing was. */
  reason: Reason | null;
}

export function emptyNotificationSyncReport<
  Reason extends string = string,
>(): NotificationSyncReport<Reason> {
  return {
    cancelled: 0,
    considered: 0,
    recorded: 0,
    created: 0,
    skipped: 0,
    failed: 0,
    reason: null,
  };
}

/** What a feature's planner returns: the rows it owes, or why it owes none. */
export interface NotificationSyncPlan<Reason extends string = string> {
  notifications: EnqueueNotificationInput[];
  skipped: Reason | null;
}

/**
 * The two writes a sync makes. Injectable so a feature suite can drive the real
 * `runEnqueue` / `runCancelByEntity` over an in-memory store.
 */
export interface NotificationSyncDeps {
  enqueue(input: EnqueueNotificationInput): Promise<EnqueueResult>;
  cancelByEntity(input: CancelByEntityInput): Promise<CancelByEntityResult>;
}

/** The entity a sync is about, and the category it files rows under. */
export interface NotificationSubject {
  churchId: string;
  entityType: NotificationEntityType;
  entityId: string;
  category: NotificationCategory;
  /**
   * What a log line calls this subject — `"task"`, `"meeting"`. Only ever read
   * by `console.error`; it is not a discriminator and nothing branches on it.
   */
  label: string;
}

export interface NotificationSyncInput<
  Reason extends string,
> extends NotificationSubject {
  /**
   * Whether the cancel half runs. The feature decides it, because only the
   * feature knows whether the write changed anything a pending row says — see
   * each module's `*NotificationsDiffer`.
   */
  mustCancel: boolean;
  /**
   * What the subject owes now. A THUNK, not a value: it runs AFTER the cancel,
   * which is what lets a planner read state the cancel may have changed (the
   * meeting audience is resolved here, for one).
   */
  plan: () =>
    | NotificationSyncPlan<Reason>
    | Promise<NotificationSyncPlan<Reason>>;
  deps: NotificationSyncDeps;
  /**
   * A replayable owner-side reconciler may require every queue write to
   * converge before it records its own terminal outcome. Ordinary product
   * writers remain best-effort because their subject write is already final.
   */
  failureMode?: "best_effort" | "required";
}

/**
 * Cancel what is pending for this subject, then enqueue what it now owes.
 *
 * ONE path for create, edit, reschedule and reopen, because they are the same
 * operation to F11 (N-011). A create is simply the case where the cancel matched
 * nothing — which is why `mustCancel: false` is an optimisation and never a
 * correctness rule.
 *
 * Cancelling RELEASES the `dedupeKey` (the unique index is partial on
 * `status <> 'cancelled'`), which is what makes the re-enqueue land instead of
 * being swallowed by the row it just replaced.
 */
export async function runNotificationSync<Reason extends string>(
  input: NotificationSyncInput<Reason>
): Promise<NotificationSyncReport<Reason>> {
  const report = emptyNotificationSyncReport<Reason>();
  const failures: unknown[] = [];

  try {
    if (input.mustCancel) {
      const cancelled = await input.deps.cancelByEntity({
        churchId: input.churchId,
        entityType: input.entityType,
        entityId: input.entityId,
        category: input.category,
      });
      report.cancelled = cancelled.cancelledCount;
    }

    const plan = await input.plan();
    report.reason = plan.skipped;
    report.considered = plan.notifications.length;

    for (const notification of plan.notifications) {
      try {
        const result = await input.deps.enqueue(notification);
        if (result.status === "recorded") {
          report.recorded += 1;
          if (result.created) report.created += 1;
        } else {
          report.skipped += 1;
        }
      } catch (error) {
        // One row's failure must not cost the rest of the plan theirs.
        report.failed += 1;
        failures.push(error);
        console.error(`${input.label} notification enqueue failed`, {
          entityId: input.entityId,
          type: notification.type,
          error,
        });
      }
    }
  } catch (error) {
    if (input.failureMode === "required") report.failed += 1;
    failures.push(error);
    console.error(`${input.label} notification sync failed`, {
      entityId: input.entityId,
      error,
    });
  }

  if (input.failureMode === "required" && failures.length > 0) {
    throw new AggregateError(
      failures,
      `${failures.length} required ${input.label} notification write(s) failed`
    );
  }

  return report;
}

/**
 * The subject went away — completed, cancelled or deleted. Cancel every pending
 * row about it, by entity reference, across every recipient and condition.
 *
 * Safe when nothing is pending: it resolves to zero rather than throwing, so no
 * write path has to know whether its subject ever had a notification.
 */
export async function cancelEntityNotifications(
  subject: NotificationSubject,
  deps: NotificationSyncDeps
): Promise<number> {
  try {
    const result = await deps.cancelByEntity({
      churchId: subject.churchId,
      entityType: subject.entityType,
      entityId: subject.entityId,
      category: subject.category,
    });
    return result.cancelledCount;
  } catch (error) {
    console.error(`${subject.label} notification cancel failed`, {
      entityId: subject.entityId,
      error,
    });
    return 0;
  }
}
