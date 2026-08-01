import assert from "node:assert/strict";
import { test } from "node:test";

import type { EnqueueNotificationInput, EnqueueResult } from "./enqueue";
import {
  activityWindowForDay,
  composeDigestBody,
  dayKeyInAppZone,
  digestDayKey,
  digestDedupeKey,
  previousCompleteDayWindow,
  runOversightDigest,
  runOversightDigestSweep,
  totalActivity,
  type ActivityWindow,
  type OversightActivitySummary,
  type OversightDigestDeps,
  type OversightDigestOutcome,
  type OversightDigestSweepDeps,
} from "./oversight-digest";

// ----------------------------------------------------------------------------
// The daily activity digest (N-025).
//
// DATABASE_URL is present in this environment because importing this module
// pulls in `@/db` for its production wiring; nothing below touches Postgres —
// every dependency is injected.
// ----------------------------------------------------------------------------

const CHURCH = "11111111-1111-4111-8111-111111111111";
const ADMIN_A = "22222222-2222-4222-8222-222222222222";
const ADMIN_B = "33333333-3333-4333-8333-333333333333";

const QUIET: OversightActivitySummary = {
  peopleAdded: 0,
  meetingsHeld: 0,
  tasksCompleted: 0,
  stagesReached: 0,
};

const BUSY: OversightActivitySummary = {
  peopleAdded: 2,
  meetingsHeld: 1,
  tasksCompleted: 5,
  stagesReached: 0,
};

interface FakeOptions {
  summary: OversightActivitySummary;
  recipients?: string[];
  sharing?: boolean;
  plant?: { id: string; name: string } | null;
}

class FakeDigestDeps implements OversightDigestDeps {
  readonly enqueued: EnqueueNotificationInput[] = [];
  enqueueCalls = 0;
  summarizeCalls = 0;
  sharing: boolean;

  constructor(readonly options: FakeOptions) {
    this.sharing = options.sharing ?? true;
  }

  async loadPlant() {
    return this.options.plant === undefined
      ? { id: CHURCH, name: "Grace Chapel" }
      : this.options.plant;
  }

  // The real parameters, even though the default body ignores them: a test that
  // needs to prove WHICH window was queried (the previous-complete-day default)
  // replaces this method, and it can only see the window if the signature has
  // one.
  async summarizeActivity(
    _churchId: string,
    _window: ActivityWindow
  ): Promise<OversightActivitySummary> {
    this.summarizeCalls += 1;
    return this.options.summary;
  }

  async listOversightRecipients() {
    return (this.options.recipients ?? [ADMIN_A, ADMIN_B]).map((id) => ({
      id,
    }));
  }

  async enqueue(input: EnqueueNotificationInput): Promise<EnqueueResult> {
    this.enqueueCalls += 1;

    if (!this.sharing) {
      return {
        status: "skipped",
        notification: null,
        created: false,
        reason: "oversight_privacy",
      };
    }

    const duplicate = this.enqueued.some(
      (row) =>
        row.dedupeKey === input.dedupeKey &&
        row.recipientUserId === input.recipientUserId
    );
    if (duplicate) {
      return {
        status: "recorded",
        notification: null,
        created: false,
        reason: null,
      };
    }

    this.enqueued.push(input);
    return {
      status: "recorded",
      notification: null,
      created: true,
      reason: null,
    };
  }
}

const DAY: ActivityWindow = activityWindowForDay(
  new Date("2026-07-30T13:45:00.000Z")
);

// ----------------------------------------------------------------------------
// "Only when there was activity"
// ----------------------------------------------------------------------------

test("a day WITH activity produces one digest per oversight recipient", async () => {
  const deps = new FakeDigestDeps({ summary: BUSY });

  const outcome = await runOversightDigest(deps, {
    churchId: CHURCH,
    window: DAY,
  });

  assert.equal(outcome.status, "enqueued");
  assert.equal(outcome.status === "enqueued" && outcome.report.created, 2);
  assert.deepEqual(
    deps.enqueued.map((row) => row.recipientUserId),
    [ADMIN_A, ADMIN_B]
  );
  // One row EACH, not one row shared and not two rows each.
  assert.equal(deps.enqueued.length, 2);
});

