// The dispatch runs below render a real email, and rendering mints a real
// unsubscribe token — so this suite provisions its own deterministic secret
// rather than inheriting whatever the machine happens to have (the reasoning is
// spelled out at the top of `src/lib/notifications/dispatch.test.ts`). Safe at
// module scope despite import hoisting: `unsubscribeTokenSecret()` reads
// `process.env` at CALL time, never at import time.
process.env.UNSUBSCRIBE_TOKEN_SECRET = "test-unsubscribe-secret-0123456789";

import assert from "node:assert/strict";
import { test } from "node:test";

import { MS_PER_DAY } from "@/lib/datetime";
import {
  clearStillLivePredicates,
  runDispatch,
  stillLivePredicateFor,
} from "@/lib/notifications/dispatch";
import { FakeNotificationQueue } from "@/lib/testing/notification-queue";

import { guestListUserIdsQuery } from "./guest-list";
import {
  CORE_GROUP_STATUSES,
  MEETING_NOTIFICATION_TYPES,
  MEETING_REMINDER_OFFSET_DAYS,
  MEETING_SCHEDULED_TYPE,
  cancelMeetingNotifications,
  coreGroupUserIdsQuery,
  meetingReminderType,
  registerMeetingStillLivePredicates,
  syncMeetingNotifications,
  type MeetingNotificationDeps,
  type MeetingNotificationFacts,
} from "./notifications";

// ============================================================================
// VM-018 — meeting reminders and the Core Group announcement, on the shared F11
// queue.
//
// Every assertion is made on the ROWS, through the real `runEnqueue` /
// `runCancelByEntity` / `runDispatch` orchestration over the in-memory store in
// `src/lib/testing/notification-queue.ts`. What is faked is Postgres and the
// email provider; the contract under test is the one this module keeps.
// ============================================================================

const CHURCH = "11111111-1111-4111-8111-111111111111";
const ORGANISER = "22222222-2222-4222-8222-222222222222";
const CORE_ONE = "33333333-3333-4333-8333-333333333333";
const CORE_TWO = "44444444-4444-4444-8444-444444444444";
const GUEST = "55555555-5555-4555-8555-555555555555";
const MEETING = "66666666-6666-4666-8666-666666666666";

const NOW = new Date("2026-08-14T09:00:00.000Z");
/** Comfortably more than seven days out, so all three offsets are live. */
const START = new Date("2026-09-01T19:00:00.000Z");

function facts(
  overrides: Partial<MeetingNotificationFacts> = {}
): MeetingNotificationFacts {
  return {
    id: MEETING,
    churchId: CHURCH,
    type: "vision_meeting",
    title: "Vision Meeting #2",
    meetingNumber: 2,
    teamName: null,
    datetime: START,
    status: "planning",
    createdBy: ORGANISER,
    ...overrides,
  };
}

/**
 * The store, plus the meeting row and the audience reads.
 *
 * `enqueueCalls` is counted rather than inferred from the rows: "one enqueue
 * per recipient per offset" and "one row per recipient per offset" are
 * different claims, and a caller that pre-batched would fail the first while
 * passing the second.
 */
function harness(audience: { coreGroup?: string[]; guests?: string[] } = {}) {
  const queue = new FakeNotificationQueue();
  const meetings = new Map<string, MeetingNotificationFacts>();
  let enqueueCalls = 0;

  const deps: MeetingNotificationDeps = {
    enqueue: (input) => {
      enqueueCalls += 1;
      return queue.enqueue(input);
    },
    cancelByEntity: (input) => queue.cancelByEntity(input),
    async loadMeeting(churchId, meetingId) {
      const row = meetings.get(meetingId);
      return row && row.churchId === churchId ? row : null;
    },
    async listCoreGroup() {
      return audience.coreGroup ?? [CORE_ONE];
    },
    async listGuests() {
      return audience.guests ?? [];
    },
  };

  return {
    queue,
    meetings,
    deps,
    calls: () => enqueueCalls,
    /** Put a meeting in the store and enqueue what it owes. */
    async write(
      row: MeetingNotificationFacts,
      options: { previous?: MeetingNotificationFacts | null; now?: Date } = {}
    ) {
      const previous =
        "previous" in options
          ? options.previous
          : (meetings.get(row.id) ?? null);
      meetings.set(row.id, row);
      return syncMeetingNotifications(row.churchId, row.id, {
        deps,
        now: options.now ?? NOW,
        previous,
      });
    },
  };
}

