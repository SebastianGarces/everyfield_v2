import assert from "node:assert/strict";
import { test } from "node:test";

import {
  notificationChannels,
  type NewNotification,
  type Notification,
  type NotificationChannel,
  type NotificationDelivery,
  type NotificationPreference,
  type NotificationStatus,
} from "@/db/schema";

import {
  channelEligibility,
  clearStillLivePredicates,
  composeBatchEmail,
  groupForDispatch,
  groupIdempotencyKey,
  isPermanentEmailError,
  MAX_DELIVERY_ATTEMPTS,
  PERMANENT_FAILURE_PREFIX,
  registerStillLivePredicate,
  resolveLiveness,
  retryDelayMs,
  runDispatch,
  statusFromChannelResults,
  unregisterStillLivePredicate,
  type ChannelResult,
  type DispatchDeps,
  type DispatchRecipient,
  type EmailSendOutcome,
  type OutboundEmail,
} from "./dispatch";

// ============================================================================
// The scheduled dispatcher (N-003, N-004, N-012, N-014, N-015, N-016, N-017).
//
// `FakeDispatchStore` below is a faithful stand-in for the SQL the production
// deps issue, and the two things it models most carefully are the two things
// at-most-once rests on:
//
//   1. `claimDue` moves rows pending → claimed in one step, so a second call
//      over the same data returns nothing.
//   2. `claimDelivery` mirrors
//      `INSERT ... ON CONFLICT (notification_id, channel) DO UPDATE ... WHERE
//      the existing row is a retryable, non-permanent failure` — the unique
//      index `notification_deliveries_notification_channel_idx` is what makes a
//      second delivery per channel impossible, so the fake enforces it too.
//
// Driving `runDispatch` through it exercises the real orchestration: what is
// faked is Postgres and Resend, not the logic under test.
// ============================================================================

const CHURCH = "11111111-1111-4111-8111-111111111111";
const PLANTER = "22222222-2222-4222-8222-222222222222";
const OTHER = "33333333-3333-4333-8333-333333333333";
const TASK = "44444444-4444-4444-8444-444444444444";

const NOW = new Date("2026-07-27T09:00:00.000Z");
const PAST = new Date("2026-07-27T08:00:00.000Z");
const FUTURE = new Date("2026-07-28T09:00:00.000Z");

/** Longer than any backoff `retryDelayMs` can produce, so a run always retries. */
const PAST_ANY_BACKOFF_MS = 2 * 60 * 60_000;

function plus(base: Date, ms: number): Date {
  return new Date(base.getTime() + ms);
}

// ----------------------------------------------------------------------------
// Fakes
// ----------------------------------------------------------------------------

interface SendCall {
  message: OutboundEmail;
}

class FakeDispatchStore implements DispatchDeps {
  readonly notifications: Notification[] = [];
  readonly deliveries: NotificationDelivery[] = [];
  readonly preferences: NotificationPreference[] = [];
  readonly recipients: DispatchRecipient[] = [];
  readonly sends: SendCall[] = [];

  private sequence = 0;
  private deliverySequence = 0;

  /** Queue of provider outcomes; the last one repeats once drained. */
  outcomes: EmailSendOutcome[] = [{ status: "sent", providerMessageId: "m-1" }];

  // -- seeding --------------------------------------------------------------

  addRecipient(id: string, email: string): DispatchRecipient {
    const recipient: DispatchRecipient = { id, email, name: null };
    this.recipients.push(recipient);
    return recipient;
  }

