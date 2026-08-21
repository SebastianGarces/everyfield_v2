// ----------------------------------------------------------------------------
// HERMETIC about the unsubscribe secret, for the reason `dispatch.test.ts`
// states at length: composing a digest email mints a real unsubscribe token, and
// a suite that only passes because the developer box happens to carry
// `CRON_SECRET` in `.env.local` is not testing what it claims to. `node --test`
// gives each file its own process, so this cannot leak.
// ----------------------------------------------------------------------------
const TEST_UNSUBSCRIBE_SECRET = "test-unsubscribe-secret-0123456789";
process.env.UNSUBSCRIBE_TOKEN_SECRET = TEST_UNSUBSCRIBE_SECRET;

import assert from "node:assert/strict";
import { test } from "node:test";

import type {
  NewNotification,
  Notification,
  NotificationChannel,
  NotificationDelivery,
  NotificationPreference,
  NotificationStatus,
} from "@/db/schema";

import { composePlanterDigestEmail } from "./channels/digest-email";
import {
  plantsOwedPlanterDigestQuery,
  runPlanterDigest,
  runPlanterDigestSweep,
  type PlanterDigestDeps,
  type PlanterDigestSweepDeps,
} from "./digest";
// The pure half of the digest lives in the leaf, and so do its own cases — see
// `digest-content.test.ts`. What is imported here is what the RUN needs.
import {
  composePlanterDigestBody,
  composePlanterDigestTitle,
  currentDigestDedupeKeys,
  digestPeriodFor,
  planterDigestDedupeKey,
  PLANTER_DIGEST_TYPE,
  type DigestAnchor,
  type DigestCounts,
  type DigestPeriod,
} from "./digest-content";
import {
  emailComposerForGroup,
  runDispatch,
  type DeliveryClaim,
  type DispatchDeps,
  type DispatchRecipient,
  type OutboundEmail,
} from "./dispatch";
import type { EnqueueNotificationInput, EnqueueResult } from "./enqueue";

// ============================================================================
// The recurring planter digest (N-013).
//
// Nothing below touches Postgres — every dependency is injected, and the one
// query that has to be asserted as SQL is asserted through `.toSQL()`.
// (`DATABASE_URL` is nonetheless present in this environment, because importing
// the module under test pulls in `@/db` for its production wiring.)
// ============================================================================

const CHURCH_A = "11111111-1111-4111-8111-111111111111";
const CHURCH_B = "99999999-9999-4999-8999-999999999999";
const PLANTER = "22222222-2222-4222-8222-222222222222";
const TEAM_MEMBER = "33333333-3333-4333-8333-333333333333";
const COACH = "44444444-4444-4444-8444-444444444444";

/** A Wednesday, so a weekly period's Monday start is not the same day. */
const NOW = new Date("2026-08-19T09:00:00.000Z");

/**
 * The anchor the cadence cases below run under: UTC, Monday, midnight.
 *
 * NOT the product's default — that is Sunday 16:00 in the CHURCH's own zone
 * (N-013, #448), and `digest-content.test.ts` owns the anchor's own cases. It
 * is chosen here because these cases are about the CADENCE guard, and a period
 * boundary on the UTC grid keeps their dates readable. What they prove — that
 * "once per period" is the dedupe key and not a clock this module keeps — is
 * true of every anchor, which is what the two-zone sweep at the bottom of this
 * file asserts directly.
 */
const MONDAY_UTC: DigestAnchor = { timeZone: "UTC", weekday: 1, hour: 0 };

/** Church A's real anchor for the sweep cases: Sunday 16:00 Eastern. */
const EASTERN_SUNDAY_4PM: DigestAnchor = {
  timeZone: "America/New_York",
  weekday: 0,
  hour: 16,
};

/** Church B's: a different zone AND a different configured time. */
const PACIFIC_WEDNESDAY_7AM: DigestAnchor = {
  timeZone: "America/Los_Angeles",
  weekday: 3,
  hour: 7,
};

const NOTHING: DigestCounts = {
  overdue_tasks: 0,
  tasks_due_soon: 0,
  upcoming_meetings: 0,
};

const BUSY: DigestCounts = {
  overdue_tasks: 2,
  tasks_due_soon: 3,
  upcoming_meetings: 1,
};

// ----------------------------------------------------------------------------
// Fakes
// ----------------------------------------------------------------------------

interface FakeOptions {
  recipients?: string[];
  /** Counts per (church, recipient). Anything unlisted is `NOTHING`. */
  counts?: Record<string, DigestCounts>;
  cadences?: Record<string, "daily" | "weekly">;
  /** Recipients `enqueue` refuses. */
  refuse?: string[];
}

class FakeDigestDeps implements PlanterDigestDeps {
  readonly enqueued: EnqueueNotificationInput[] = [];
  /** The subset of `enqueued` that actually wrote a row — the index let through. */
  readonly created: EnqueueNotificationInput[] = [];
  readonly summarised: {
    churchId: string;
    recipientUserId: string;
    period: DigestPeriod;
  }[] = [];
  /** Live dedupe keys, keyed `church|recipient` — the partial unique index. */
  private readonly keys = new Map<string, Set<string>>();

