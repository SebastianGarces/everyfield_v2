import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { test } from "node:test";

import { FakeNotificationQueue } from "@/lib/testing/notification-queue";

import type { EnqueueNotificationInput } from "./enqueue";
import {
  clampNotificationTitle,
  NOTIFICATION_TITLE_MAX_LENGTH,
} from "./enqueue";
import {
  cancelEntityNotifications,
  runNotificationSync,
  type NotificationSubject,
  type NotificationSyncDeps,
} from "./sync";

// ============================================================================
// The consumer-side sync skeleton, owned once.
//
// §1 is the behaviour every consumer inherits, driven through the real
// `runEnqueue`/`runCancelByEntity` over the in-memory store. §2 is the reason it
// lives here at all: the skeleton shipped as two ~160-line copies (tasks and
// meetings) that a fix would have had to land in twice, and whose two enqueue
// loops already differed — in a log string.
// ============================================================================

const CHURCH = "11111111-1111-4111-8111-111111111111";
const TASK = "22222222-2222-4222-8222-222222222222";
const RECIPIENT = "33333333-3333-4333-8333-333333333333";

const SUBJECT: NotificationSubject = {
  churchId: CHURCH,
  entityType: "task",
  entityId: TASK,
  category: "tasks",
  label: "task",
};

function input(
  overrides: Partial<EnqueueNotificationInput> = {}
): EnqueueNotificationInput {
  return {
    churchId: CHURCH,
    recipientUserId: RECIPIENT,
    category: "tasks",
    type: "task.due",
    title: "Task due: something",
    body: "It is due.",
    entityType: "task",
    entityId: TASK,
    dedupeKey: `task.due:${TASK}`,
    scheduledFor: new Date("2026-09-01T00:00:00.000Z"),
    ...overrides,
  };
}

function harness(): {
  queue: FakeNotificationQueue;
  deps: NotificationSyncDeps;
} {
  const queue = new FakeNotificationQueue();
  return {
    queue,
    deps: {
      enqueue: (row) => queue.enqueue(row),
      cancelByEntity: (row) => queue.cancelByEntity(row),
    },
  };
}

// ----------------------------------------------------------------------------
// §1 — the behaviour every consumer inherits
// ----------------------------------------------------------------------------

test("the plan runs AFTER the cancel, so it can read what the cancel changed", async () => {
  const h = harness();
  await runNotificationSync({
    ...SUBJECT,
    mustCancel: false,
    plan: () => ({ notifications: [input()], skipped: null }),
    deps: h.deps,
  });

  const order: string[] = [];
  const report = await runNotificationSync({
    ...SUBJECT,
    mustCancel: true,
    plan: () => {
      order.push("plan");
      // Proof it is not merely ordered but ordered USEFULLY: the pending row
      // from the first sync is already cancelled by the time this is asked.
      assert.equal(h.queue.pending("task.due").length, 0);
      return { notifications: [input()], skipped: null };
    },
    deps: {
      enqueue: h.deps.enqueue,
      cancelByEntity: (row) => {
        order.push("cancel");
        return h.deps.cancelByEntity(row);
      },
    },
  });

  assert.deepEqual(order, ["cancel", "plan"]);
  assert.equal(report.cancelled, 1);
  assert.equal(report.created, 1, "the cancel released the dedupe key");
});

test("mustCancel: false leaves the live rows alone", async () => {
  const h = harness();
  await runNotificationSync({
    ...SUBJECT,
    mustCancel: false,
    plan: () => ({ notifications: [input()], skipped: null }),
    deps: h.deps,
  });

  const report = await runNotificationSync({
    ...SUBJECT,
    mustCancel: false,
    plan: () => ({ notifications: [input()], skipped: null }),
    deps: h.deps,
  });

  assert.equal(report.cancelled, 0);
  assert.equal(report.recorded, 1);
  assert.equal(report.created, 0, "the repeat was absorbed by the dedupe key");
  assert.equal(h.queue.pending("task.due").length, 1);
});

