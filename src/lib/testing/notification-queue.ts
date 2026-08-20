import type { TenancyFields } from "@/lib/auth/tenancy";
import type {
  NewNotification,
  Notification,
  NotificationChannel,
  NotificationDelivery,
  NotificationPreference,
  NotificationStatus,
} from "@/db/schema";
import type {
  CancelByEntityDeps,
  CancelByEntityInput,
  EnqueueDeps,
  EnqueueNotificationInput,
  EnqueueResult,
  RecipientCheck,
  RecipientNotifiableInput,
} from "@/lib/notifications/enqueue";
import { runCancelByEntity, runEnqueue } from "@/lib/notifications/enqueue";
import type {
  DeliveryClaim,
  DispatchDeps,
  DispatchRecipient,
  EmailSendOutcome,
  OutboundEmail,
  SettleDeliveryInput,
} from "@/lib/notifications/dispatch";
import { PERMANENT_FAILURE_PREFIX } from "@/lib/notifications/permanent-failure";
import type { NotificationAnchor } from "@/lib/notifications/anchor";

// ============================================================================
// An in-memory stand-in for the F11 tables, for FEATURE-SIDE tests.
//
// `src/lib/notifications/{enqueue,dispatch}.test.ts` each own a fake of their
// own half, because each is testing that half's orchestration. A feature
// adopting F11 (F5's task notifications, F3's meeting reminders) needs BOTH
// halves over ONE set of rows: the interesting assertions are "what did the
// enqueue leave pending?" and "what did a dispatch run then do with it?", and
// those are the same rows seen twice.
//
// So this store is the notifications, deliveries and preferences tables at
// once, and the code under test is driven through the REAL `runEnqueue`,
// `runCancelByEntity` and `runDispatch`. What is faked is Postgres and the
// email provider — never the logic.
//
// The two database properties it models most carefully are the two the feature
// contract rests on:
//
//   1. THE PARTIAL UNIQUE INDEX on (church_id, recipient_user_id, dedupe_key)
//      WHERE dedupe_key IS NOT NULL AND status <> 'cancelled'. Same key, same
//      recipient, live row → the insert writes nothing; a CANCELLED holder is
//      not in the index, so the key is free again. That is what makes
//      "reschedule is cancel + re-enqueue" work at all.
//   2. `cancelPending` touches PENDING rows only. A row a dispatch run has
//      already claimed is that run's, which is why a still-live predicate is
//      not optional for a feature whose subject can resolve.
// ============================================================================

/** A no-op provider outcome, so a test that ignores email still gets one. */
const SENT: EmailSendOutcome = { status: "sent", providerMessageId: "m-1" };