  constructor(private readonly options: FakeOptions = {}) {}

  async listRecipients(churchId: string) {
    // Church B's team is deliberately disjoint, so a leak is visible.
    const ids =
      this.options.recipients ??
      (churchId === CHURCH_B ? [COACH] : [PLANTER, TEAM_MEMBER]);
    return ids.map((id) => ({ id }));
  }

  async loadPreferences(
    userIds: readonly string[]
  ): Promise<NotificationPreference[]> {
    return userIds.flatMap((userId) => {
      const cadence = this.options.cadences?.[userId];
      if (!cadence) return [];
      return [
        {
          id: `p-${userId}`,
          userId,
          category: "digest" as const,
          channel: "email" as NotificationChannel,
          enabled: true,
          // A cadence-carrying row: its `enabled` is the coded default the
          // INSERT had to invent, not a choice — see `setDigestCadenceQuery`.
          intent: "incidental" as const,
          digestCadence: cadence,
          createdAt: NOW,
          updatedAt: NOW,
        },
      ];
    });
  }

  async summarizeOutstanding(input: {
    churchId: string;
    recipientUserId: string;
    period: DigestPeriod;
  }): Promise<DigestCounts> {
    this.summarised.push({
      churchId: input.churchId,
      recipientUserId: input.recipientUserId,
      period: input.period,
    });
    return (
      this.options.counts?.[`${input.churchId}|${input.recipientUserId}`] ??
      BUSY
    );
  }

  async enqueue(input: EnqueueNotificationInput): Promise<EnqueueResult> {
    if (this.options.refuse?.includes(input.recipientUserId)) {
      return {
        status: "skipped",
        notification: null,
        created: false,
        reason: "outside_church",
      };
    }

    this.enqueued.push(input);

    // The partial unique index, modelled: one live row per
    // (church, recipient, dedupeKey).
    const scope = `${input.churchId}|${input.recipientUserId}`;
    const held = this.keys.get(scope) ?? new Set<string>();
    this.keys.set(scope, held);

    const key = input.dedupeKey;
    assert.ok(key, "a digest must carry a dedupe key");

    if (held.has(key)) {
      return {
        status: "recorded",
        notification: null,
        created: false,
        reason: null,
      };
    }

    held.add(key);
    this.created.push(input);
    return {
      status: "recorded",
      notification: null,
      created: true,
      reason: null,
    };
  }
}

// ----------------------------------------------------------------------------
// AC — one digest per eligible recipient
// ----------------------------------------------------------------------------

test("a run enqueues exactly one digest per eligible recipient", async () => {
  const deps = new FakeDigestDeps({
    recipients: [PLANTER, TEAM_MEMBER, COACH],
  });

  const report = await runPlanterDigest(deps, {
    churchId: CHURCH_A,
    at: NOW,
    anchor: MONDAY_UTC,
  });

  assert.equal(deps.enqueued.length, 3);
  assert.equal(report.recipients, 3);
  assert.equal(report.created, 3);
  assert.deepEqual(
    deps.enqueued.map((row) => row.recipientUserId).sort(),
    [PLANTER, TEAM_MEMBER, COACH].sort()
  );

  // ...and each is one row, in the `digest` category, filed under the plant.
  for (const row of deps.enqueued) {
    assert.equal(row.category, "digest");
    assert.equal(row.type, PLANTER_DIGEST_TYPE);
    assert.equal(row.churchId, CHURCH_A);
    assert.equal(row.anchorOrg, undefined);
  }
});

test("a recipient with nothing outstanding receives NO digest", async () => {
  const deps = new FakeDigestDeps({
    recipients: [PLANTER, TEAM_MEMBER],
    counts: { [`${CHURCH_A}|${PLANTER}`]: NOTHING },
  });

  const report = await runPlanterDigest(deps, {
    churchId: CHURCH_A,
    at: NOW,
    anchor: MONDAY_UTC,
  });

  assert.equal(report.quiet, 1);
  assert.equal(report.created, 1);
  assert.equal(
    deps.enqueued.length,
    1,
    "enqueue was not called for the quiet one"
  );
  assert.equal(deps.enqueued[0].recipientUserId, TEAM_MEMBER);
});

test("a plant where nobody has anything outstanding sends nothing at all", async () => {
  const deps = new FakeDigestDeps({
    counts: {
      [`${CHURCH_A}|${PLANTER}`]: NOTHING,
      [`${CHURCH_A}|${TEAM_MEMBER}`]: NOTHING,
    },
  });

  const report = await runPlanterDigest(deps, {
    churchId: CHURCH_A,
    at: NOW,
    anchor: MONDAY_UTC,
  });

  assert.equal(deps.enqueued.length, 0);
  assert.equal(report.quiet, 2);
  assert.equal(report.created, 0);
});

test("a recipient enqueue refuses is reported, and costs nobody else theirs", async () => {
  const deps = new FakeDigestDeps({
    recipients: [PLANTER, TEAM_MEMBER],
    refuse: [PLANTER],
  });

  const report = await runPlanterDigest(deps, {
    churchId: CHURCH_A,
    at: NOW,
    anchor: MONDAY_UTC,
  });

  assert.equal(report.skipped, 1);
  assert.equal(report.created, 1);
});