test("the tally counts recorded, created, skipped and failed separately", async () => {
  const h = harness();
  h.queue.barred.add("44444444-4444-4444-8444-444444444444");

  const report = await runNotificationSync({
    ...SUBJECT,
    mustCancel: false,
    plan: () => ({
      notifications: [
        input(),
        input({
          recipientUserId: "44444444-4444-4444-8444-444444444444",
          dedupeKey: `task.due:${TASK}:barred`,
        }),
      ],
      skipped: null,
    }),
    deps: h.deps,
  });

  assert.equal(report.considered, 2);
  assert.equal(report.recorded, 1);
  assert.equal(report.created, 1);
  assert.equal(report.skipped, 1, "a refused recipient is skipped, not failed");
  assert.equal(report.failed, 0);
});

test("one row's failure does not cost the rest of the plan theirs", async () => {
  const h = harness();
  let calls = 0;

  const report = await runNotificationSync({
    ...SUBJECT,
    mustCancel: false,
    plan: () => ({
      notifications: [
        input({ dedupeKey: `task.due:${TASK}:a` }),
        input({ dedupeKey: `task.due:${TASK}:b` }),
        input({ dedupeKey: `task.due:${TASK}:c` }),
      ],
      skipped: null,
    }),
    deps: {
      cancelByEntity: h.deps.cancelByEntity,
      enqueue: (row) => {
        calls += 1;
        if (calls === 2) throw new Error("provider exploded");
        return h.deps.enqueue(row);
      },
    },
  });

  assert.equal(report.considered, 3);
  assert.equal(report.recorded, 2);
  assert.equal(report.failed, 1);
  assert.equal(h.queue.pending("task.due").length, 2);
});

test("a thrown cancel or plan is swallowed — a notification never fails its write", async () => {
  const h = harness();

  const thrownCancel = await runNotificationSync({
    ...SUBJECT,
    mustCancel: true,
    plan: () => ({ notifications: [input()], skipped: null }),
    deps: {
      enqueue: h.deps.enqueue,
      cancelByEntity: () => {
        throw new Error("database is down");
      },
    },
  });
  assert.deepEqual(thrownCancel, {
    cancelled: 0,
    considered: 0,
    recorded: 0,
    created: 0,
    skipped: 0,
    failed: 0,
    reason: null,
  });

  const thrownPlan = await runNotificationSync({
    ...SUBJECT,
    mustCancel: false,
    plan: () => {
      throw new Error("the facts read failed");
    },
    deps: h.deps,
  });
  assert.equal(thrownPlan.considered, 0);
});

test("a required reconciler fails closed when its cancel or plan fails", async () => {
  const h = harness();

  await assert.rejects(
    runNotificationSync({
      ...SUBJECT,
      mustCancel: true,
      plan: () => ({ notifications: [input()], skipped: null }),
      deps: {
        enqueue: h.deps.enqueue,
        cancelByEntity: () => {
          throw new Error("database is down");
        },
      },
      failureMode: "required",
    }),
    /required task notification write/
  );

  await assert.rejects(
    runNotificationSync({
      ...SUBJECT,
      mustCancel: false,
      plan: () => {
        throw new Error("the facts read failed");
      },
      deps: h.deps,
      failureMode: "required",
    }),
    /required task notification write/
  );
});

test("a planner's refusal is reported as its own reason", async () => {
  const h = harness();
  const report = await runNotificationSync<"no_due_date">({
    ...SUBJECT,
    mustCancel: false,
    plan: () => ({ notifications: [], skipped: "no_due_date" }),
    deps: h.deps,
  });

  assert.equal(report.reason, "no_due_date");
  assert.equal(report.considered, 0);
});

test("cancelEntityNotifications resolves to zero rather than throwing", async () => {
  const h = harness();
  assert.equal(await cancelEntityNotifications(SUBJECT, h.deps), 0);

  await runNotificationSync({
    ...SUBJECT,
    mustCancel: false,
    plan: () => ({ notifications: [input()], skipped: null }),
    deps: h.deps,
  });
  assert.equal(await cancelEntityNotifications(SUBJECT, h.deps), 1);

  assert.equal(
    await cancelEntityNotifications(SUBJECT, {
      enqueue: h.deps.enqueue,
      cancelByEntity: () => {
        throw new Error("database is down");
      },
    }),
    0
  );
});