  addNotification(row: Partial<NewNotification> = {}): Notification {
    this.sequence += 1;
    const stored: Notification = {
      id: `n-${this.sequence}`,
      churchId: row.churchId ?? CHURCH,
      recipientUserId: row.recipientUserId ?? PLANTER,
      category: row.category ?? "tasks",
      type: row.type ?? "task.overdue",
      title: row.title ?? `Task ${this.sequence} is overdue`,
      body: row.body ?? "Body copy the caller rendered.",
      entityType: row.entityType ?? "task",
      entityId: row.entityId ?? TASK,
      dedupeKey: row.dedupeKey ?? null,
      scheduledFor: row.scheduledFor ?? PAST,
      status: (row.status as NotificationStatus) ?? "pending",
      readAt: null,
      createdAt: PAST,
      updatedAt: PAST,
    };
    this.notifications.push(stored);
    return stored;
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
      digestCadence: null,
      createdAt: PAST,
      updatedAt: PAST,
    });
  }

  // -- queries --------------------------------------------------------------

  deliveryFor(
    notificationId: string,
    channel: NotificationChannel
  ): NotificationDelivery | undefined {
    return this.deliveries.find(
      (row) => row.notificationId === notificationId && row.channel === channel
    );
  }

  notificationById(id: string): Notification {
    const row = this.notifications.find((n) => n.id === id);
    assert.ok(row, `no notification ${id}`);
    return row;
  }

  countNotifications(status: NotificationStatus): number {
    return this.notifications.filter((row) => row.status === status).length;
  }

  // -- DispatchDeps ---------------------------------------------------------

  async claimDue(now: Date, limit: number): Promise<Notification[]> {
    const due = this.notifications
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

    // Atomic in production; here the mutation is simply inseparable from the
    // read, which is the property the single UPDATE statement buys.
    for (const row of due) {
      row.status = "claimed";
      row.updatedAt = now;
    }
    return due.map((row) => ({ ...row }));
  }

  async countRemainingDue(now: Date): Promise<number> {
    return this.notifications.filter(
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

  /**
   * `INSERT ... ON CONFLICT (notification_id, channel) DO UPDATE ... WHERE the
   * existing row is a retryable, non-permanent failure`. Returns a row only
   * when this call owns the attempt.
   */
  async claimDelivery(
    notificationId: string,
    channel: NotificationChannel,
    maxAttempts: number
  ) {
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
        createdAt: NOW,
        updatedAt: NOW,
      };
      this.deliveries.push(row);
      return { status: "claimed" as const, attemptCount: row.attemptCount };
    }

    const retryable =
      existing.status === "failed" &&
      existing.attemptCount < maxAttempts &&
      !(existing.error ?? "").startsWith(PERMANENT_FAILURE_PREFIX);

    if (!retryable) return { status: "lost" as const };

    existing.status = "queued";
    existing.attemptCount += 1;
    return { status: "claimed" as const, attemptCount: existing.attemptCount };
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

  async settleDelivery(input: {
    notificationId: string;
    channel: NotificationChannel;
    status: "sent" | "failed";
    error?: string | null;
    providerMessageId?: string | null;
    sentAt?: Date | null;
    now: Date;
  }): Promise<void> {
    const row = this.deliveryFor(input.notificationId, input.channel);
    assert.ok(
      row,
      "settleDelivery called for a delivery that was never claimed"
    );
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
    const row = this.notificationById(notificationId);
    // Production scopes this to `status = 'claimed'` so a mid-run cancel wins.
    if (row.status !== "claimed") return;
    row.status = status;
    row.updatedAt = now;
  }

  async releaseClaims(
    notificationIds: readonly string[],
    now: Date
  ): Promise<void> {
    for (const id of notificationIds) {
      const row = this.notificationById(id);
      if (row.status !== "claimed") continue;
      row.status = "pending";
      row.updatedAt = now;
    }
  }

  async sendEmail(message: OutboundEmail): Promise<EmailSendOutcome> {
    this.sends.push({ message });
    return this.outcomes.length > 1
      ? (this.outcomes.shift() as EmailSendOutcome)
      : this.outcomes[0];
  }
}

function storeWithPlanter(): FakeDispatchStore {
  const store = new FakeDispatchStore();
  store.addRecipient(PLANTER, "planter@example.test");
  return store;
}

// ============================================================================
// AC: a run delivers past-due notifications and leaves future ones pending
// ============================================================================