// ----------------------------------------------------------------------------
// AC — cadence is honoured across consecutive runs
// ----------------------------------------------------------------------------

test("a weekly recipient gets ONE digest per week, not one per run", async () => {
  const deps = new FakeDigestDeps({ recipients: [PLANTER] });

  // Four runs spread across one week (Mon 00:05 → Sun 23:00).
  const withinOneWeek = [
    new Date("2026-08-17T00:05:00.000Z"),
    new Date("2026-08-17T12:00:00.000Z"),
    new Date("2026-08-20T09:00:00.000Z"),
    new Date("2026-08-23T23:00:00.000Z"),
  ];

  let created = 0;
  let deduped = 0;
  for (const at of withinOneWeek) {
    const report = await runPlanterDigest(deps, {
      churchId: CHURCH_A,
      at,
      anchor: MONDAY_UTC,
    });
    created += report.created;
    deduped += report.deduped;
  }

  assert.equal(created, 1, "one digest for the week");
  assert.equal(deduped, 3, "the later runs collapsed onto the first row");

  // Every call carried the SAME key — the cadence guard is the key, not a clock.
  assert.equal(
    new Set(deps.enqueued.map((row) => row.dedupeKey)).size,
    1,
    "one key for the week"
  );

  // The next week opens a new period and a new row.
  const nextWeek = await runPlanterDigest(deps, {
    churchId: CHURCH_A,
    at: new Date("2026-08-24T07:00:00.000Z"),
    anchor: MONDAY_UTC,
  });
  assert.equal(nextWeek.created, 1);
});

test("a daily recipient gets one per day, and cadence is read per recipient", async () => {
  const deps = new FakeDigestDeps({
    recipients: [PLANTER, TEAM_MEMBER],
    cadences: { [PLANTER]: "daily" },
  });

  await runPlanterDigest(deps, {
    churchId: CHURCH_A,
    at: NOW,
    anchor: MONDAY_UTC,
  });
  await runPlanterDigest(deps, {
    churchId: CHURCH_A,
    at: new Date("2026-08-19T21:00:00.000Z"),
    anchor: MONDAY_UTC,
  });
  const nextDay = await runPlanterDigest(deps, {
    churchId: CHURCH_A,
    at: new Date("2026-08-20T08:00:00.000Z"),
    anchor: MONDAY_UTC,
  });

  const forPlanter = deps.enqueued.filter(
    (row) => row.recipientUserId === PLANTER
  );
  const forTeamMember = deps.enqueued.filter(
    (row) => row.recipientUserId === TEAM_MEMBER
  );

  // The planter chose daily: two distinct periods across the three runs.
  assert.deepEqual(
    [...new Set(forPlanter.map((row) => row.dedupeKey))].sort(),
    [
      `${PLANTER_DIGEST_TYPE}:daily:2026-08-19`,
      `${PLANTER_DIGEST_TYPE}:daily:2026-08-20`,
    ]
  );

  // The team member never chose, so the coded default (weekly) applies and all
  // three runs fall in the same week.
  assert.equal(
    new Set(forTeamMember.map((row) => row.dedupeKey)).size,
    1,
    "the default cadence is weekly"
  );
  assert.equal(nextDay.created, 1, "only the daily recipient earned a new row");
});

test("the digest email carries a link into the app for every line it reports", async () => {
  const body = composePlanterDigestBody(BUSY);
  const message = await composePlanterDigestEmail(
    { id: PLANTER, email: "planter@example.com", name: "Sam" },
    "digest",
    [
      {
        title: composePlanterDigestTitle(
          digestPeriodFor("weekly", MONDAY_UTC, NOW)
        ),
        body,
      },
    ],
    "idem-1",
    { baseUrl: "https://app.everyfield.test", secret: TEST_UNSUBSCRIBE_SECRET }
  );

  assert.equal(message.to, "planter@example.com");
  assert.match(message.subject, /What needs your attention/);

  // Every section's destination, absolute, in the HTML AND in the text part.
  for (const part of [message.html, message.text]) {
    assert.ok(
      part.includes("https://app.everyfield.test/tasks"),
      "the tasks link is missing"
    );
    assert.ok(
      part.includes("https://app.everyfield.test/meetings"),
      "the meetings link is missing"
    );
    assert.ok(
      part.includes("https://app.everyfield.test/dashboard"),
      "the primary call to action is missing"
    );
  }

  // The summary itself reached the reader.
  assert.ok(message.html.includes("2 tasks are overdue"));
  assert.ok(message.html.includes("1 meeting is coming up"));
  assert.ok(message.html.includes("Sam"));

  // Rendered as real anchors, not as bare text.
  assert.match(
    message.html,
    /<a[^>]+href="https:\/\/app\.everyfield\.test\/tasks"/
  );

  // N-007: every dispatched email carries a working unsubscribe link, in the
  // body AND in the RFC 8058 header pair. A digest is not exempt.
  assert.ok(message.headers?.["List-Unsubscribe"]);
  assert.equal(
    message.headers?.["List-Unsubscribe-Post"],
    "List-Unsubscribe=One-Click"
  );
  assert.match(message.html, /Unsubscribe from digest emails/);
  assert.ok(message.html.includes("https://app.everyfield.test/settings"));
});

