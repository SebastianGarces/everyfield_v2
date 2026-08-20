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
  widestPeriodEnd,
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

  const report = await runPlanterDigest(deps, { churchId: CHURCH_A, at: NOW });

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

  const report = await runPlanterDigest(deps, { churchId: CHURCH_A, at: NOW });

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

  const report = await runPlanterDigest(deps, { churchId: CHURCH_A, at: NOW });

  assert.equal(deps.enqueued.length, 0);
  assert.equal(report.quiet, 2);
  assert.equal(report.created, 0);
});

test("a recipient enqueue refuses is reported, and costs nobody else theirs", async () => {
  const deps = new FakeDigestDeps({
    recipients: [PLANTER, TEAM_MEMBER],
    refuse: [PLANTER],
  });

  const report = await runPlanterDigest(deps, { churchId: CHURCH_A, at: NOW });

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
    const report = await runPlanterDigest(deps, { churchId: CHURCH_A, at });
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
  });
  assert.equal(nextWeek.created, 1);
});

test("a daily recipient gets one per day, and cadence is read per recipient", async () => {
  const deps = new FakeDigestDeps({
    recipients: [PLANTER, TEAM_MEMBER],
    cadences: { [PLANTER]: "daily" },
  });

  await runPlanterDigest(deps, { churchId: CHURCH_A, at: NOW });
  await runPlanterDigest(deps, {
    churchId: CHURCH_A,
    at: new Date("2026-08-19T21:00:00.000Z"),
  });
  const nextDay = await runPlanterDigest(deps, {
    churchId: CHURCH_A,
    at: new Date("2026-08-20T08:00:00.000Z"),
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
        title: composePlanterDigestTitle(digestPeriodFor("weekly", NOW)),
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

  await runPlanterDigest(deps, { churchId: CHURCH_A, at: NOW });
  await runPlanterDigest(deps, { churchId: CHURCH_B, at: NOW });

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
    dedupeKeys: currentDigestDedupeKeys(NOW),
    at: NOW,
    lookaheadEnd: widestPeriodEnd(NOW),
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

  // The keyset anchor is absent on the first page and present after it.
  assert.doesNotMatch(sql, /"churches"\."id" > /);
  const paged = plantsOwedPlanterDigestQuery({
    dedupeKeys: currentDigestDedupeKeys(NOW),
    at: NOW,
    lookaheadEnd: widestPeriodEnd(NOW),
    limit: 25,
    afterChurchId: CHURCH_A,
  }).toSQL();
  assert.match(paged.sql, /"churches"\."id" > /);
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
  const period = digestPeriodFor("weekly", NOW);
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