/** The reminder rows, oldest offset first. */
function reminders(queue: FakeNotificationQueue) {
  return MEETING_REMINDER_OFFSET_DAYS.map((days) => ({
    days,
    rows: queue.pending(meetingReminderType(days)),
  }));
}

// ----------------------------------------------------------------------------
// AC: a scheduled meeting enqueues reminders at 7, 3 and 1 days before its start
// ----------------------------------------------------------------------------

test("a scheduled meeting enqueues reminders at 7, 3 and 1 days before its start", async () => {
  const h = harness();
  await h.write(facts(), { previous: null });

  for (const { days, rows } of reminders(h.queue)) {
    assert.equal(rows.length, 1, `expected one reminder at ${days} days`);
    assert.equal(rows[0].category, "meetings");
    assert.equal(rows[0].entityType, "meeting");
    assert.equal(rows[0].entityId, MEETING);
    assert.equal(
      rows[0].scheduledFor.getTime(),
      START.getTime() - days * MS_PER_DAY,
      `the ${days}-day reminder is not ${days} days before the start`
    );
  }
});

test("one row per recipient per offset — reminders are never pre-batched", async () => {
  // The reminder audience is the guest list PLUS whoever scheduled it.
  const h = harness({ guests: [GUEST] });
  await h.write(facts(), { previous: null });

  const rows = MEETING_REMINDER_OFFSET_DAYS.flatMap((days) =>
    h.queue.pending(meetingReminderType(days))
  );

  assert.equal(rows.length, 6, "two recipients × three offsets");
  assert.equal(h.calls(), 6 + 1, "six reminders and one announcement");
  assert.deepEqual(
    [...new Set(rows.map((row) => row.recipientUserId))].sort(),
    [ORGANISER, GUEST].sort()
  );
});

// ----------------------------------------------------------------------------
// AC: creating a meeting announces it to the Core Group
// ----------------------------------------------------------------------------

test("creating a meeting enqueues a Core Group notification to the resolved recipients", async () => {
  const h = harness({ coreGroup: [CORE_ONE, CORE_TWO] });
  await h.write(facts(), { previous: null });

  const announced = h.queue.pending(MEETING_SCHEDULED_TYPE);

  assert.deepEqual(
    announced.map((row) => row.recipientUserId).sort(),
    [CORE_ONE, CORE_TWO].sort(),
    "the recipient set is exactly the church's Core Group"
  );
  for (const row of announced) {
    assert.equal(row.category, "meetings");
    assert.equal(row.entityId, MEETING);
    // Due now: the decision has already been made.
    assert.equal(row.scheduledFor.getTime(), NOW.getTime());
  }
});

test("the Core Group is the three statuses at or past the commitment", () => {
  // Named here so a change to the ladder has to be a deliberate one: a person
  // who committed and then joined the launch team has not left the core group.
  assert.deepEqual(
    [...CORE_GROUP_STATUSES],
    ["core_group", "launch_team", "leader"]
  );
});

// ----------------------------------------------------------------------------
// AC: only the offsets still in the future
// ----------------------------------------------------------------------------

test("a meeting fewer than seven days out enqueues only the offsets still ahead", async () => {
  const h = harness();
  // Four days out: the 7-day offset is already in the past.
  const soon = new Date(NOW.getTime() + 4 * MS_PER_DAY);
  await h.write(facts({ datetime: soon }), { previous: null });

  assert.equal(h.queue.pending(meetingReminderType(7)).length, 0);
  assert.equal(h.queue.pending(meetingReminderType(3)).length, 1);
  assert.equal(h.queue.pending(meetingReminderType(1)).length, 1);

  for (const row of h.queue.pending()) {
    assert.ok(
      row.scheduledFor.getTime() >= NOW.getTime() ||
        row.type === MEETING_SCHEDULED_TYPE,
      "no reminder may be created at a past-dated offset"
    );
  }
});

test("a meeting in the past enqueues nothing at all", async () => {
  const h = harness();
  const report = await h.write(
    facts({ datetime: new Date(NOW.getTime() - MS_PER_DAY) }),
    { previous: null }
  );

  assert.equal(h.queue.rows.length, 0);
  assert.equal(report.reason, "in_the_past");
});

test("a cancelled meeting enqueues nothing", async () => {
  const h = harness();
  const report = await h.write(facts({ status: "cancelled" }), {
    previous: null,
  });

  assert.equal(h.queue.rows.length, 0);
  assert.equal(report.reason, "not_scheduled");
});

// ----------------------------------------------------------------------------
// AC: cancelling cancels the pending reminders by entity reference
// ----------------------------------------------------------------------------