test("a body with no recognisable lines still composes a valid email", async () => {
  const message = await composePlanterDigestEmail(
    { id: PLANTER, email: "planter@example.com", name: null },
    "digest",
    [{ title: "What needs your attention", body: "something else entirely" }],
    "idem-2",
    { baseUrl: "https://app.everyfield.test", secret: TEST_UNSUBSCRIBE_SECRET }
  );

  assert.ok(message.html.includes("https://app.everyfield.test/dashboard"));
  assert.ok(message.headers?.["List-Unsubscribe"]);
});

// ----------------------------------------------------------------------------
// AC — church scoping
// ----------------------------------------------------------------------------

test("a digest is church-scoped and carries no other church's data", async () => {
  const deps = new FakeDigestDeps({
    counts: {
      [`${CHURCH_A}|${PLANTER}`]: {
        overdue_tasks: 2,
        tasks_due_soon: 0,
        upcoming_meetings: 0,
      },
      [`${CHURCH_A}|${TEAM_MEMBER}`]: NOTHING,
      [`${CHURCH_B}|${COACH}`]: {
        overdue_tasks: 0,
        tasks_due_soon: 0,
        upcoming_meetings: 9,
      },
    },
  });

  await runPlanterDigest(deps, {
    churchId: CHURCH_A,
    at: NOW,
    anchor: MONDAY_UTC,
  });
  await runPlanterDigest(deps, {
    churchId: CHURCH_B,
    at: NOW,
    anchor: MONDAY_UTC,
  });

  const forA = deps.enqueued.filter((row) => row.churchId === CHURCH_A);
  const forB = deps.enqueued.filter((row) => row.churchId === CHURCH_B);

  assert.equal(forA.length, 1);
  assert.equal(forB.length, 1);

  // Church A's planter hears about A's two overdue tasks and NOTHING about B's
  // nine meetings — the number, the noun and the recipient all stay inside the
  // tenant.
  assert.equal(forA[0].recipientUserId, PLANTER);
  assert.equal(forA[0].body, "2 tasks are overdue");
  assert.doesNotMatch(String(forA[0].body), /9|meeting/);

  assert.equal(forB[0].recipientUserId, COACH);
  assert.equal(forB[0].body, "9 meetings are coming up");

  // Nobody was ever summarised against the other tenant.
  for (const call of deps.summarised) {
    const ownTeam =
      call.churchId === CHURCH_B ? [COACH] : [PLANTER, TEAM_MEMBER];
    assert.ok(
      ownTeam.includes(call.recipientUserId),
      `${call.recipientUserId} was summarised against ${call.churchId}`
    );
  }
});

test("the owed-plants selection scopes every correlated probe by church", () => {
  const { sql } = plantsOwedPlanterDigestQuery({
    anchor: MONDAY_UTC,
    at: NOW,
    limit: 25,
    afterChurchId: null,
  }).toSQL();

  // Every table the probe reaches is correlated to the outer plant, which is
  // what stops one plant's tasks or meetings making another plant owed.
  assert.match(sql, /"tasks"\."church_id" = "churches"\."id"/);
  assert.match(sql, /"church_meetings"\."church_id" = "churches"\."id"/);
  assert.match(
    sql,
    /"owed_planter_digest_member"\."church_id" = "churches"\."id"/
  );
  assert.match(sql, /"notifications"\."church_id" = "churches"\."id"/);

  // Liveness: a cancelled row no longer reserves its key, exactly as the
  // partial unique index says.
  assert.match(sql, /"notifications"\."status" <> /);

  // A subtask is a checklist item, not a task (memory/invariants.md → Tasks).
  assert.match(sql, /"tasks"\."parent_task_id" is null/);

  // The keyset cursor is absent on the first page and present after it.
  assert.doesNotMatch(sql, /"churches"\."id" > /);
  const paged = plantsOwedPlanterDigestQuery({
    anchor: MONDAY_UTC,
    at: NOW,
    limit: 25,
    afterChurchId: CHURCH_A,
  }).toSQL();
  assert.match(paged.sql, /"churches"\."id" > /);
});