test("delivers a past-due notification and leaves a future one pending (N-003)", async () => {
  const store = storeWithPlanter();
  const past = store.addNotification({ scheduledFor: PAST, title: "Due now" });
  const future = store.addNotification({
    scheduledFor: FUTURE,
    title: "Due tomorrow",
  });

  const summary = await runDispatch(store, { now: NOW });

  // The delivery log is the assertion surface (N-016).
  assert.equal(store.deliveryFor(past.id, "email")?.status, "sent");
  assert.equal(store.deliveryFor(past.id, "in_app")?.status, "sent");
  assert.equal(store.deliveryFor(future.id, "email"), undefined);
  assert.equal(store.deliveryFor(future.id, "in_app"), undefined);

  assert.equal(store.notificationById(past.id).status, "delivered");
  assert.equal(store.notificationById(future.id).status, "pending");
  assert.equal(summary.claimed, 1);
  assert.equal(summary.delivered, 1);
});

// ============================================================================
// AC: two consecutive runs produce exactly one delivery per channel (N-004)
// ============================================================================

test("two consecutive runs produce exactly one delivery per channel (N-004)", async () => {
  const store = storeWithPlanter();
  const notification = store.addNotification();

  await runDispatch(store, { now: NOW });
  await runDispatch(store, { now: plus(NOW, 60_000) });

  const rows = store.deliveries.filter(
    (row) => row.notificationId === notification.id
  );
  assert.equal(rows.length, 2, "one row per channel, never two per channel");
  assert.deepEqual(rows.map((row) => row.channel).sort(), ["email", "in_app"]);
  assert.equal(store.deliveryFor(notification.id, "email")?.attemptCount, 1);
  assert.equal(store.sends.length, 1, "no second provider call");
});

test("an overlapping run claims nothing the first run already holds (N-004)", async () => {
  const store = storeWithPlanter();
  store.addNotification();

  // Interleave by claiming first, then running: the second run sees no pending
  // row at all, which is what the single UPDATE...RETURNING statement buys.
  const claimed = await store.claimDue(NOW, 10);
  assert.equal(claimed.length, 1);

  const summary = await runDispatch(store, { now: NOW });
  assert.equal(summary.claimed, 0);
  assert.equal(store.sends.length, 0);
});

// ============================================================================
// AC: a preference-disabled channel is recorded suppressed_by_preference
// ============================================================================

test("a disabled channel is recorded suppressed_by_preference, not skipped (N-016)", async () => {
  const store = storeWithPlanter();
  store.setPreference(PLANTER, "tasks", "email", false);
  const notification = store.addNotification();

  const summary = await runDispatch(store, { now: NOW });

  assert.equal(
    store.deliveryFor(notification.id, "email")?.status,
    "suppressed_by_preference"
  );
  assert.equal(store.deliveryFor(notification.id, "in_app")?.status, "sent");
  assert.equal(
    store.sends.length,
    0,
    "a suppressed channel makes no provider call"
  );
  assert.equal(summary.suppressed, 1);
  // Suppression is an outcome, not a failure — the notification still landed.
  assert.equal(store.notificationById(notification.id).status, "delivered");
});

test("an absent preference row resolves to the category default, not off", async () => {
  const store = storeWithPlanter();
  const notification = store.addNotification({ category: "tasks" });

  await runDispatch(store, { now: NOW });

  assert.equal(store.deliveryFor(notification.id, "email")?.status, "sent");
});

test("in_app off / email on suppresses only the feed channel", async () => {
  const store = storeWithPlanter();
  store.setPreference(PLANTER, "tasks", "in_app", false);
  const notification = store.addNotification();

  await runDispatch(store, { now: NOW });

  assert.equal(
    store.deliveryFor(notification.id, "in_app")?.status,
    "suppressed_by_preference"
  );
  assert.equal(store.deliveryFor(notification.id, "email")?.status, "sent");
  assert.equal(store.sends.length, 1);
});

// ============================================================================
// AC: twenty tasks notifications → ONE email, twenty feed rows (N-012)
// ============================================================================