test("a day WITHOUT activity produces none — enqueue is never called", async () => {
  // The requirement, and the reason it is a branch rather than a filter: a
  // digest that arrives on a quiet day teaches its reader to stop opening it,
  // and then the day something happened is the day it goes unread. The
  // assertion that matters is the CALL COUNT — "no rows written" would also be
  // true of a digest that was composed, enqueued and then suppressed.
  const deps = new FakeDigestDeps({ summary: QUIET });

  const outcome = await runOversightDigest(deps, {
    churchId: CHURCH,
    window: DAY,
  });

  assert.deepEqual(outcome, {
    status: "skipped",
    reason: "no_activity",
    dayKey: "2026-07-30",
  });
  assert.equal(deps.enqueueCalls, 0);
  assert.equal(deps.enqueued.length, 0);
});

test("a single event anywhere is activity", async () => {
  for (const key of [
    "peopleAdded",
    "meetingsHeld",
    "tasksCompleted",
    "stagesReached",
  ] as const) {
    const deps = new FakeDigestDeps({ summary: { ...QUIET, [key]: 1 } });
    const outcome = await runOversightDigest(deps, {
      churchId: CHURCH,
      window: DAY,
    });
    assert.equal(outcome.status, "enqueued", key);
  }
});

test("totalActivity sums every bucket", () => {
  assert.equal(totalActivity(QUIET), 0);
  assert.equal(totalActivity(BUSY), 8);
});

// ----------------------------------------------------------------------------
// The gate is still `enqueue`
// ----------------------------------------------------------------------------

test("with the plant not sharing, a busy day still writes nothing", async () => {
  const deps = new FakeDigestDeps({ summary: BUSY, sharing: false });

  const outcome = await runOversightDigest(deps, {
    churchId: CHURCH,
    window: DAY,
  });

  assert.equal(outcome.status, "enqueued");
  assert.equal(outcome.status === "enqueued" && outcome.report.skipped, 2);
  assert.equal(deps.enqueued.length, 0);
});

test("flipping the toggle changes the very next run's outcome", async () => {
  // Nothing is cached between runs, so a planter's decision at 09:00 governs
  // the 09:01 digest. The digest does not consult the toggle itself — it
  // composes and lets `enqueue` decide — which is why there is nothing here to
  // invalidate.
  const deps = new FakeDigestDeps({ summary: BUSY, sharing: false });

  await runOversightDigest(deps, { churchId: CHURCH, window: DAY });
  assert.equal(deps.enqueued.length, 0);

  deps.sharing = true;
  await runOversightDigest(deps, { churchId: CHURCH, window: DAY });
  assert.equal(deps.enqueued.length, 2);
});

// ----------------------------------------------------------------------------
// Idempotence and identity
// ----------------------------------------------------------------------------

test("running twice on the same day writes one row per recipient", async () => {
  const deps = new FakeDigestDeps({ summary: BUSY });

  await runOversightDigest(deps, { churchId: CHURCH, window: DAY });
  const second = await runOversightDigest(deps, {
    churchId: CHURCH,
    window: DAY,
  });

  assert.equal(deps.enqueued.length, 2);
  assert.equal(second.status === "enqueued" && second.report.created, 0);
  assert.equal(second.status === "enqueued" && second.report.recorded, 2);
});

test("the dedupe key is (church, day), so tomorrow is a new digest", async () => {
  const deps = new FakeDigestDeps({ summary: BUSY, recipients: [ADMIN_A] });

  await runOversightDigest(deps, { churchId: CHURCH, window: DAY });
  await runOversightDigest(deps, {
    churchId: CHURCH,
    window: activityWindowForDay(new Date("2026-07-31T02:00:00.000Z")),
  });

  assert.equal(deps.enqueued.length, 2);
  assert.deepEqual(
    deps.enqueued.map((row) => row.dedupeKey),
    [
      `oversight.activity.digest:${CHURCH}:2026-07-30`,
      `oversight.activity.digest:${CHURCH}:2026-07-31`,
    ]
  );
});

test("an unknown plant is skipped without asking anything else", async () => {
  const deps = new FakeDigestDeps({ summary: BUSY, plant: null });

  const outcome = await runOversightDigest(deps, {
    churchId: CHURCH,
    window: DAY,
  });

  assert.equal(outcome.status, "skipped");
  assert.equal(outcome.status === "skipped" && outcome.reason, "unknown_plant");
  assert.equal(deps.summarizeCalls, 0);
  assert.equal(deps.enqueueCalls, 0);
});

