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
  type OwedDigestPageQuery,
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
// selection once a digest row exists for the day.
//
// The fake below is the SELECTION QUERY's contract, not a convenience: it
// offers a plant only while it is sharing, has an oversight admin, had
// activity, and has no digest row for the day — and it honours the keyset
// anchor. Those are exactly the clauses `selectPlantsOwedDigest` carries, and
// modelling them is what lets these tests prove the starvation fix rather than
// assume it. The previous fake modelled only "has no digest row yet", which is
// why a permanently-owed head-of-list was invisible to the suite.
// ----------------------------------------------------------------------------

const PLANT_A = "44444444-4444-4444-8444-444444444444";
const PLANT_B = "55555555-5555-4555-8555-555555555555";

class FakeSweepDeps implements OversightDigestSweepDeps {
  /** Digest rows already in the database, by dedupe key. */
  readonly written = new Set<string>();
  /** Every (church, dayKey) the sweep asked to digest — including no-ops. */
  readonly attempts: { churchId: string; dayKey: string }[] = [];
  /** Every page the sweep asked for, so paging itself is assertable. */
  readonly pageQueries: OwedDigestPageQuery[] = [];
  selections = 0;
  /** Plants whose digest should throw. */
  readonly failing = new Set<string>();

  constructor(
    /** Every plant in the fleet, in id order. */
    readonly plants: string[],
    /** Plants that had activity on the day being digested. */
    readonly active: Set<string>,
    options: {
      /** Plants with the sharing toggle ON. Defaults to all of `plants`. */
      sharing?: Set<string>;
      /** Plants whose oversight org has at least one admin. Defaults to all. */
      withAdmins?: Set<string>;
    } = {}
  ) {
    this.sharing = options.sharing ?? new Set(plants);
    this.withAdmins = options.withAdmins ?? new Set(plants);
  }

  readonly sharing: Set<string>;
  readonly withAdmins: Set<string>;

  async selectPlantsOwedDigest(query: OwedDigestPageQuery): Promise<string[]> {
    this.selections += 1;
    this.pageQueries.push(query);
    return this.plants
      .filter((id) => query.afterChurchId === null || id > query.afterChurchId)
      .filter((id) => this.sharing.has(id))
      .filter((id) => this.withAdmins.has(id))
      .filter((id) => this.active.has(id))
      .filter((id) => !this.written.has(digestDedupeKey(id, query.dayKey)))
      .slice(0, query.limit);
  }