test("twenty tasks notifications produce one email and twenty feed rows (N-012)", async () => {
  const store = storeWithPlanter();
  const ids = Array.from(
    { length: 20 },
    (_, i) => store.addNotification({ title: `Task ${i} is overdue` }).id
  );

  const summary = await runDispatch(store, { now: NOW });

  assert.equal(store.sends.length, 1, "one grouped email, not twenty");
  assert.equal(summary.emailsSent, 1);

  // Twenty separate feed rows — the queue row IS the feed row, and grouping
  // must not collapse them.
  const inApp = ids.map((id) => store.deliveryFor(id, "in_app"));
  assert.equal(inApp.length, 20);
  assert.ok(inApp.every((row) => row?.status === "sent"));

  // Every notification still carries its own email delivery row, all settled
  // with the same provider message id — "did THIS one send?" stays answerable.
  const email = ids.map((id) => store.deliveryFor(id, "email"));
  assert.ok(email.every((row) => row?.status === "sent"));
  assert.ok(email.every((row) => row?.providerMessageId === "m-1"));

  // The subject names the count rather than one arbitrary title.
  assert.match(store.sends[0].message.subject, /^20 tasks updates$/);
  assert.match(store.sends[0].message.text, /Task 0 is overdue/);
  assert.match(store.sends[0].message.text, /Task 19 is overdue/);
});

test("different recipients and categories are separate emails", async () => {
  const store = storeWithPlanter();
  store.addRecipient(OTHER, "other@example.test");

  store.addNotification({ recipientUserId: PLANTER, category: "tasks" });
  store.addNotification({ recipientUserId: PLANTER, category: "tasks" });
  store.addNotification({
    recipientUserId: PLANTER,
    category: "meetings",
    type: "meeting.reminder",
    entityType: "meeting",
  });
  store.addNotification({ recipientUserId: OTHER, category: "tasks" });

  const summary = await runDispatch(store, { now: NOW });

  assert.equal(summary.groups, 3);
  assert.equal(store.sends.length, 3);
  const recipientsMailed = store.sends.map((call) => call.message.to).sort();
  assert.deepEqual(recipientsMailed, [
    "other@example.test",
    "planter@example.test",
    "planter@example.test",
  ]);
});

// ============================================================================
// AC: a subject resolved before dispatch is not delivered (N-014)
// ============================================================================

test("a notification whose subject resolved before dispatch is not delivered (N-014)", async () => {
  const store = storeWithPlanter();
  const notification = store.addNotification({ type: "task.overdue" });

  // The owning feature's rule, registered per type — dispatch never knows what
  // "resolved" means.
  const completedTasks = new Set<string>();
  registerStillLivePredicate("task.overdue", (row) =>
    row.entityId === null ? true : !completedTasks.has(row.entityId)
  );

  try {
    // Complete the subject between enqueue and dispatch.
    completedTasks.add(TASK);

    const summary = await runDispatch(store, { now: NOW });

    assert.equal(
      store.sends.length,
      0,
      "nothing announced for a resolved subject"
    );
    assert.equal(
      store.deliveryFor(notification.id, "email")?.status,
      "cancelled"
    );
    assert.equal(
      store.deliveryFor(notification.id, "in_app")?.status,
      "cancelled"
    );
    assert.equal(store.notificationById(notification.id).status, "cancelled");
    assert.equal(summary.cancelled, 1);
    assert.equal(summary.delivered, 0);
  } finally {
    unregisterStillLivePredicate("task.overdue");
  }
});

test("a still-live subject is delivered normally", async () => {
  const store = storeWithPlanter();
  const notification = store.addNotification({ type: "task.overdue" });
  registerStillLivePredicate("task.overdue", () => true);

  try {
    await runDispatch(store, { now: NOW });
    assert.equal(store.deliveryFor(notification.id, "email")?.status, "sent");
  } finally {
    unregisterStillLivePredicate("task.overdue");
  }
});

test("an unregistered type is live — F11 does not invent a caller's rules", async () => {
  clearStillLivePredicates();
  const notification = { type: "phase.assessment.ready" } as Notification;
  assert.equal(await resolveLiveness(notification), "live");
});

test("a predicate that throws defers the notification rather than guessing", async () => {
  const store = storeWithPlanter();
  const notification = store.addNotification({ type: "task.overdue" });
  registerStillLivePredicate("task.overdue", () => {
    throw new Error("task lookup exploded");
  });

  try {
    const summary = await runDispatch(store, { now: NOW });

    assert.equal(summary.deferred, 1);
    assert.equal(
      store.sends.length,
      0,
      "nothing sent on an unanswerable check"
    );
    assert.equal(store.deliveries.length, 0, "nothing recorded either way");
    // Left pending: delayed, never lost.
    assert.equal(store.notificationById(notification.id).status, "pending");
  } finally {
    unregisterStillLivePredicate("task.overdue");
  }
});