// ----------------------------------------------------------------------------
// The body: counts, never contents
// ----------------------------------------------------------------------------

test("the body is counts, and omits the buckets that were zero", () => {
  assert.equal(
    composeDigestBody(BUSY),
    "1 meeting, 2 new people, 5 tasks finished."
  );
});

test("singular and plural are both handled", () => {
  assert.equal(
    composeDigestBody({
      peopleAdded: 1,
      meetingsHeld: 2,
      tasksCompleted: 1,
      stagesReached: 1,
    }),
    "2 meetings, 1 new person, 1 task finished, 1 new stage."
  );
});

test("the digest carries no field that could hold a name", async () => {
  // Structural, not stylistic. `OversightActivitySummary` has four numeric
  // fields and nothing else, so there is no path by which a person's name or a
  // task's title could reach an oversight inbox even by mistake — which is the
  // promise `OVERSIGHT_SHARING_TOGGLE` makes to the planter.
  const deps = new FakeDigestDeps({ summary: BUSY, recipients: [ADMIN_A] });
  await runOversightDigest(deps, { churchId: CHURCH, window: DAY });

  const body = deps.enqueued[0].body;
  assert.match(body, /^[0-9 a-z,.]+$/);
  assert.equal(deps.enqueued[0].category, "digest");
  assert.equal(deps.enqueued[0].type, "oversight.activity.digest");
});

// ----------------------------------------------------------------------------
// The day boundary
// ----------------------------------------------------------------------------

test("the window is a whole day in APP_TIME_ZONE, half-open", () => {
  assert.equal(DAY.from.toISOString(), "2026-07-30T00:00:00.000Z");
  assert.equal(DAY.to.toISOString(), "2026-07-31T00:00:00.000Z");
  assert.equal(digestDayKey(DAY), "2026-07-30");
});

test("the daily window is the last day that is OVER, never a partial today", () => {
  // The hazard this replaced: `activityWindowForDay(now)` gave a scheduled run
  // the day it was running IN. The digest's dedupe key is (church, day) and the
  // partial unique index makes the first row for that day final, so a 07:00 run
  // would have frozen "00:00–07:00" as the whole of that day forever — and a
  // run early enough to find nothing yet would have returned `no_activity`,
  // making a day WITH activity produce NO digest.
  const window = previousCompleteDayWindow(
    new Date("2026-07-31T07:00:00.000Z")
  );

  assert.equal(window.from.toISOString(), "2026-07-30T00:00:00.000Z");
  assert.equal(window.to.toISOString(), "2026-07-31T00:00:00.000Z");
  assert.equal(digestDayKey(window), "2026-07-30");
});

test("a run at 01:00 and a run at 23:00 digest the same day, identically", async () => {
  // The property a scheduler depends on: the HOUR the job fires cannot change
  // the answer. Same window in, same day key, same counts, same dedupe key —
  // so a retry is a genuine no-op rather than a second, different opinion that
  // the unique index then freezes.
  const early = new Date("2026-07-31T01:00:00.000Z");
  const late = new Date("2026-07-31T23:00:00.000Z");

  assert.deepEqual(
    previousCompleteDayWindow(early),
    previousCompleteDayWindow(late)
  );

  // A summarizer whose answer DEPENDS on the window, so "same counts" is a
  // claim about the query being asked and not just about a constant fake.
  const seen: ActivityWindow[] = [];
  const runAt = async (at: Date) => {
    const deps = new FakeDigestDeps({ summary: QUIET, recipients: [ADMIN_A] });
    deps.summarizeActivity = async (
      _churchId: string,
      window: ActivityWindow
    ) => {
      seen.push(window);
      return {
        ...QUIET,
        meetingsHeld: window.from.getUTCDate(),
        tasksCompleted:
          (window.to.getTime() - window.from.getTime()) / 3_600_000,
      };
    };

    const outcome = await runOversightDigest(deps, {
      churchId: CHURCH,
      window: previousCompleteDayWindow(at),
    });
    return { outcome, deps };
  };

  const first = await runAt(early);
  const second = await runAt(late);

  assert.deepEqual(seen[0], seen[1]);
  assert.equal(first.deps.enqueued[0].body, second.deps.enqueued[0].body);
  assert.equal(
    first.deps.enqueued[0].dedupeKey,
    second.deps.enqueued[0].dedupeKey
  );
  assert.equal(
    first.deps.enqueued[0].dedupeKey,
    `oversight.activity.digest:${CHURCH}:2026-07-30`
  );
  // 24 hours, whichever hour the job ran at.
  assert.equal(first.deps.enqueued[0].body, "30 meetings, 24 tasks finished.");
});