test("the selection is COHORT-scoped, and its owed test is still two literals", () => {
  // The half of #448 that keeps the sweep's design intact. Making the send time
  // per-church makes the key's VALUE church-dependent; it must not make the key
  // STRING carry a church id, or the owed test degrades from an `IN` on two
  // literals into the concatenated-uuid `LIKE` the oversight sweep fell back on.
  const eastern = plantsOwedPlanterDigestQuery({
    anchor: EASTERN_SUNDAY_4PM,
    at: NOW,
    limit: 25,
    afterChurchId: null,
  }).toSQL();

  // The page is filtered to one (zone, weekday, hour)...
  assert.match(eastern.sql, /"churches"\."time_zone" = /);
  assert.match(eastern.sql, /"churches"\."digest_send_weekday" = /);
  assert.match(eastern.sql, /"churches"\."digest_send_hour" = /);
  assert.ok(eastern.params.includes("America/New_York"));

  // ...and the dedupe test names exactly two keys, neither carrying a church.
  const keys = eastern.params.filter(
    (param): param is string =>
      typeof param === "string" && param.startsWith(`${PLANTER_DIGEST_TYPE}:`)
  );
  assert.equal(keys.length, 2, "one key per cadence, and no more");
  assert.deepEqual(
    keys.sort(),
    currentDigestDedupeKeys(EASTERN_SUNDAY_4PM, NOW).sort()
  );
  for (const key of keys) {
    assert.doesNotMatch(key, /-4[0-9a-f]{3}-/, "a uuid reached the key string");
  }
  assert.doesNotMatch(eastern.sql, /like/i, "the owed test degraded to a LIKE");

  // A second cohort on the same instant asks for different keys — which is the
  // whole reason the query derives them from the anchor rather than taking them.
  const pacific = plantsOwedPlanterDigestQuery({
    anchor: PACIFIC_WEDNESDAY_7AM,
    at: NOW,
    limit: 25,
    afterChurchId: null,
  }).toSQL();
  assert.notDeepEqual(
    pacific.params.filter(
      (param) =>
        typeof param === "string" && param.startsWith(`${PLANTER_DIGEST_TYPE}:`)
    ),
    keys
  );
});

// ----------------------------------------------------------------------------
// AC — a disabled `digest` category is recorded as suppressed_by_preference
// ----------------------------------------------------------------------------

/**
 * The minimum of `dispatch.ts`'s deps needed to watch ONE digest row through a
 * run. `dispatch.test.ts` owns the exhaustive fake; this one exists to assert
 * the digest's own end of the contract.
 */
class TinyDispatchStore implements DispatchDeps {
  readonly deliveries: NotificationDelivery[] = [];
  readonly sends: OutboundEmail[] = [];
  readonly preferences: NotificationPreference[] = [];

  constructor(
    readonly notifications: Notification[],
    readonly recipients: DispatchRecipient[]
  ) {}

  disable(userId: string, channel: NotificationChannel): void {
    this.preferences.push({
      id: `p-${this.preferences.length + 1}`,
      userId,
      category: "digest",
      channel,
      enabled: false,
      // A deliberate opt-out, the way the settings toggle writes one.
      intent: "chosen",
      digestCadence: null,
      createdAt: NOW,
      updatedAt: NOW,
    });
  }

  deliveryFor(notificationId: string, channel: NotificationChannel) {
    return this.deliveries.find(
      (row) => row.notificationId === notificationId && row.channel === channel
    );
  }