// ============================================================================
// AC: cancelled notifications are never delivered (N-011)
// ============================================================================

test("a cancelled notification is never claimed or delivered (N-011)", async () => {
  const store = storeWithPlanter();
  const notification = store.addNotification();

  // What `cancelByEntity` does: pending → cancelled, before the run.
  store.notificationById(notification.id).status = "cancelled";

  const summary = await runDispatch(store, { now: NOW });

  assert.equal(summary.claimed, 0);
  assert.equal(store.sends.length, 0);
  assert.equal(store.deliveries.length, 0);
  assert.equal(store.notificationById(notification.id).status, "cancelled");
});

test("a cancel that lands mid-run wins — the run does not overwrite it", async () => {
  const store = storeWithPlanter();
  const notification = store.addNotification();

  await store.claimDue(NOW, 10);
  // cancelByEntity only touches `pending` rows, so a claimed row is not its
  // target — but if a row is cancelled by any path, `finishNotification` is
  // scoped to `claimed` and must not resurrect it.
  store.notificationById(notification.id).status = "cancelled";
  await store.finishNotification(notification.id, "delivered", NOW);

  assert.equal(store.notificationById(notification.id).status, "cancelled");
});

// ============================================================================
// AC: bounded retry — transient retries with backoff, hard bounce does not
// ============================================================================

test("a transient failure retries with backoff and eventually succeeds (N-015)", async () => {
  const store = storeWithPlanter();
  const notification = store.addNotification();
  store.outcomes = [
    { status: "failed", error: "503 upstream timeout", permanent: false },
    { status: "sent", providerMessageId: "m-2" },
  ];

  // Run 1 — the provider fails transiently.
  await runDispatch(store, { now: NOW });
  assert.equal(store.sends.length, 1);
  let delivery = store.deliveryFor(notification.id, "email");
  assert.equal(delivery?.status, "failed");
  assert.equal(delivery?.attemptCount, 1);
  assert.match(delivery?.error ?? "", /upstream timeout/);
  assert.ok(
    !(delivery?.error ?? "").startsWith(PERMANENT_FAILURE_PREFIX),
    "a transient error is not marked permanent"
  );
  // Back to pending for a later tick — delayed, not lost.
  assert.equal(store.notificationById(notification.id).status, "pending");
  // The in-app channel already landed and must not be re-sent.
  assert.equal(store.deliveryFor(notification.id, "in_app")?.status, "sent");

  // Run 2, inside the backoff window — claimed, but the provider is not called.
  await runDispatch(store, { now: plus(NOW, 60_000) });
  assert.equal(store.sends.length, 1, "backoff is honoured");
  assert.equal(store.deliveryFor(notification.id, "email")?.attemptCount, 1);
  assert.equal(store.notificationById(notification.id).status, "pending");

  // Run 3, after the backoff — attempt 2 succeeds.
  await runDispatch(store, { now: plus(NOW, retryDelayMs(1) + 1_000) });
  assert.equal(store.sends.length, 2);
  delivery = store.deliveryFor(notification.id, "email");
  assert.equal(delivery?.status, "sent");
  assert.equal(delivery?.attemptCount, 2);
  assert.equal(
    delivery?.error,
    null,
    "a successful retry clears the old error"
  );
  assert.equal(delivery?.providerMessageId, "m-2");
  assert.equal(store.notificationById(notification.id).status, "delivered");
  // Still exactly one delivery row per channel after three runs.
  assert.equal(
    store.deliveries.filter((row) => row.notificationId === notification.id)
      .length,
    2
  );
});

