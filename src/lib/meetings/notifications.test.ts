// The dispatch runs below render a real email, and rendering mints a real
// unsubscribe token — so this suite provisions its own deterministic secret
// rather than inheriting whatever the machine happens to have (the reasoning is
// spelled out at the top of `src/lib/notifications/dispatch.test.ts`). Safe at
// module scope despite import hoisting: `unsubscribeTokenSecret()` reads
// `process.env` at CALL time, never at import time.
process.env.UNSUBSCRIBE_TOKEN_SECRET = "test-unsubscribe-secret-0123456789";

import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { test } from "node:test";

import { MS_PER_DAY } from "@/lib/datetime";
import { stripComments } from "@/lib/testing/source-span";
import {
  clearStillLivePredicates,
  runDispatch,
  stillLivePredicateFor,
} from "@/lib/notifications/dispatch";
import { FakeNotificationQueue } from "@/lib/testing/notification-queue";

import {
  CORE_GROUP_STATUSES,
  MEETING_NOTIFICATION_TYPES,
  MEETING_REMINDER_OFFSET_DAYS,
  MEETING_SCHEDULED_TYPE,
  cancelMeetingNotifications,
  coreGroupUserIdsQuery,
  guestListUserIdsQuery,
  meetingNotificationFactsQuery,
  meetingNotificationsDiffer,
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
    /**
     * Put a meeting in the store and enqueue what it owes.
     *
     * `previous` is the harness's own convenience, NOT the sync's parameter:
     * `syncMeetingNotifications` takes one honest `mustCancel` boolean, and the
     * differ that answers it belongs to the caller (`updateMeeting` /
     * `updateMeetingStatus` compute it exactly this way). `null` means a create,
     * so no cancel.
     */
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
        mustCancel:
          previous !== null &&
          previous !== undefined &&
          meetingNotificationsDiffer(previous, row),
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
// AC (VM-018 Workflow 2): the reminder audience follows the GUEST LIST, and the
// guest list is filled AFTER the meeting is created
// ----------------------------------------------------------------------------
//
// A team meeting is the only kind whose guest list is populated at create time
// (from the team roster, VM-006); a vision meeting — the flagship — starts with
// an empty one and is invited into afterwards. An audience read once, at create,
// is therefore permanently `[createdBy]` for exactly the meetings that matter
// most, and every guest the planter invites hears nothing at 7, 3 or 1 days.

test("a guest invited AFTER the meeting was created is reminded at every future offset", async () => {
  const guests: string[] = [];
  const h = harness({ guests });
  await h.write(facts(), { previous: null });

  // Nobody but the organiser, so far — the vision-meeting starting state.
  for (const { days, rows } of reminders(h.queue)) {
    assert.deepEqual(
      rows.map((row) => row.recipientUserId),
      [ORGANISER],
      `the ${days}-day reminder already has a guest on it`
    );
  }

  // The guest write happens, and `addToGuestList` re-syncs with
  // `mustCancel: false` — ADDING a recipient owes no cancel. The audience is
  // re-read, the organiser's live rows are absorbed by their own dedupe keys,
  // and the new guest simply has no row to collide with.
  guests.push(GUEST);
  const pendingBefore = h.queue.pending().map((row) => row.id);
  const report = await syncMeetingNotifications(CHURCH, MEETING, {
    deps: h.deps,
    now: NOW,
    mustCancel: false,
  });

  assert.equal(
    report.cancelled,
    0,
    "adding a guest cancelled rows — the add path owes no cancel"
  );
  assert.equal(
    report.created,
    MEETING_REMINDER_OFFSET_DAYS.length,
    "only the new guest's rows were written — everyone else was absorbed by their dedupe keys"
  );
  for (const id of pendingBefore) {
    assert.ok(
      h.queue.pending().some((row) => row.id === id),
      "a row the organiser already held was re-minted with a new id"
    );
  }
  for (const { days, rows } of reminders(h.queue)) {
    assert.deepEqual(
      rows.map((row) => row.recipientUserId).sort(),
      [ORGANISER, GUEST].sort(),
      `the new guest has no ${days}-day reminder`
    );
  }
});

test("a guest removed from the list keeps none of their pending reminders", async () => {
  const guests: string[] = [GUEST];
  const h = harness({ guests });
  await h.write(facts(), { previous: null });

  assert.equal(
    h.queue.pending(meetingReminderType(7)).length,
    2,
    "the guest and the organiser were both reminded to begin with"
  );

  // `removeFromGuestList` re-syncs with `mustCancel: true` — the direction that
  // needs it, because `cancelByEntity` has no per-recipient form.
  guests.length = 0;
  await syncMeetingNotifications(CHURCH, MEETING, {
    deps: h.deps,
    now: NOW,
    mustCancel: true,
  });

  for (const { days, rows } of reminders(h.queue)) {
    assert.deepEqual(
      rows.map((row) => row.recipientUserId),
      [ORGANISER],
      `the removed guest still has a ${days}-day reminder`
    );
  }
});

// ----------------------------------------------------------------------------
// AC (VM-018): EVERY writer of `meeting_attendance` re-syncs
// ----------------------------------------------------------------------------
//
// `guestListUserIdsQuery` reads EVERY `meeting_attendance` row for the meeting
// as the reminder audience, so that table IS the audience and every write of it
// changes who is owed mail. This was pinned as two anchored spans in
// `guest-list.ts` — which could not see the two writers in `service.ts`
// (`addAttendee`, `removeAttendee`), both of them live server actions, and a
// removed attendee therefore kept pending reminders that dispatch would email.
//
// So it is a PROPERTY over the directory, the shape `tasks/notifications.test.ts`
// already uses for `.insert(tasks)`: find every write of the table, attribute it
// to the function it sits in, and require that function to ask for the re-sync.
// A `db` write cannot be executed in a unit test's process, so this is
// source-shaped by necessity; the behaviour it stands for is covered by the two
// guest tests above.

/** Writers that legitimately owe no re-sync, each with the reason. */
const ATTENDANCE_WRITERS_EXEMPT = new Map<string, string>([
  [
    "addTeamMembersToGuestList",
    "createMeeting populates the roster and then syncs once, for the whole set",
  ],
  [
    "recordAttendanceBatch",
    "the post-meeting register: every offset is behind the start, so nothing is owed",
  ],
]);

/** `source` cut into one chunk per function declaration, keyed by name. */
function functionChunks(source: string): Map<string, string> {
  const declaration = /(?:export\s+)?(?:async\s+)?function\s+(\w+)\s*[(<]/g;
  const starts: { name: string; at: number }[] = [];
  for (const match of source.matchAll(declaration)) {
    starts.push({ name: match[1], at: match.index });
  }

  const chunks = new Map<string, string>();
  starts.forEach(({ name, at }, index) => {
    chunks.set(name, source.slice(at, starts[index + 1]?.at ?? source.length));
  });
  return chunks;
}

test("no meetings module writes meeting_attendance without asking for the re-sync", () => {
  const dir = path.join(process.cwd(), "src/lib/meetings");
  const modules = readdirSync(dir)
    .filter((name) => /\.ts$/.test(name) && !/\.test\.ts$/.test(name))
    .map((name) => ({
      name,
      source: stripComments(readFileSync(path.join(dir, name), "utf8")),
    }));

  const writers: { module: string; fn: string; syncs: boolean }[] = [];
  for (const { name, source } of modules) {
    for (const [fn, body] of functionChunks(source)) {
      if (!/\.(insert|delete)\(meetingAttendance\)/.test(body)) continue;
      writers.push({
        module: name,
        fn,
        syncs: /syncMeetingNotifications\(/.test(body),
      });
    }
  }

  // Vacuity guards: a rename of the table or of the sync must fail here rather
  // than quietly reduce the scan to nothing.
  assert.ok(
    writers.length >= 4,
    `the writer scan found ${writers.length} writers of meeting_attendance — it has stopped seeing them`
  );
  assert.ok(
    new Set(writers.map((writer) => writer.module)).size >= 2,
    "the scan is looking at one module only — it cannot see the second writer file"
  );
  for (const exempt of ATTENDANCE_WRITERS_EXEMPT.keys()) {
    assert.ok(
      writers.some((writer) => writer.fn === exempt),
      `"${exempt}" is exempted but is no longer a writer — the exemption now hides nothing, or hides the wrong thing`
    );
  }

  const silent = writers
    .filter(
      (writer) => !writer.syncs && !ATTENDANCE_WRITERS_EXEMPT.has(writer.fn)
    )
    .map((writer) => `${writer.module}:${writer.fn}`);

  assert.deepEqual(
    silent,
    [],
    "a function changes the reminder audience and never re-syncs — a removed person keeps their pending reminders, an added one is never reminded"
  );
});

// ----------------------------------------------------------------------------
// AC: a still-live predicate is registered for the meeting types
// ----------------------------------------------------------------------------

test("the registrar arms every meeting type, and only through a call", async (t) => {
  // WHAT THIS PROVES, AND WHAT IT DOES NOT. Importing this module registers
  // NOTHING — asserted first, and that is the point: a module-load side effect
  // armed the check in every runtime EXCEPT the dispatcher's, which imports no
  // feature module. Whether production calls the registrar is asserted over the
  // ROUTE's own module graph, in
  // `src/app/api/notifications/dispatch/route.test.ts`.
  //
  // KEEP THIS THE FIRST TEST IN THE FILE THAT TOUCHES THE REGISTRY.
  assert.equal(MEETING_NOTIFICATION_TYPES.length, 4);
  for (const type of MEETING_NOTIFICATION_TYPES) {
    assert.equal(
      stillLivePredicateFor(type),
      undefined,
      `importing this module registered "${type}" — arming must be a call the dispatcher makes, not an import side effect`
    );
  }

  registerMeetingStillLivePredicates(harness().deps);
  t.after(() => clearStillLivePredicates());

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

test("the facts read scopes the meeting AND the team it names to the church", () => {
  // `teamName` is not a decoration: it flows through `meetingNotificationTitle`
  // into an emailed subject and body, so a `church_meetings.team_id` pointing at
  // another plant's team would render THAT plant's team name into THIS plant's
  // notification. The predicate belongs in the join condition — the WHERE cannot
  // hold it, because a left join with no match must still return the meeting.
  const { sql, params } = meetingNotificationFactsQuery(
    CHURCH,
    MEETING
  ).toSQL();

  assert.match(sql, /"church_meetings"\."church_id" = \$\d/);
  assert.match(sql, /"ministry_teams"\."church_id" = \$\d/);
  assert.equal(
    params.filter((value) => value === CHURCH).length,
    2,
    "both tables in the join carry the church id"
  );
  assert.ok(params.includes(MEETING));
});