test("cancelling a meeting cancels its reminders, and dispatch then sends nothing", async () => {
  const h = harness();
  // Two days out, so the 1-day reminder is already due at DISPATCH time below.
  const soon = new Date(NOW.getTime() + 2 * MS_PER_DAY);
  await h.write(facts({ datetime: soon }), { previous: null });
  h.queue.addRecipient(ORGANISER);
  h.queue.addRecipient(CORE_ONE);
  assert.ok(h.queue.pending().length > 0);

  // What `updateMeetingStatus(..., "cancelled")` does.
  const previous = h.meetings.get(MEETING)!;
  await h.write({ ...previous, status: "cancelled" }, { previous });

  assert.equal(h.queue.pending().length, 0, "nothing is left pending");

  const later = new Date(soon.getTime() - 0.5 * MS_PER_DAY);
  const summary = await runDispatch(h.queue, { now: later });

  assert.equal(summary.claimed, 0, "a cancelled row is never claimed");
  assert.equal(h.queue.sends.length, 0, "nothing was sent");
});

test("cancelByEntity reaches every recipient's row at once", async () => {
  const h = harness({ coreGroup: [CORE_ONE, CORE_TWO], guests: [GUEST] });
  await h.write(facts(), { previous: null });
  assert.equal(h.queue.pending().length, 8, "2 announced + 2 × 3 reminders");

  const cancelled = await cancelMeetingNotifications(CHURCH, MEETING, h.deps);

  assert.equal(cancelled, 8);
  assert.equal(h.queue.pending().length, 0);
});

// ----------------------------------------------------------------------------
// AC: rescheduling cancels and re-enqueues, leaving no stale offset
// ----------------------------------------------------------------------------

test("rescheduling leaves no pending row at a stale offset", async () => {
  const h = harness();
  await h.write(facts(), { previous: null });

  const oldOffsets = new Set(
    h.queue.pending().map((row) => row.scheduledFor.getTime())
  );

  const moved = new Date("2026-09-20T19:00:00.000Z");
  const previous = h.meetings.get(MEETING)!;
  await h.write({ ...previous, datetime: moved }, { previous });

  const pending = h.queue.pending();
  const reminderRows = pending.filter(
    (row) => row.type !== MEETING_SCHEDULED_TYPE
  );

  assert.equal(reminderRows.length, 3, "three offsets, against the new start");
  for (const { days, rows } of reminders(h.queue)) {
    assert.equal(
      rows[0].scheduledFor.getTime(),
      moved.getTime() - days * MS_PER_DAY
    );
  }

  for (const row of reminderRows) {
    assert.ok(
      !oldOffsets.has(row.scheduledFor.getTime()),
      "a reminder is still aimed at the old schedule"
    );
    assert.ok(
      row.dedupeKey?.includes(moved.toISOString()),
      "the dedupe key still carries the old start instant"
    );
  }

  // ...and the old rows are cancelled, not merely superseded.
  assert.equal(h.queue.byStatus("cancelled").length, 4);
});

test("a save that moves nothing a reminder says leaves the live rows alone", async () => {
  const h = harness();
  await h.write(facts(), { previous: null });
  const ids = h.queue.pending().map((row) => row.id);

  const previous = h.meetings.get(MEETING)!;
  const report = await h.write({ ...previous }, { previous });

  assert.equal(report.cancelled, 0);
  assert.equal(report.created, 0, "every row was absorbed by its dedupe key");
  assert.deepEqual(
    h.queue.pending().map((row) => row.id),
    ids,
    "the same rows, with the same ids"
  );
});

// ----------------------------------------------------------------------------
// AC: a still-live predicate is registered for the meeting types
// ----------------------------------------------------------------------------

test("every meeting type has a still-live predicate registered", () => {
  // Registration is a module-load side effect; importing this module armed it.
  assert.equal(MEETING_NOTIFICATION_TYPES.length, 4);
  for (const type of MEETING_NOTIFICATION_TYPES) {
    assert.ok(
      stillLivePredicateFor(type),
      `no still-live predicate is registered for ${type}`
    );
  }
});