test("a hard bounce is recorded failed without retry (N-015)", async () => {
  const store = storeWithPlanter();
  const notification = store.addNotification();
  store.outcomes = [
    {
      status: "failed",
      error: "hard bounce: mailbox not found",
      permanent: true,
    },
  ];

  await runDispatch(store, { now: NOW });

  const delivery = store.deliveryFor(notification.id, "email");
  assert.equal(delivery?.status, "failed");
  assert.equal(delivery?.attemptCount, 1, "one attempt, and only one");
  assert.ok((delivery?.error ?? "").startsWith(PERMANENT_FAILURE_PREFIX));
  assert.equal(store.sends.length, 1);

  // Long after any backoff would have elapsed, still no second attempt.
  await runDispatch(store, { now: plus(NOW, 24 * 60 * 60_000) });
  assert.equal(store.sends.length, 1);
  assert.equal(store.deliveryFor(notification.id, "email")?.attemptCount, 1);
});

test("a transient failure stops at the bounded attempt count (N-015)", async () => {
  const store = storeWithPlanter();
  // Email is the only enabled channel, so the notification's own status is
  // decided by the email outcome alone.
  store.setPreference(PLANTER, "tasks", "in_app", false);
  const notification = store.addNotification();
  store.outcomes = [
    { status: "failed", error: "503 upstream timeout", permanent: false },
  ];

  let clock = NOW;
  for (let i = 0; i < MAX_DELIVERY_ATTEMPTS + 2; i += 1) {
    await runDispatch(store, { now: clock });
    clock = plus(clock, PAST_ANY_BACKOFF_MS);
  }

  const delivery = store.deliveryFor(notification.id, "email");
  assert.equal(delivery?.attemptCount, MAX_DELIVERY_ATTEMPTS);
  assert.equal(
    store.sends.length,
    MAX_DELIVERY_ATTEMPTS,
    "retries are bounded — the extra runs make no provider call"
  );
  assert.equal(delivery?.status, "failed");
  assert.equal(store.notificationById(notification.id).status, "failed");
});

test("a delivered in-app channel keeps the notification delivered when email exhausts", async () => {
  const store = storeWithPlanter();
  const notification = store.addNotification();
  store.outcomes = [
    { status: "failed", error: "503 upstream timeout", permanent: false },
  ];

  let clock = NOW;
  for (let i = 0; i < MAX_DELIVERY_ATTEMPTS; i += 1) {
    await runDispatch(store, { now: clock });
    clock = plus(clock, PAST_ANY_BACKOFF_MS);
  }

  assert.equal(store.deliveryFor(notification.id, "email")?.status, "failed");
  assert.equal(store.deliveryFor(notification.id, "in_app")?.status, "sent");
  // One channel reached the user, so the notification did — the per-channel row
  // is where the email failure is answerable (N-016).
  assert.equal(store.notificationById(notification.id).status, "delivered");
});

test("a recipient with no email address fails permanently, never retries", async () => {
  const store = new FakeDispatchStore();
  store.recipients.push({ id: PLANTER, email: "", name: null });
  const notification = store.addNotification();

  await runDispatch(store, { now: NOW });

  const delivery = store.deliveryFor(notification.id, "email");
  assert.equal(delivery?.status, "failed");
  assert.ok((delivery?.error ?? "").startsWith(PERMANENT_FAILURE_PREFIX));
  assert.equal(store.sends.length, 0);
  // The in-app channel is unaffected — one dead channel is not a dead
  // notification.
  assert.equal(store.deliveryFor(notification.id, "in_app")?.status, "sent");
  assert.equal(store.notificationById(notification.id).status, "delivered");
});

// ============================================================================
// AC: a batch larger than the bound leaves the remainder pending (N-017)
// ============================================================================

test("a batch over the bound leaves the remainder pending and finishes fast (N-017)", async () => {
  const store = storeWithPlanter();
  // Twelve distinct recipients, so grouping cannot collapse the batch and the
  // bound is what limits the run.
  for (let i = 0; i < 12; i += 1) {
    const userId = `user-${i}`;
    store.addRecipient(userId, `user${i}@example.test`);
    store.addNotification({ recipientUserId: userId });
  }

  const startedAt = Date.now();
  const summary = await runDispatch(store, { now: NOW, maxBatch: 5 });
  const wallClockMs = Date.now() - startedAt;

  assert.equal(summary.claimed, 5);
  assert.equal(
    summary.remainingPending,
    7,
    "the remainder is left pending, not dropped"
  );
  assert.equal(store.countNotifications("pending"), 7);
  assert.equal(store.countNotifications("delivered"), 5);
  assert.equal(store.sends.length, 5);
  // The run itself is the thing that must fit the function timeout.
  assert.ok(
    summary.durationMs < 60_000 && wallClockMs < 60_000,
    `run took ${wallClockMs}ms`
  );
});