test("the title names the day the counts belong to, not 'today'", async () => {
  // The digest is composed after its day is over, may be retried tomorrow, and
  // may be backfilled for a day last week. "Today's summary" is wrong in all
  // three, and the reader has no other way to tell which day the counts are.
  const deps = new FakeDigestDeps({ summary: BUSY, recipients: [ADMIN_A] });

  await runOversightDigest(deps, {
    churchId: CHURCH,
    window: previousCompleteDayWindow(new Date("2026-07-31T06:00:00.000Z")),
  });

  assert.equal(
    deps.enqueued[0].title,
    "Grace Chapel — summary for Thu, Jul 30, 2026"
  );
  assert.doesNotMatch(deps.enqueued[0].title, /today/i);
});

test("the day key never follows the runtime's zone", () => {
  // memory/invariants.md → Date & Time Rendering. The key is half the dedupe
  // key, so a machine in another zone deciding it is already tomorrow would
  // enqueue a second digest for the same activity.
  const lateEvening = new Date("2026-07-30T23:59:59.000Z");
  const earlyMorning = new Date("2026-07-30T00:00:00.000Z");

  assert.equal(dayKeyInAppZone(lateEvening), "2026-07-30");
  assert.equal(dayKeyInAppZone(earlyMorning), "2026-07-30");
  assert.equal(
    dayKeyInAppZone(new Date("2026-07-31T00:00:00.000Z")),
    "2026-07-31"
  );
});

// ----------------------------------------------------------------------------
// The schedule: the dispatcher tick's once-a-day guard (ruled 2026-08-01)
// ----------------------------------------------------------------------------
//
// The sweep is what makes the digest DAILY on a job that fires every 15
// minutes. Its guard is derived, not remembered: a plant drops out of the
// selection once a digest row exists for the day. The fake below is that
// database — a set of plants and the (church, day) rows already written.
// ----------------------------------------------------------------------------

const PLANT_A = "44444444-4444-4444-8444-444444444444";
const PLANT_B = "55555555-5555-4555-8555-555555555555";

class FakeSweepDeps implements OversightDigestSweepDeps {
  /** Digest rows already in the database, by dedupe key. */
  readonly written = new Set<string>();
  /** Every (church, dayKey) the sweep asked to digest — including no-ops. */
  readonly attempts: { churchId: string; dayKey: string }[] = [];
  selections = 0;

  constructor(
    readonly plants: string[],
    /** Plants that had activity on the day being digested. */
    readonly active: Set<string>
  ) {}

  async selectPlantsOwedDigest(
    dayKey: string,
    limit: number
  ): Promise<string[]> {
    this.selections += 1;
    return this.plants
      .filter((id) => !this.written.has(digestDedupeKey(id, dayKey)))
      .slice(0, limit);
  }

  async runDigest(
    churchId: string,
    window: ActivityWindow
  ): Promise<OversightDigestOutcome> {
    const dayKey = digestDayKey(window);
    this.attempts.push({ churchId, dayKey });

    if (!this.active.has(churchId)) {
      return { status: "skipped", reason: "no_activity", dayKey };
    }

    this.written.add(digestDedupeKey(churchId, dayKey));
    return {
      status: "enqueued",
      dayKey,
      report: {
        recorded: 2,
        created: 2,
        skipped: 0,
        considered: 2,
        failed: 0,
      },
    };
  }
}

/** Three ticks on the same date, at the hours a 15-minute job really fires. */
const TICKS = [
  new Date("2026-07-31T00:14:00.000Z"),
  new Date("2026-07-31T09:29:00.000Z"),
  new Date("2026-07-31T23:44:00.000Z"),
];

test("a day with activity produces ONE digest however many times the tick fires", async () => {
  const deps = new FakeSweepDeps([PLANT_A], new Set([PLANT_A]));

  const first = await runOversightDigestSweep(deps, { at: TICKS[0] });
  assert.equal(first.selected, 1);
  assert.equal(first.digested, 1);

  // Every later tick that day: the plant is no longer owed, so the sweep
  // selects nothing and calls the digest zero more times.
  for (const at of TICKS.slice(1)) {
    const later = await runOversightDigestSweep(deps, { at });
    assert.equal(
      later.dayKey,
      first.dayKey,
      "the ticks disagreed about the day"
    );
    assert.equal(
      later.selected,
      0,
      "an already-digested plant was re-selected"
    );
    assert.equal(later.digested, 0);
  }

  assert.equal(deps.attempts.length, 1, "the digest ran more than once");
  assert.equal(deps.written.size, 1);
});