test("a meeting cancelled after enqueue is not announced — dispatch cancels it", async (t) => {
  const h = harness();
  const soon = new Date(NOW.getTime() + 2 * MS_PER_DAY);
  await h.write(facts({ datetime: soon }), { previous: null });
  h.queue.addRecipient(ORGANISER);
  h.queue.addRecipient(CORE_ONE);

  registerMeetingStillLivePredicates(h.deps);
  t.after(() => clearStillLivePredicates());

  // Cancelled WITHOUT the cancel-by-entity — the path the predicate exists to
  // cover: a row a dispatch run has already claimed cannot be reached by it.
  h.meetings.set(MEETING, { ...h.meetings.get(MEETING)!, status: "cancelled" });

  const summary = await runDispatch(h.queue, {
    now: new Date(soon.getTime() - 0.5 * MS_PER_DAY),
  });

  assert.ok(summary.claimed > 0, "the rows were due and were claimed");
  assert.equal(summary.cancelled, summary.claimed, "and all were resolved");
  assert.equal(summary.delivered, 0);
  assert.equal(h.queue.sends.length, 0, "nothing was emailed");
  assert.equal(
    h.queue.deliveryFor(h.queue.rows[0].id, "email")?.status,
    "cancelled",
    "and the delivery log says why it never arrived (N-016)"
  );
});

test("a live meeting IS announced — the predicate is not a blanket refusal", async (t) => {
  const h = harness();
  const soon = new Date(NOW.getTime() + 2 * MS_PER_DAY);
  await h.write(facts({ datetime: soon }), { previous: null });
  h.queue.addRecipient(ORGANISER);
  h.queue.addRecipient(CORE_ONE);

  registerMeetingStillLivePredicates(h.deps);
  t.after(() => clearStillLivePredicates());

  const summary = await runDispatch(h.queue, {
    now: new Date(soon.getTime() - 0.5 * MS_PER_DAY),
  });

  assert.ok(summary.delivered > 0);
  assert.ok(h.queue.sends.length > 0);
});

// ----------------------------------------------------------------------------
// AC: a recipient who turned the `meetings` category off is SUPPRESSED, not
// skipped
// ----------------------------------------------------------------------------

test("a recipient who disabled the meetings category is recorded as suppressed", async () => {
  const h = harness({ coreGroup: [] });
  const soon = new Date(NOW.getTime() + 2 * MS_PER_DAY);
  await h.write(facts({ datetime: soon }), { previous: null });
  h.queue.addRecipient(ORGANISER);

  // The opt-out is a DISPATCH-time decision, so the row is written either way.
  h.queue.setPreference(ORGANISER, "meetings", "email", false);
  h.queue.setPreference(ORGANISER, "meetings", "in_app", false);

  const due = h.queue.pending(meetingReminderType(1));
  assert.equal(due.length, 1, "the row exists — enqueue skipped nobody");

  const summary = await runDispatch(h.queue, {
    now: new Date(soon.getTime() - 0.5 * MS_PER_DAY),
  });

  assert.equal(h.queue.sends.length, 0, "no email was sent");
  assert.equal(summary.suppressed, 2, "both channels recorded the opt-out");
  assert.equal(
    h.queue.deliveryFor(due[0].id, "email")?.status,
    "suppressed_by_preference"
  );
  assert.equal(
    h.queue.deliveryFor(due[0].id, "in_app")?.status,
    "suppressed_by_preference"
  );
});

// ----------------------------------------------------------------------------
// The two audience reads are church-scoped on BOTH sides of the person↔user
// bridge (`memory/invariants.md` → Multi-Tenancy)
// ----------------------------------------------------------------------------

test("the Core Group read scopes both persons and users to the church", () => {
  const { sql, params } = coreGroupUserIdsQuery(CHURCH).toSQL();

  assert.match(sql, /"users"\."church_id" = \$\d/);
  assert.match(sql, /"persons"\."church_id" = \$\d/);
  assert.match(sql, /lower\("users"\."email"\) = lower\("persons"\."email"\)/);
  assert.match(sql, /"persons"\."deleted_at" is null/);
  assert.equal(
    params.filter((value) => value === CHURCH).length,
    2,
    "both sides of the bridge carry the church id"
  );
  for (const status of CORE_GROUP_STATUSES) {
    assert.ok(params.includes(status), `${status} is not in the read`);
  }
});

test("the guest-list read scopes attendance, persons and users to the church", () => {
  const { sql, params } = guestListUserIdsQuery(CHURCH, MEETING).toSQL();

  assert.match(sql, /"meeting_attendance"\."church_id" = \$\d/);
  assert.match(sql, /"persons"\."church_id" = \$\d/);
  assert.match(sql, /"users"\."church_id" = \$\d/);
  assert.equal(
    params.filter((value) => value === CHURCH).length,
    3,
    "every table in the join carries the church id"
  );
  assert.ok(params.includes(MEETING));
});