test("a run that exhausts its budget releases what it claimed (N-017)", async () => {
  const store = storeWithPlanter();
  for (let i = 0; i < 6; i += 1) {
    const userId = `user-${i}`;
    store.addRecipient(userId, `user${i}@example.test`);
    store.addNotification({ recipientUserId: userId });
  }

  // Over budget from the first between-groups check onward.
  const summary = await runDispatch(store, {
    now: NOW,
    maxBatch: 10,
    budgetMs: 10,
    elapsedMs: () => 1_000,
  });

  assert.equal(summary.claimed, 6);
  assert.equal(
    summary.released,
    5,
    "claimed but unprocessed rows go back to pending"
  );
  assert.equal(store.sends.length, 1);
  // Nothing is stranded in `claimed` — that status has no other owner.
  assert.equal(store.countNotifications("claimed"), 0);
  assert.equal(store.countNotifications("pending"), 5);
});

test("an empty queue is a cheap no-op", async () => {
  const store = storeWithPlanter();
  const summary = await runDispatch(store, { now: NOW });

  assert.equal(summary.claimed, 0);
  assert.equal(summary.groups, 0);
  assert.equal(store.sends.length, 0);
});

// ============================================================================
// Pure units
// ============================================================================

test("channelEligibility: no row yet is eligible", () => {
  assert.deepEqual(channelEligibility(undefined, NOW), { eligible: true });
});

test("channelEligibility: a terminal row is never re-attempted", () => {
  for (const status of [
    "sent",
    "cancelled",
    "suppressed_by_preference",
  ] as const) {
    const row = delivery({ status });
    assert.deepEqual(channelEligibility(row, NOW), {
      eligible: false,
      reason: "already_settled",
    });
  }
});

test("channelEligibility: a queued row from a crashed run is never retried (N-004)", () => {
  const row = delivery({ status: "queued" });
  assert.deepEqual(channelEligibility(row, NOW), {
    eligible: false,
    reason: "in_flight",
  });
});

test("channelEligibility: a permanent failure is exhausted at attempt one", () => {
  const row = delivery({
    status: "failed",
    attemptCount: 1,
    error: `${PERMANENT_FAILURE_PREFIX}hard bounce`,
    updatedAt: new Date(NOW.getTime() - 24 * 60 * 60_000),
  });
  assert.deepEqual(channelEligibility(row, NOW), {
    eligible: false,
    reason: "attempts_exhausted",
  });
});

test("channelEligibility: backoff then eligible", () => {
  const failedAt = new Date(NOW.getTime() - 1_000);
  const row = delivery({
    status: "failed",
    attemptCount: 1,
    error: "503",
    updatedAt: failedAt,
  });
  assert.deepEqual(channelEligibility(row, NOW), {
    eligible: false,
    reason: "in_backoff",
  });
  assert.deepEqual(
    channelEligibility(row, new Date(failedAt.getTime() + retryDelayMs(1))),
    { eligible: true }
  );
});

test("channelEligibility: attempts exhausted at the bound", () => {
  const row = delivery({
    status: "failed",
    attemptCount: MAX_DELIVERY_ATTEMPTS,
    error: "503",
    updatedAt: new Date(NOW.getTime() - 24 * 60 * 60_000),
  });
  assert.deepEqual(channelEligibility(row, NOW), {
    eligible: false,
    reason: "attempts_exhausted",
  });
});

test("retryDelayMs backs off exponentially and is capped", () => {
  assert.ok(retryDelayMs(1) < retryDelayMs(2));
  assert.ok(retryDelayMs(2) < retryDelayMs(3));
  assert.equal(retryDelayMs(50), retryDelayMs(60), "capped, never unbounded");
});