test("a quiet day produces no digest, on any tick", async () => {
  const deps = new FakeSweepDeps([PLANT_A], new Set());

  for (const at of TICKS) {
    const summary = await runOversightDigestSweep(deps, { at });
    assert.equal(summary.digested, 0);
    assert.equal(summary.quiet, 1);
  }

  assert.equal(deps.written.size, 0, "a quiet plant was contacted");
});

test("the sweep always digests the day that is OVER", async () => {
  const deps = new FakeSweepDeps([PLANT_A], new Set([PLANT_A]));
  const summary = await runOversightDigestSweep(deps, { at: TICKS[1] });

  // The tick fires on the 31st; the digest speaks for the 30th.
  assert.equal(summary.dayKey, "2026-07-30");
  assert.equal(deps.attempts[0].dayKey, "2026-07-30");
});

test("tomorrow's tick digests tomorrow — the guard is per day, not forever", async () => {
  const deps = new FakeSweepDeps([PLANT_A], new Set([PLANT_A]));

  await runOversightDigestSweep(deps, { at: TICKS[0] });
  const nextDay = await runOversightDigestSweep(deps, {
    at: new Date("2026-08-01T00:14:00.000Z"),
  });

  assert.equal(nextDay.selected, 1);
  assert.equal(nextDay.digested, 1);
  assert.equal(deps.written.size, 2);
});

test("one plant's failure costs that plant only", async () => {
  const deps = new FakeSweepDeps([PLANT_A, PLANT_B], new Set([PLANT_B]));
  const boom = deps.runDigest.bind(deps);
  deps.runDigest = async (churchId, window) => {
    if (churchId === PLANT_A) throw new Error("neon said no");
    return boom(churchId, window);
  };

  const summary = await runOversightDigestSweep(deps, { at: TICKS[0] });

  assert.equal(summary.failed, 1);
  assert.equal(summary.digested, 1);
  // ...and the failed plant is still owed, so the next tick retries it.
  assert.equal(
    (await deps.selectPlantsOwedDigest(summary.dayKey, 25)).length,
    1
  );
});

test("the batch is bounded and the remainder rolls over to the next tick", async () => {
  const plants = Array.from(
    { length: 5 },
    (_, i) => `6666666${i}-6666-4666-8666-666666666666`
  );
  const deps = new FakeSweepDeps(plants, new Set(plants));

  const first = await runOversightDigestSweep(deps, { at: TICKS[0], limit: 2 });
  assert.equal(first.selected, 2);
  assert.equal(first.digested, 2);

  const second = await runOversightDigestSweep(deps, {
    at: TICKS[1],
    limit: 2,
  });
  assert.equal(second.digested, 2);

  const third = await runOversightDigestSweep(deps, { at: TICKS[2], limit: 2 });
  assert.equal(third.digested, 1);
  assert.equal(deps.written.size, 5, "a plant past the cap was dropped");
});

test("a spent budget stops between plants and leaves the rest owed", async () => {
  const plants = [PLANT_A, PLANT_B];
  const deps = new FakeSweepDeps(plants, new Set(plants));

  // Time crosses the budget after the first plant.
  let calls = 0;
  const summary = await runOversightDigestSweep(deps, {
    at: TICKS[0],
    budgetMs: 100,
    elapsedMs: () => (calls++ === 0 ? 0 : 500),
  });

  assert.equal(summary.budgetExhausted, true);
  assert.equal(summary.digested, 1);
  assert.equal(
    (await deps.selectPlantsOwedDigest(summary.dayKey, 25)).length,
    1
  );
});

test("the sweep never throws, so it cannot fail the dispatcher run it rides on", async () => {
  const deps = new FakeSweepDeps([PLANT_A], new Set([PLANT_A]));
  deps.runDigest = async () => {
    throw new Error("everything is on fire");
  };

  const summary = await runOversightDigestSweep(deps, { at: TICKS[0] });
  assert.equal(summary.failed, 1);
});