  async claimDue(now: Date, limit: number): Promise<Notification[]> {
    const due = this.notifications
      .filter((row) => row.status === "pending" && row.scheduledFor <= now)
      .slice(0, limit);
    for (const row of due) row.status = "claimed";
    return due.map((row) => ({ ...row }));
  }
  async countRemainingDue(): Promise<number> {
    return 0;
  }
  async loadRecipients(userIds: readonly string[]) {
    return this.recipients.filter((row) => userIds.includes(row.id));
  }
  async loadPreferences(userIds: readonly string[]) {
    return this.preferences.filter((row) => userIds.includes(row.userId));
  }
  async loadDeliveries() {
    return [];
  }
  async claimDelivery(
    notificationId: string,
    channel: NotificationChannel
  ): Promise<DeliveryClaim> {
    if (this.deliveryFor(notificationId, channel)) return { status: "lost" };
    this.deliveries.push({
      id: `d-${this.deliveries.length + 1}`,
      notificationId,
      channel,
      status: "queued",
      attemptCount: 1,
      error: null,
      providerMessageId: null,
      sentAt: null,
      createdAt: NOW,
      updatedAt: NOW,
    });
    return { status: "claimed", attemptCount: 1 };
  }
  async recordTerminalDelivery(
    notificationId: string,
    channel: NotificationChannel,
    status: "suppressed_by_preference" | "cancelled",
    now: Date
  ): Promise<void> {
    if (this.deliveryFor(notificationId, channel)) return;
    this.deliveries.push({
      id: `d-${this.deliveries.length + 1}`,
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
    sentAt?: Date | null;
  }): Promise<void> {
    const row = this.deliveryFor(input.notificationId, input.channel);
    assert.ok(row, "settled a delivery that was never claimed");
    row.status = input.status;
    row.sentAt = input.sentAt ?? null;
  }
  async finishNotification(
    notificationId: string,
    status: NotificationStatus
  ): Promise<void> {
    const row = this.notifications.find((n) => n.id === notificationId);
    if (row) row.status = status;
  }
  async releaseClaims(): Promise<void> {}
  async loadSuppressedAddresses(): Promise<string[]> {
    return [];
  }
  async sendEmail(message: OutboundEmail) {
    this.sends.push(message);
    return { status: "sent" as const, providerMessageId: "m-1" };
  }
}

function digestRow(overrides: Partial<NewNotification> = {}): Notification {
  const period = digestPeriodFor("weekly", MONDAY_UTC, NOW);
  return {
    id: "n-digest",
    anchorType: "church",
    churchId: CHURCH_A,
    anchorOrgId: null,
    recipientUserId: PLANTER,
    category: "digest",
    type: PLANTER_DIGEST_TYPE,
    title: composePlanterDigestTitle(period),
    body: composePlanterDigestBody(BUSY),
    entityType: null,
    entityId: null,
    dedupeKey: planterDigestDedupeKey(period),
    scheduledFor: new Date(NOW.getTime() - 60_000),
    status: "pending",
    readAt: null,
    createdAt: NOW,
    updatedAt: NOW,
    ...overrides,
  } as Notification;
}

test("a user who turned the digest category off is recorded suppressed_by_preference", async () => {
  const row = digestRow();
  const store = new TinyDispatchStore(
    [row],
    [
      {
        id: PLANTER,
        email: "planter@example.com",
        name: null,
        churchId: CHURCH_A,
        sendingChurchId: null,
        sendingNetworkId: null,
      },
    ]
  );
  store.disable(PLANTER, "email");
  store.disable(PLANTER, "in_app");

  const summary = await runDispatch(store, { now: NOW });

  assert.equal(store.sends.length, 0, "no email may go out");
  assert.equal(summary.emailsSent, 0);
  assert.equal(summary.suppressed, 2, "one refusal recorded per channel");

  // N-016: the delivery log says WHY it never arrived, per channel.
  for (const channel of ["email", "in_app"] as const) {
    assert.equal(
      store.deliveryFor(row.id, channel)?.status,
      "suppressed_by_preference"
    );
  }

  // An opt-out is a choice, not a failure: the row is done, not `failed`.
  assert.equal(store.notifications[0].status, "delivered");
});

test("with the digest on, the dispatcher sends it through the digest template", async () => {
  const row = digestRow();
  const store = new TinyDispatchStore(
    [row],
    [
      {
        id: PLANTER,
        email: "planter@example.com",
        name: null,
        churchId: CHURCH_A,
        sendingChurchId: null,
        sendingNetworkId: null,
      },
    ]
  );

  const summary = await runDispatch(store, { now: NOW });

  assert.equal(summary.emailsSent, 1);
  const [message] = store.sends;

  // The digest template's own marks: a per-line link and the primary CTA. The
  // generic batch template renders neither.
  assert.match(message.html, /Open your tasks/);
  assert.match(message.html, /Open EveryField/);
  assert.ok(message.html.includes("/dashboard"));
});

test("the composer is chosen by type, and a mixed group falls back", () => {
  const digest = digestRow();
  const other = digestRow({ id: "n-other", type: "oversight.activity.digest" });

  assert.notEqual(
    emailComposerForGroup([digest]),
    emailComposerForGroup([other]),
    "the planter digest gets its own composer"
  );
  assert.equal(
    emailComposerForGroup([digest, other]),
    emailComposerForGroup([other]),
    "a mixed group falls back to the generic template"
  );
  assert.equal(
    emailComposerForGroup([]),
    emailComposerForGroup([other]),
    "an empty group falls back"
  );

  // A stored `type` is untrusted text: `constructor` must not resolve through
  // `Object.prototype` into something callable.
  assert.equal(
    emailComposerForGroup([digestRow({ id: "n-proto", type: "constructor" })]),
    emailComposerForGroup([other])
  );
});

// ----------------------------------------------------------------------------
// The sweep
// ----------------------------------------------------------------------------

class FakeSweepDeps implements PlanterDigestSweepDeps {
  readonly digested: string[] = [];
  pages: string[][] = [];
  failOn = new Set<string>();
  selectionThrows = false;
  /** One cohort unless a case says otherwise — the shape before #448. */
  anchors: DigestAnchor[] = [MONDAY_UTC];

  async listAnchors(): Promise<DigestAnchor[]> {
    return this.anchors;
  }

  async selectPlantsOwed(query: {
    afterChurchId: string | null;
    limit: number;
  }): Promise<string[]> {
    if (this.selectionThrows) throw new Error("selection blew up");
    // The real query's keyset, modelled: `id > the last one reached`, never a
    // position lookup — which is also what makes a page short at the end.
    const after = query.afterChurchId;
    const remaining = after
      ? this.pages.flat().filter((id) => id > after)
      : this.pages.flat();
    return remaining.slice(0, query.limit);
  }