test("statusFromChannelResults: a channel still owed outranks everything", () => {
  const results = (...kinds: ChannelResult["kind"][]): ChannelResult[] =>
    kinds.map((kind) => ({ kind }) as ChannelResult);

  assert.equal(statusFromChannelResults(results("sent", "retry")), "pending");
  assert.equal(statusFromChannelResults(results("failed", "retry")), "pending");
  assert.equal(statusFromChannelResults(results("failed", "failed")), "failed");
  assert.equal(
    statusFromChannelResults(results("failed", "sent")),
    "delivered"
  );
  assert.equal(
    statusFromChannelResults(results("failed", "settled")),
    "delivered"
  );
  // A suppressed channel does not vote: the only ATTEMPTED channel failed.
  assert.equal(
    statusFromChannelResults(results("suppressed", "failed")),
    "failed"
  );
  // Opted out of everything is done, not failed.
  assert.equal(
    statusFromChannelResults(results("suppressed", "suppressed")),
    "delivered"
  );
  assert.equal(statusFromChannelResults([]), "delivered");
});

test("isPermanentEmailError classifies hard failures, and only those", () => {
  assert.equal(isPermanentEmailError("Invalid `to` field"), true);
  assert.equal(isPermanentEmailError("hard bounce"), true);
  assert.equal(isPermanentEmailError("No such mailbox"), true);
  assert.equal(isPermanentEmailError("validation_error"), true);
  assert.equal(isPermanentEmailError("5.1.1 user unknown"), true);

  // Unrecognised means TRANSIENT — failing toward delivery, not toward silence.
  assert.equal(isPermanentEmailError("503 Service Unavailable"), false);
  assert.equal(isPermanentEmailError("socket hang up"), false);
  assert.equal(isPermanentEmailError("rate limit exceeded"), false);
});

test("groupForDispatch groups by (church, recipient, category) in claim order", () => {
  const store = storeWithPlanter();
  const a = store.addNotification({ category: "tasks" });
  const b = store.addNotification({ category: "meetings" });
  const c = store.addNotification({ category: "tasks" });
  const d = store.addNotification({
    recipientUserId: OTHER,
    category: "tasks",
  });

  const groups = groupForDispatch([a, b, c, d]);

  assert.equal(groups.length, 3);
  assert.deepEqual(
    groups[0].notifications.map((n) => n.id),
    [a.id, c.id]
  );
  assert.equal(groups[1].category, "meetings");
  assert.equal(groups[2].recipientUserId, OTHER);
});

test("composeBatchEmail escapes caller-rendered copy", () => {
  const store = storeWithPlanter();
  const notification = store.addNotification({
    title: "<script>alert(1)</script>",
    body: 'Jane & "John" <hi@example.test>',
  });

  const message = composeBatchEmail(
    { id: PLANTER, email: "planter@example.test", name: null },
    "tasks",
    [notification],
    "key"
  );

  assert.ok(!message.html.includes("<script>"));
  assert.match(message.html, /&lt;script&gt;/);
  assert.match(message.html, /Jane &amp; &quot;John&quot;/);
  // The plain-text part carries the copy verbatim; only HTML needs escaping.
  assert.match(message.text, /<script>alert\(1\)<\/script>/);
});

test("groupIdempotencyKey is stable regardless of member order", () => {
  const a = groupIdempotencyKey(CHURCH, PLANTER, "tasks", ["n-1", "n-2"]);
  const b = groupIdempotencyKey(CHURCH, PLANTER, "tasks", ["n-2", "n-1"]);
  const c = groupIdempotencyKey(CHURCH, PLANTER, "tasks", ["n-1", "n-3"]);

  assert.equal(a, b);
  assert.notEqual(a, c);
});

test("both shipped channels are considered on every dispatch", () => {
  assert.deepEqual([...notificationChannels], ["email", "in_app"]);
});

// ----------------------------------------------------------------------------

function delivery(
  overrides: Partial<NotificationDelivery> = {}
): NotificationDelivery {
  return {
    id: "d-1",
    notificationId: "n-1",
    channel: "email",
    status: "queued",
    attemptCount: 0,
    error: null,
    providerMessageId: null,
    sentAt: null,
    createdAt: NOW,
    updatedAt: NOW,
    ...overrides,
  };
}