test("clampNotificationTitle fits the column, ellipsis included", () => {
  assert.equal(clampNotificationTitle("short"), "short");

  const exact = "x".repeat(NOTIFICATION_TITLE_MAX_LENGTH);
  assert.equal(clampNotificationTitle(exact), exact);

  const clamped = clampNotificationTitle("x".repeat(400));
  assert.equal(clamped.length, NOTIFICATION_TITLE_MAX_LENGTH);
  assert.ok(clamped.endsWith("…"));
});

// ----------------------------------------------------------------------------
// §2 — one owner, so a fix lands once
// ----------------------------------------------------------------------------

const ROOT = path.join(process.cwd(), "src");

/** Every shipped `.ts`/`.tsx` under `src/`. Suites are skipped. */
function sourceFiles(dir: string = ROOT): string[] {
  const found: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      found.push(...sourceFiles(full));
    } else if (
      /\.tsx?$/.test(entry.name) &&
      !/\.test\.tsx?$/.test(entry.name)
    ) {
      found.push(full);
    }
  }
  return found;
}

function modulesMatching(pattern: RegExp): string[] {
  return sourceFiles()
    .filter((file) => pattern.test(readFileSync(file, "utf8")))
    .map((file) => path.relative(ROOT, file));
}

/**
 * The two OLDER emitters that still carry a tally loop of their own, named.
 *
 * They are FAN-OUTS, not syncs: `announceOversightMilestone` and
 * `announceRemovedFromOversightOrg` loop over RECIPIENTS and never cancel, so
 * their report has no `cancelled` and no `reason` and `runNotificationSync`'s
 * signature does not fit them without being widened. They predate this
 * skeleton, they were not what #321 duplicated, and folding them in is a change
 * to shipped behaviour that belongs in its own pass.
 *
 * ACCEPTED RESIDUAL, and the list is what keeps it one: it is asserted to be
 * EXACTLY these two, so a THIRD tally loop — including any new feature
 * consumer — fails this suite. Retired by a pass that gives the fan-outs a
 * shared loop too.
 */
const LEGACY_FAN_OUT_TALLIES = [
  "lib/notifications/oversight.ts",
  "lib/notifications/plant-association.ts",
];

test("the sync skeleton's enqueue tally loop exists exactly once", () => {
  // The loop is the whole skeleton in miniature: recorded / created / skipped /
  // failed, a per-item try/catch, and a log. Two copies is a fix that has to
  // land twice and a reader who has to verify it twice — and the two copies
  // #321 shipped already differed, in a log string.
  assert.deepEqual(
    modulesMatching(/report\.recorded\s*\+=\s*1/),
    [...LEGACY_FAN_OUT_TALLIES, "lib/notifications/sync.ts"].sort(),
    "a consumer wrote its own enqueue tally instead of calling `runNotificationSync`"
  );
});

test("exactly one title clamp exists in src/", () => {
  // The 255 is `enqueueNotificationSchema`'s, not a feature's. Two byte-for-byte
  // identical private `clampTitle` helpers shipped in one PR before this.
  assert.deepEqual(
    modulesMatching(/function clamp(Title|NotificationTitle)\s*\(/),
    ["lib/notifications/enqueue.ts"],
    "a feature declared its own title clamp again"
  );
});

test("exactly one SYNC report shape exists in src/", () => {
  // Consumers alias `NotificationSyncReport<TheirReason>`; they do not respell
  // the counters. `cancelled` is what makes a report a SYNC report — the two
  // legacy fan-outs above have no cancel half and so do not match.
  const owners = sourceFiles()
    .filter((file) => {
      const source = readFileSync(file, "utf8");
      return (
        /^\s*cancelled:\s*number;/m.test(source) &&
        /^\s*considered:\s*number;/m.test(source)
      );
    })
    .map((file) => path.relative(ROOT, file));

  assert.deepEqual(
    owners,
    ["lib/notifications/sync.ts"],
    "a consumer redeclared the sync report shape instead of aliasing `NotificationSyncReport`"
  );
});