  async runDigest(churchId: string) {
    if (this.failOn.has(churchId)) throw new Error(`boom for ${churchId}`);
    this.digested.push(churchId);
    return {
      recipients: 1,
      created: 1,
      deduped: 0,
      quiet: 0,
      skipped: 0,
    };
  }
}

test("the sweep pages through the owed set and totals what it wrote", async () => {
  const deps = new FakeSweepDeps();
  deps.pages = [["c1", "c2"], ["c3"]];

  const summary = await runPlanterDigestSweep(deps, { at: NOW, limit: 2 });

  assert.deepEqual(deps.digested, ["c1", "c2", "c3"]);
  assert.equal(summary.plantsScanned, 3);
  assert.equal(summary.created, 3);
  assert.equal(summary.pages, 2);
  assert.equal(summary.budgetExhausted, false);
});

test("a plant whose digest throws never blocks the plants behind it", async () => {
  const deps = new FakeSweepDeps();
  deps.pages = [["c1", "c2", "c3"]];
  deps.failOn.add("c1");

  const summary = await runPlanterDigestSweep(deps, { at: NOW, limit: 3 });

  assert.deepEqual(deps.digested, ["c2", "c3"]);
  assert.equal(summary.failed, 1);
  assert.equal(
    summary.plantsScanned,
    3,
    "the cursor advanced past the failure"
  );
});

test("the sweep never throws, even when the selection does", async () => {
  const deps = new FakeSweepDeps();
  deps.selectionThrows = true;

  const summary = await runPlanterDigestSweep(deps, { at: NOW });

  assert.equal(summary.failed, 1);
  assert.equal(summary.plantsScanned, 0);
});

test("the budget stops the sweep between plants and the rest roll over", async () => {
  const deps = new FakeSweepDeps();
  deps.pages = [["c1", "c2", "c3", "c4"]];

  let elapsed = 0;
  const summary = await runPlanterDigestSweep(deps, {
    at: NOW,
    limit: 4,
    budgetMs: 10,
    elapsedMs: () => {
      elapsed += 6;
      return elapsed;
    },
  });

  assert.equal(summary.budgetExhausted, true);
  assert.ok(summary.plantsScanned < 4, "it stopped early");
  assert.equal(deps.digested.length, summary.plantsScanned);
});

test("one tick sweeps every cohort, and a cohort's failure costs only that cohort", async () => {
  const deps = new FakeSweepDeps();
  deps.anchors = [EASTERN_SUNDAY_4PM, PACIFIC_WEDNESDAY_7AM];
  deps.pages = [["c1", "c2"]];

  const summary = await runPlanterDigestSweep(deps, { at: NOW, limit: 5 });

  // Each cohort gets its own keyset scan, so the same fake page is walked twice.
  assert.deepEqual(deps.digested, ["c1", "c2", "c1", "c2"]);
  assert.equal(summary.pages, 2);

  // The budget and the plant ceiling are the TICK's, shared across cohorts —
  // a product with many zones reaches fewer plants per tick, never more.
  const capped = new FakeSweepDeps();
  capped.anchors = [EASTERN_SUNDAY_4PM, PACIFIC_WEDNESDAY_7AM];
  capped.pages = [["c1", "c2", "c3"]];
  const bounded = await runPlanterDigestSweep(capped, {
    at: NOW,
    limit: 3,
    maxPlants: 3,
  });
  assert.equal(bounded.plantsScanned, 3, "the ceiling spans the cohorts");
});

test("a sweep with no plants configured anywhere does nothing and reports it", async () => {
  const deps = new FakeSweepDeps();
  deps.anchors = [];

  const summary = await runPlanterDigestSweep(deps, { at: NOW });

  assert.equal(summary.plantsScanned, 0);
  assert.equal(summary.pages, 0);
  assert.equal(summary.failed, 0);
});

// ----------------------------------------------------------------------------
// AC — TWO ZONES, TWO CONFIGURED TIMES, ONE DISPATCHER RUN (N-013, #448)
// ----------------------------------------------------------------------------
//
// The acceptance criterion this file exists to answer, driven end to end: the
// real sweep over the real per-plant run, across eight days of 15-minute ticks.
// Nothing is stubbed but the storage.

/** Every fifteen minutes from `from`, for `days` days. The dispatcher's tick. */
function ticks(from: Date, days: number): Date[] {
  return Array.from(
    { length: days * 96 },
    (_, i) => new Date(from.getTime() + i * 15 * 60_000)
  );
}

class TwoChurchWorld implements PlanterDigestSweepDeps {
  readonly digest: FakeDigestDeps;
  /** Every row actually written, with the tick that wrote it. */
  readonly sends: {
    churchId: string;
    recipientUserId: string;
    dedupeKey: string;
    at: Date;
  }[] = [];

  private readonly anchorOf = new Map<string, DigestAnchor>([
    [CHURCH_A, EASTERN_SUNDAY_4PM],
    [CHURCH_B, PACIFIC_WEDNESDAY_7AM],
  ]);

  constructor() {
    // Church A runs a weekly planter and a DAILY team member, so the same
    // church anchor serves both cadences in the same sweep.
    this.digest = new FakeDigestDeps({
      cadences: { [TEAM_MEMBER]: "daily" },
    });
  }

  async listAnchors(): Promise<DigestAnchor[]> {
    return [...this.anchorOf.values()];
  }

  async selectPlantsOwed(query: {
    anchor: DigestAnchor;
    afterChurchId: string | null;
    limit: number;
  }): Promise<string[]> {
    // The real query filters on the cohort's three columns and on owed-ness.
    // The cohort filter is modelled here; owed-ness is modelled by the dedupe
    // index inside `FakeDigestDeps.enqueue`, which is the same arbiter.
    return [...this.anchorOf.entries()]
      .filter(([, anchor]) => anchor === query.anchor)
      .map(([churchId]) => churchId)
      .filter((id) => (query.afterChurchId ? id > query.afterChurchId : true))
      .sort()
      .slice(0, query.limit);
  }