export class FakeNotificationQueue
  implements EnqueueDeps, CancelByEntityDeps, DispatchDeps
{
  readonly rows: Notification[] = [];
  readonly deliveries: NotificationDelivery[] = [];
  readonly preferences: NotificationPreference[] = [];
  readonly recipients: DispatchRecipient[] = [];
  readonly sends: OutboundEmail[] = [];

  /**
   * Recipients `recipientMayBeNotified` refuses, as `outside_church`. Empty by
   * default: the gate is `enqueue`'s own and has its own suite — a feature test
   * cares that a refusal is SKIPPED rather than thrown, not how it is decided.
   */
  readonly barred = new Set<string>();

  private sequence = 0;
  private deliverySequence = 0;

  private stamp = new Date("2026-08-14T09:00:00.000Z");

  // -- seeding --------------------------------------------------------------

  addRecipient(
    id: string,
    email = `${id}@example.test`,
    tenancy: TenancyFields = {
      churchId: null,
      sendingChurchId: null,
      sendingNetworkId: null,
    }
  ): DispatchRecipient {
    const recipient: DispatchRecipient = {
      id,
      email,
      name: null,
      ...tenancy,
    };
    this.recipients.push(recipient);
    return recipient;
  }

  setPreference(
    userId: string,
    category: NotificationPreference["category"],
    channel: NotificationChannel,
    enabled: boolean
  ): void {
    this.preferences.push({
      id: `p-${this.preferences.length + 1}`,
      userId,
      category,
      channel,
      enabled,
      // The shape the settings toggle leaves behind — see `setPreferenceQuery`.
      intent: "chosen",
      digestCadence: null,
      createdAt: this.stamp,
      updatedAt: this.stamp,
    });
  }

  // -- reads a test asserts on ----------------------------------------------

  pending(type?: string): Notification[] {
    return this.rows.filter(
      (row) =>
        row.status === "pending" && (type === undefined || row.type === type)
    );
  }

  byStatus(status: NotificationStatus): Notification[] {
    return this.rows.filter((row) => row.status === status);
  }

  deliveryFor(
    notificationId: string,
    channel: NotificationChannel
  ): NotificationDelivery | undefined {
    return this.deliveries.find(
      (row) => row.notificationId === notificationId && row.channel === channel
    );
  }

  // -- the two entrypoints a feature is handed ------------------------------

  /** The real orchestration, over this store. Hand it to a feature's deps. */
  enqueue = (input: EnqueueNotificationInput): Promise<EnqueueResult> =>
    runEnqueue(this, input);

  cancelByEntity = (input: CancelByEntityInput) =>
    runCancelByEntity(this, input);

  // -- EnqueueDeps ----------------------------------------------------------

  async recipientMayBeNotified({
    recipientUserId,
  }: RecipientNotifiableInput): Promise<RecipientCheck> {
    return this.barred.has(recipientUserId)
      ? { allowed: false, reason: "outside_church" }
      : { allowed: true };
  }

  async insertIfAbsent(row: NewNotification): Promise<Notification | null> {
    const dedupeKey = row.dedupeKey ?? null;

    // The partial unique index. NULL keys never collide; a CANCELLED holder is
    // not in the index at all, so its key is free.
    if (
      dedupeKey !== null &&
      this.rows.some(
        (existing) =>
          existing.churchId === (row.churchId ?? null) &&
          existing.recipientUserId === row.recipientUserId &&
          existing.dedupeKey === dedupeKey &&
          existing.status !== "cancelled"
      )
    ) {
      return null;
    }

    this.sequence += 1;
    const stored: Notification = {
      id: `n-${this.sequence}`,
      anchorType: row.anchorType ?? "church",
      churchId: row.churchId ?? null,
      anchorOrgId: row.anchorOrgId ?? null,
      recipientUserId: row.recipientUserId,
      category: row.category,
      type: row.type,
      title: row.title,
      body: row.body,
      entityType: row.entityType ?? null,
      entityId: row.entityId ?? null,
      dedupeKey,
      scheduledFor: row.scheduledFor ?? this.stamp,
      status: row.status ?? "pending",
      readAt: null,
      createdAt: this.stamp,
      updatedAt: this.stamp,
    };

    this.rows.push(stored);
    return stored;
  }

  async findByDedupeKey(
    anchor: NotificationAnchor,
    recipientUserId: string,
    dedupeKey: string
  ): Promise<Notification | null> {
    const churchId = anchor.type === "church" ? anchor.churchId : null;
    return (
      this.rows.find(
        (row) =>
          row.churchId === churchId &&
          row.recipientUserId === recipientUserId &&
          row.dedupeKey === dedupeKey &&
          row.status !== "cancelled"
      ) ?? null
    );
  }

  // -- CancelByEntityDeps ---------------------------------------------------

  async cancelPending({
    churchId,
    entityType,
    entityId,
    category,
  }: CancelByEntityInput): Promise<{ id: string }[]> {
    const matched = this.rows.filter(
      (row) =>
        row.churchId === churchId &&
        row.entityType === entityType &&
        row.entityId === entityId &&
        row.status === "pending" &&
        (category === undefined || row.category === category)
    );

    for (const row of matched) row.status = "cancelled";
    return matched.map((row) => ({ id: row.id }));
  }

  // -- DispatchDeps ---------------------------------------------------------

  async claimDue(now: Date, limit: number): Promise<Notification[]> {
    const due = this.rows
      .filter(
        (row) =>
          row.status === "pending" &&
          row.scheduledFor.getTime() <= now.getTime()
      )
      .sort(
        (a, b) =>
          a.scheduledFor.getTime() - b.scheduledFor.getTime() ||
          a.id.localeCompare(b.id)
      )
      .slice(0, limit);

    for (const row of due) {
      row.status = "claimed";
      row.updatedAt = now;
    }
    return due.map((row) => ({ ...row }));
  }

  async countRemainingDue(now: Date): Promise<number> {
    return this.rows.filter(
      (row) =>
        row.status === "pending" && row.scheduledFor.getTime() <= now.getTime()
    ).length;
  }

  async loadRecipients(
    userIds: readonly string[]
  ): Promise<DispatchRecipient[]> {
    return this.recipients.filter((row) => userIds.includes(row.id));
  }

  async loadPreferences(
    userIds: readonly string[]
  ): Promise<NotificationPreference[]> {
    return this.preferences.filter((row) => userIds.includes(row.userId));
  }

  async loadDeliveries(
    notificationIds: readonly string[]
  ): Promise<NotificationDelivery[]> {
    return this.deliveries
      .filter((row) => notificationIds.includes(row.notificationId))
      .map((row) => ({ ...row }));
  }

  async claimDelivery(
    notificationId: string,
    channel: NotificationChannel,
    maxAttempts: number
  ): Promise<DeliveryClaim> {
    const existing = this.deliveryFor(notificationId, channel);

    if (!existing) {
      this.deliverySequence += 1;
      const row: NotificationDelivery = {
        id: `d-${this.deliverySequence}`,
        notificationId,
        channel,
        status: "queued",
        attemptCount: 1,
        error: null,
        providerMessageId: null,
        sentAt: null,
        createdAt: this.stamp,
        updatedAt: this.stamp,
      };
      this.deliveries.push(row);
      return { status: "claimed", attemptCount: row.attemptCount };
    }

    const retryable =
      existing.status === "failed" &&
      existing.attemptCount < maxAttempts &&
      !(existing.error ?? "").startsWith(PERMANENT_FAILURE_PREFIX);

    if (!retryable) return { status: "lost" };

    existing.status = "queued";
    existing.attemptCount += 1;
    return { status: "claimed", attemptCount: existing.attemptCount };
  }

  async recordTerminalDelivery(
    notificationId: string,
    channel: NotificationChannel,
    status: "suppressed_by_preference" | "cancelled",
    now: Date
  ): Promise<void> {
    if (this.deliveryFor(notificationId, channel)) return; // ON CONFLICT DO NOTHING
    this.deliverySequence += 1;
    this.deliveries.push({
      id: `d-${this.deliverySequence}`,
      notificationId,
      channel,
      status,
      attemptCount: 0,
      error: null,
      providerMessageId: null,
      sentAt: null,
      createdAt: now,
      updatedAt: now,
    });
  }

  async settleDelivery(input: SettleDeliveryInput): Promise<void> {
    const row = this.deliveryFor(input.notificationId, input.channel);
    if (!row) throw new Error("settleDelivery for an unclaimed delivery");
    row.status = input.status;
    row.error = input.status === "failed" ? (input.error ?? null) : null;
    row.providerMessageId = input.providerMessageId ?? null;
    row.sentAt = input.sentAt ?? null;
    row.updatedAt = input.now;
  }

  async finishNotification(
    notificationId: string,
    status: NotificationStatus,
    now: Date
  ): Promise<void> {
    const row = this.rows.find((n) => n.id === notificationId);
    // Production scopes this to `status = 'claimed'`, so a mid-run cancel wins.
    if (!row || row.status !== "claimed") return;
    row.status = status;
    row.updatedAt = now;
  }

  async releaseClaims(
    notificationIds: readonly string[],
    now: Date
  ): Promise<void> {
    for (const id of notificationIds) {
      const row = this.rows.find((n) => n.id === id);
      if (!row || row.status !== "claimed") continue;
      row.status = "pending";
      row.updatedAt = now;
    }
  }

  /** #324. Normalised addresses this fake treats as permanently bounced. */
  suppressedAddresses = new Set<string>();

  async loadSuppressedAddresses(emails: readonly string[]): Promise<string[]> {
    return emails
      .map((email) => email.trim().toLowerCase())
      .filter((email) => this.suppressedAddresses.has(email));
  }

  async sendEmail(message: OutboundEmail): Promise<EmailSendOutcome> {
    this.sends.push(message);
    return SENT;
  }
}