  async runDigest(
    churchId: string,
    window: ActivityWindow
  ): Promise<OversightDigestOutcome> {
    const dayKey = digestDayKey(window);
    this.attempts.push({ churchId, dayKey });

    if (this.failing.has(churchId)) throw new Error("neon said no");

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

  /** How many plants are still owed — the "did anyone get starved" question. */
  owed(dayKey: string): Promise<string[]> {
    return this.selectPlantsOwedDigest({
      dayKey,
      window: previousCompleteDayWindow(TICKS[0]),
      limit: 1000,
      afterChurchId: null,
    });
  }
}

/** Three ticks on the same date, at the hours a 15-minute job really fires. */
const TICKS = [
  new Date("2026-07-31T00:14:00.000Z"),
  new Date("2026-07-31T09:29:00.000Z"),
  new Date("2026-07-31T23:44:00.000Z"),
];

/** `n` plants in ascending id order — the order the sweep walks. */
function fleet(n: number): string[] {
  return Array.from(
    { length: n },
    (_, i) => `6666666${i}-6666-4666-8666-666666666666`
  );
}

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

test("a quiet day produces no digest, on any tick — and costs no scan", async () => {
  const deps = new FakeSweepDeps([PLANT_A], new Set());

  for (const at of TICKS) {
    const summary = await runOversightDigestSweep(deps, { at });
    assert.equal(summary.digested, 0);
    // The plant is not even OFFERED now: a quiet day is decided in SQL, from
    // the same conditions the counts use, so the sweep does not summarise it 96
    // times to discover the same zero.
    assert.equal(summary.selected, 0);
    assert.equal(summary.plantsScanned, 0);
  }

  assert.equal(deps.attempts.length, 0, "a quiet plant was summarised");
  assert.equal(deps.written.size, 0, "a quiet plant was contacted");
});

test("the sweep always digests the day that is OVER", async () => {
  const deps = new FakeSweepDeps([PLANT_A], new Set([PLANT_A]));
  const summary = await runOversightDigestSweep(deps, { at: TICKS[1] });

  // The tick fires on the 31st; the digest speaks for the 30th.
  assert.equal(summary.dayKey, "2026-07-30");
  assert.equal(deps.attempts[0].dayKey, "2026-07-30");
  // ...and the window handed to the selection is the same one.
  assert.equal(
    deps.pageQueries[0].window.from.toISOString(),
    "2026-07-30T00:00:00.000Z"
  );
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

// ----------------------------------------------------------------------------
// Starvation — the regression this fix exists for
// ----------------------------------------------------------------------------

test("an eligible plant BEYOND the batch is digested on a day full of ineligible ones", async () => {
  // The exact shape that used to starve: plants that can never write a digest
  // row occupy the head of the stable id ordering all day. Under the old sweep
  // the batch was the SELECTION window, so plant #N+1 was never reached on any
  // of the day's 96 ticks. Here the first three are ineligible for the three
  // different reasons that produce a permanently-owed plant, and the batch is
  // smaller than the fleet.
  const [quiet, notSharing, noAdmins, eligible] = fleet(4);

  const deps = new FakeSweepDeps(
    [quiet, notSharing, noAdmins, eligible],
    // `quiet` has no activity; the other three do.
    new Set([notSharing, noAdmins, eligible]),
    {
      sharing: new Set([quiet, noAdmins, eligible]),
      withAdmins: new Set([quiet, notSharing, eligible]),
    }
  );

  const summary = await runOversightDigestSweep(deps, {
    at: TICKS[0],
    limit: 2,
  });

  assert.equal(summary.digested, 1, "the eligible plant was never reached");
  assert.deepEqual(
    deps.attempts.map((a) => a.churchId),
    [eligible],
    "an ineligible plant was summarised anyway"
  );
  assert.ok(deps.written.has(digestDedupeKey(eligible, summary.dayKey)));

  // Same day, second tick: nothing further. Idempotence survives the fix.
  const second = await runOversightDigestSweep(deps, {
    at: TICKS[1],
    limit: 2,
  });
  assert.equal(second.selected, 0);
  assert.equal(second.digested, 0);
  assert.equal(deps.written.size, 1);
});

test("a fleet larger than the batch is swept WITHIN one tick, by keyset", async () => {
  // The batch bounds the WORK, not the window. Five eligible plants, pages of
  // two: one tick digests all five and the anchor advances across pages.
  const plants = fleet(5);
  const deps = new FakeSweepDeps(plants, new Set(plants));

  const summary = await runOversightDigestSweep(deps, {
    at: TICKS[0],
    limit: 2,
  });

  assert.equal(summary.digested, 5);
  assert.equal(summary.plantsScanned, 5);
  assert.equal(deps.written.size, 5, "a plant past the batch was dropped");
  // 2 + 2 + 1 — the short page ends the walk.
  assert.equal(summary.pages, 3);
  assert.deepEqual(
    deps.pageQueries.map((q) => q.afterChurchId),
    [null, plants[1], plants[3]]
  );
});

test("a plant whose digest THROWS does not block the plants behind it", async () => {
  // The one remaining way a plant stays owed after the selection narrowing. The
  // keyset anchor advances past a failure, so within the same tick the rest of
  // the fleet is still reached.
  const plants = fleet(3);
  const deps = new FakeSweepDeps(plants, new Set(plants));
  deps.failing.add(plants[0]);

  const summary = await runOversightDigestSweep(deps, {
    at: TICKS[0],
    limit: 1,
  });

  assert.equal(summary.failed, 1);
  assert.equal(summary.digested, 2, "a failure blocked the plants behind it");
  assert.equal(summary.plantsScanned, 3);

  // ...and the failed plant is still owed, so the next tick retries it.
  assert.deepEqual(await deps.owed(summary.dayKey), [plants[0]]);
});

test("96 ticks on a starving fleet still serve every eligible plant exactly once", async () => {
  // The finding was reproduced as "96 ticks, 192 attempts, nothing written".
  // The same shape, asserted the other way round.
  const plants = fleet(6);
  const quietOnes = new Set(plants.slice(0, 4));
  const eligible = plants.slice(4);
  const deps = new FakeSweepDeps(plants, new Set(eligible));

  let attemptsAfterFirstTick = 0;
  for (let tick = 0; tick < 96; tick += 1) {
    await runOversightDigestSweep(deps, {
      at: new Date(Date.UTC(2026, 6, 31, 0, 15 * tick)),
      limit: 2,
    });
    if (tick === 0) attemptsAfterFirstTick = deps.attempts.length;
  }

  assert.equal(deps.written.size, eligible.length);
  for (const id of eligible) {
    assert.equal(
      deps.attempts.filter((a) => a.churchId === id).length,
      1,
      "an eligible plant was digested more than once in a day"
    );
  }
  for (const id of quietOnes) {
    assert.equal(
      deps.attempts.filter((a) => a.churchId === id).length,
      0,
      "a quiet plant was summarised anyway"
    );
  }
  assert.equal(
    deps.attempts.length,
    attemptsAfterFirstTick,
    "later ticks did work the first tick had already done"
  );
});

// ----------------------------------------------------------------------------
// Budgets, failures, and the promise never to throw
// ----------------------------------------------------------------------------

test("a spent budget stops between plants and leaves the rest owed", async () => {
  const plants = [PLANT_A, PLANT_B];
  const deps = new FakeSweepDeps(plants, new Set(plants));

  // Time crosses the budget as soon as one plant has been digested — expressed
  // against the work done rather than a call count, so it stays true if the
  // sweep's internal clock checks are ever rearranged.
  const summary = await runOversightDigestSweep(deps, {
    at: TICKS[0],
    budgetMs: 100,
    elapsedMs: () => (deps.attempts.length >= 1 ? 500 : 0),
  });

  assert.equal(summary.budgetExhausted, true);
  assert.equal(summary.digested, 1);
  assert.equal((await deps.owed(summary.dayKey)).length, 1);
});

test("the plant ceiling stops a pathological tick and is visible in the summary", async () => {
  const plants = fleet(6);
  const deps = new FakeSweepDeps(plants, new Set(plants));

  const summary = await runOversightDigestSweep(deps, {
    at: TICKS[0],
    limit: 2,
    maxPlants: 3,
  });

  assert.equal(summary.plantsScanned, 3);
  assert.equal(summary.budgetExhausted, true);
  // `selected` vs `plantsScanned` is the signal the old summary could not give.
  assert.ok(summary.selected >= summary.plantsScanned);
  assert.equal((await deps.owed(summary.dayKey)).length, 3);
});

test("activity that vanishes between the scan and the digest is counted as quiet", async () => {
  // Normally zero, because the selection already excluded quiet plants. It is
  // reachable when a person or task is soft-deleted in between — legitimate,
  // and it must not read as a failure.
  const deps = new FakeSweepDeps([PLANT_A], new Set([PLANT_A]));
  deps.active.delete(PLANT_A);
  // The selection saw activity; by the time the digest ran, it was gone.
  let offered = false;
  deps.selectPlantsOwedDigest = async () => {
    if (offered) return [];
    offered = true;
    return [PLANT_A];
  };

  const summary = await runOversightDigestSweep(deps, { at: TICKS[0] });

  assert.equal(summary.quiet, 1);
  assert.equal(summary.failed, 0);
  assert.equal(deps.written.size, 0);
});

test("the sweep never throws, so it cannot fail the dispatcher run it rides on", async () => {
  const deps = new FakeSweepDeps([PLANT_A], new Set([PLANT_A]));
  deps.runDigest = async () => {
    throw new Error("everything is on fire");
  };

  const summary = await runOversightDigestSweep(deps, { at: TICKS[0] });
  assert.equal(summary.failed, 1);
});

test("a selection query that throws is not the dispatcher's problem either", async () => {
  // The sweep rides on a run that has already SENT email. A blip in its own
  // SELECT must be a field in the summary, never an exception that reports a
  // successful delivery run as a 500.
  const deps = new FakeSweepDeps([PLANT_A], new Set([PLANT_A]));
  deps.selectPlantsOwedDigest = async () => {
    throw new Error("the database went away");
  };

  const summary = await runOversightDigestSweep(deps, { at: TICKS[0] });
  assert.equal(summary.failed, 1);
  assert.equal(summary.digested, 0);
});