  async runDigest(churchId: string, at: Date, anchor: DigestAnchor) {
    const before = this.digest.created.length;
    const report = await runPlanterDigest(this.digest, {
      churchId,
      at,
      anchor,
    });
    for (const row of this.digest.created.slice(before)) {
      // `enqueue` admits an org-anchored notification, so both are optional on
      // its input. A digest is always church-anchored and always keyed; asserting
      // it here says so rather than widening the record with a `?? ""`.
      assert.ok(row.churchId, "a digest row with no church");
      assert.ok(row.dedupeKey, "a digest row with no dedupe key");
      this.sends.push({
        churchId: row.churchId,
        recipientUserId: row.recipientUserId,
        dedupeKey: row.dedupeKey,
        at,
      });
    }
    return report;
  }
}

test("two churches, two zones, two configured times — one dispatcher run each tick", async () => {
  const world = new TwoChurchWorld();
  const window = ticks(new Date("2026-08-16T00:00:00.000Z"), 8);

  for (const at of window) {
    await runPlanterDigestSweep(world, { at, limit: 10 });
  }

  // ------------------------------------------------------------------
  // ONCE PER RECIPIENT PER PERIOD, across every tick in that period.
  // ------------------------------------------------------------------
  const identities = world.sends.map(
    (send) => `${send.churchId}|${send.recipientUserId}|${send.dedupeKey}`
  );
  assert.deepEqual(
    identities,
    [...new Set(identities)],
    "a period was served twice"
  );

  // ------------------------------------------------------------------
  // EACH ROW LANDED IN THE TICK COVERING ITS OWN LOCAL SEND TIME.
  // ------------------------------------------------------------------
  // The expected tick is the first in the sweep at or after the period opened —
  // which for a period already open when the window started is the very first
  // tick, and for every later one is 16:00 Eastern or 07:00 Pacific exactly.
  for (const send of world.sends) {
    const cadence = send.dedupeKey.includes(":daily:") ? "daily" : "weekly";
    const anchor =
      send.churchId === CHURCH_A ? EASTERN_SUNDAY_4PM : PACIFIC_WEDNESDAY_7AM;
    const period = digestPeriodFor(cadence, anchor, send.at);

    assert.equal(
      planterDigestDedupeKey(period),
      send.dedupeKey,
      "the row was written under a period the tick does not belong to"
    );
    const firstCoveringTick = window.find((tick) => tick >= period.start);
    assert.equal(
      send.at.toISOString(),
      firstCoveringTick?.toISOString(),
      `${send.recipientUserId} was served late: ${send.at.toISOString()} for a period opening ${period.start.toISOString()}`
    );
  }

  // ------------------------------------------------------------------
  // THE SEND INSTANTS THEMSELVES.
  // ------------------------------------------------------------------
  const weeklyFor = (userId: string) =>
    world.sends
      .filter(
        (send) =>
          send.recipientUserId === userId && send.dedupeKey.includes(":weekly:")
      )
      .map((send) => send.at.toISOString());

  // Church A's planter, at Sunday 16:00 Eastern. The window opens at
  // 2026-08-16T00:00Z, which is Saturday 20:00 EDT — still inside the week that
  // began Sunday the 9th, so that period is served on the first tick. The two
  // after it are Sundays the 16th and the 23rd, each at 16:00 EDT = 20:00 UTC.
  //
  // NOT 2026-08-16T00:00Z for the week of the 16th, which is what a UTC-day
  // boundary would have produced and is Saturday evening in the Americas — the
  // failure the ruling exists to prevent.
  assert.deepEqual(weeklyFor(PLANTER), [
    "2026-08-16T00:00:00.000Z",
    "2026-08-16T20:00:00.000Z",
    "2026-08-23T20:00:00.000Z",
  ]);

  // Church B's coach, at Wednesday 07:00 Pacific: the week already open on the
  // first tick, then Wednesday 2026-08-19 at 07:00 PDT — 14:00 UTC. A DIFFERENT
  // day AND a different hour from Church A's, out of the same dispatcher runs.
  assert.deepEqual(weeklyFor(COACH), [
    "2026-08-16T00:00:00.000Z",
    "2026-08-19T14:00:00.000Z",
  ]);

  // ------------------------------------------------------------------
  // THE HOUR GOVERNS THE DAILY CADENCE TOO, AND THE WEEKDAY DOES NOT.
  // ------------------------------------------------------------------
  // The team member chose daily, in the same church, under the same anchor.
  // Every one of their sends is at 16:00 Eastern, on every weekday.
  const daily = world.sends.filter(
    (send) => send.recipientUserId === TEAM_MEMBER
  );
  assert.ok(
    daily.every((send) => send.dedupeKey.includes(":daily:")),
    "the CHURCH setting overrode the RECIPIENT's cadence"
  );
  // Nine: the day already in progress when the window opened, plus the eight
  // that opened inside it.
  assert.equal(daily.length, 9, "one per day across the window");
  assert.deepEqual(
    daily.slice(1).map((send) => send.at.toISOString().slice(11)),
    Array(8).fill("20:00:00.000Z"),
    "every daily after the first landed at 16:00 EDT"
  );

  // And the planter in that same church stayed weekly — three rows, not nine.
  assert.equal(weeklyFor(PLANTER).length, 3);
});
