import assert from "node:assert/strict";
import { test } from "node:test";

import type { AttendanceType, MeetingType } from "@/db/schema";

import type { FinalizedAttendee } from "./events";
import {
  FinalizeAttendanceError,
  runFinalizeAttendance,
  type FinalizeAttendanceDeps,
} from "./service";

// ----------------------------------------------------------------------------
// MEET-011 — finalizeAttendance must not be able to half-apply.
//
// The neon-http driver has no interactive transactions, so the guarantee is
// built from ordering + idempotency (see the block comment above
// `finalizeAttendance` in service.ts). These tests drive the orchestration
// through its injectable seam and assert the ordering holds: nothing is marked
// finalized unless every downstream step succeeded.
//
// WHAT CHANGED WITH #323 WS3, and why the old assertions were the bug. This
// suite used to pin "a replay never re-emits": an already-finalized meeting
// updated its visible count and ran nothing downstream. That is exactly how a
// planter who finalized Ann and Bob, then noticed Cy in the room and added him,
// got a success and no follow-up task for Cy. Re-emission is now the CONTRACT,
// and the no-duplicate guarantee moved to where it can actually be kept — the
// handler, which writes only what the meeting is still owed
// (`tasks/events.test.ts`). What this suite still owns is the ORDERING:
// downstream first, the marker after, and a downstream failure leaves the
// stored count untouched.
// ----------------------------------------------------------------------------

type Call =
  | { kind: "recorded"; personId: string; attendanceType?: AttendanceType }
  | { kind: "finalized"; attendees: FinalizedAttendee[]; total: number }
  | { kind: "commit"; total: number }
  | { kind: "reconcile"; total: number };

interface Harness {
  deps: FinalizeAttendanceDeps;
  calls: Call[];
  /** Mirrors the `actual_attendance` column: null until finalized. */
  storedAttendance(): number | null;
}

function makeHarness(options: {
  meetingType?: MeetingType;
  actualAttendance?: number | null;
  attended?: { personId: string; attendanceType: AttendanceType | null }[];
  meetingMissing?: boolean;
  failFinalized?: boolean;
  failRecordedFor?: string;
  /** Simulate another finalize winning the compare-and-set first. */
  commitLoses?: boolean;
}): Harness {
  const calls: Call[] = [];
  let stored = options.actualAttendance ?? null;

  const deps: FinalizeAttendanceDeps = {
    async loadMeeting() {
      if (options.meetingMissing) return null;
      return {
        type: options.meetingType ?? "vision_meeting",
        actualAttendance: stored,
      };
    },
    async loadAttendedRecords() {
      return options.attended ?? [];
    },
    async emitRecorded(_meetingType, personId, attendanceType) {
      if (options.failRecordedFor === personId) {
        throw new Error(`recorded handler blew up for ${personId}`);
      }
      calls.push({ kind: "recorded", personId, attendanceType });
    },
    async emitFinalized(_meetingType, attendees, total) {
      if (options.failFinalized) {
        throw new Error("follow-up task generation failed");
      }
      calls.push({ kind: "finalized", attendees, total });
    },
    async commitFinalized(total) {
      calls.push({ kind: "commit", total });
      if (options.commitLoses) return false;
      stored = total;
      return true;
    },
    async reconcileCount(total) {
      calls.push({ kind: "reconcile", total });
      stored = total;
    },
  };

  return { deps, calls, storedAttendance: () => stored };
}

const ATTENDED = [
  { personId: "person-1", attendanceType: "first_time" as AttendanceType },
  { personId: "person-2", attendanceType: "returning" as AttendanceType },
  { personId: "person-3", attendanceType: null },
];

// ----------------------------------------------------------------------------
// No regression: the happy path still counts and still generates follow-ups
// ----------------------------------------------------------------------------

test("a normal finalize records the count and generates follow-ups", async () => {
  const h = makeHarness({ attended: ATTENDED });

  const result = await runFinalizeAttendance(h.deps);

  assert.equal(result.outcome, "finalized");
  assert.equal(result.total, 3);
  assert.deepEqual(result.attendeeIds, ["person-1", "person-2", "person-3"]);
  assert.equal(h.storedAttendance(), 3);

  assert.deepEqual(h.calls, [
    {
      kind: "recorded",
      personId: "person-1",
      attendanceType: "first_time",
    },
    { kind: "recorded", personId: "person-2", attendanceType: "returning" },
    { kind: "recorded", personId: "person-3", attendanceType: undefined },
    {
      kind: "finalized",
      attendees: ATTENDED,
      total: 3,
    },
    { kind: "commit", total: 3 },
  ]);
});

test("finalizing a meeting nobody attended still generates the evaluation follow-up", async () => {
  const h = makeHarness({ attended: [] });

  const result = await runFinalizeAttendance(h.deps);

  assert.equal(result.outcome, "finalized");
  assert.equal(result.total, 0);
  assert.equal(h.storedAttendance(), 0);
  assert.deepEqual(h.calls, [
    { kind: "finalized", attendees: [], total: 0 },
    { kind: "commit", total: 0 },
  ]);
});

// ----------------------------------------------------------------------------
// Ordering: the marker is written last, so failure is never half-applied
// ----------------------------------------------------------------------------

test("a failing follow-up step leaves the meeting in its pre-finalized state", async () => {
  const h = makeHarness({ attended: ATTENDED, failFinalized: true });

  await assert.rejects(
    () => runFinalizeAttendance(h.deps),
    (error: unknown) => {
      assert.ok(
        error instanceof FinalizeAttendanceError,
        "expected a FinalizeAttendanceError"
      );
      assert.match(error.message, /count was left alone/);
      assert.ok(error.cause instanceof Error, "expected the cause preserved");
      return true;
    }
  );

  // The meeting was never marked finalized...
  assert.equal(h.storedAttendance(), null);
  // ...and no commit was even attempted.
  assert.equal(
    h.calls.some((c) => c.kind === "commit"),
    false
  );
});

// NOTE: this is a defensive property of the orchestration, NOT a production
// guarantee. `emitAttendanceRecorded` emits NON-strictly, so the event bus
// swallows handler rejections and the real `emitRecorded` never rejects: in
// production a failed prospect → attendee auto-advance is logged and the
// meeting finalizes anyway (deliberate — a status nudge must not block
// finalization; the next status change heals it). The test pins what happens
// IF a rejection ever reaches this loop, e.g. if that emit is made strict.
test("a rejecting per-attendee emit would abort before the marker is written", async () => {
  const h = makeHarness({ attended: ATTENDED, failRecordedFor: "person-2" });

  await assert.rejects(
    () => runFinalizeAttendance(h.deps),
    FinalizeAttendanceError
  );

  assert.equal(h.storedAttendance(), null);
  assert.deepEqual(
    h.calls.map((c) => c.kind),
    ["recorded"],
    "should stop at the first failing handler and never reach the marker"
  );
});

test("retrying after a downstream failure rolls fully forward", async () => {
  // First attempt fails inside follow-up generation.
  const failing = makeHarness({ attended: ATTENDED, failFinalized: true });
  await assert.rejects(
    () => runFinalizeAttendance(failing.deps),
    FinalizeAttendanceError
  );
  assert.equal(failing.storedAttendance(), null);

  // The retry sees an un-finalized meeting and completes. Downstream handlers
  // are idempotent, so the replay does not duplicate anything.
  const retry = makeHarness({ attended: ATTENDED });
  const result = await runFinalizeAttendance(retry.deps);

  assert.equal(result.outcome, "finalized");
  assert.equal(retry.storedAttendance(), 3);
});

// ----------------------------------------------------------------------------
// Idempotency: re-running never duplicates follow-ups or events
// ----------------------------------------------------------------------------

test("re-running finalize on an unchanged meeting re-runs downstream and moves no marker", async () => {
  const h = makeHarness({ attended: ATTENDED, actualAttendance: 3 });

  const result = await runFinalizeAttendance(h.deps);

  assert.equal(result.outcome, "already_finalized");
  assert.equal(result.total, 3);
  assert.equal(h.storedAttendance(), 3);

  // Downstream runs — it is convergent, so a replay writes nothing — and the
  // count is neither re-committed nor pointlessly rewritten.
  assert.deepEqual(
    h.calls.map((c) => c.kind),
    ["recorded", "recorded", "recorded", "finalized"]
  );
});

test("re-running after a LATE ADDITION reaches the generator with the new attendee", async () => {
  // The #158 sequence: Ann and Bob were finalized, then Cy was added. The
  // planter presses the button again; Cy must reach the follow-up generator.
  const h = makeHarness({
    attended: [
      { personId: "ann", attendanceType: "returning" },
      { personId: "bob", attendanceType: "returning" },
      { personId: "cy", attendanceType: "first_time" },
    ],
    actualAttendance: 2,
  });

  const result = await runFinalizeAttendance(h.deps);

  assert.equal(result.outcome, "reconciled");
  assert.equal(result.total, 3);
  assert.equal(h.storedAttendance(), 3);

  const finalized = h.calls.find((c) => c.kind === "finalized");
  assert.ok(finalized, "the generator must be reached on a reconcile");
  assert.deepEqual(
    finalized.attendees.map((a) => a.personId),
    ["ann", "bob", "cy"],
    "the whole register is handed over; the generator writes only what is missing"
  );

  // And the count is refreshed AFTER generation, never before.
  assert.deepEqual(
    h.calls.map((c) => c.kind),
    ["recorded", "recorded", "recorded", "finalized", "reconcile"]
  );
});

test("re-running when the COUNT did not move still reaches the generator", async () => {
  // The twin of the bug above, one step further in: swap one attendee for
  // another and `actual_attendance` never changes. Gating downstream on the
  // count would drop the new person exactly as gating on the marker did.
  const h = makeHarness({
    attended: [
      { personId: "ann", attendanceType: "returning" },
      { personId: "cy", attendanceType: "first_time" },
    ],
    actualAttendance: 2,
  });

  const result = await runFinalizeAttendance(h.deps);

  assert.equal(result.outcome, "already_finalized");
  const finalized = h.calls.find((c) => c.kind === "finalized");
  assert.ok(finalized);
  assert.deepEqual(
    finalized.attendees.map((a) => a.personId),
    ["ann", "cy"]
  );
});

test("running finalize twice in a row commits the marker exactly once", async () => {
  const calls: Call[] = [];
  let stored: number | null = null;

  const deps: FinalizeAttendanceDeps = {
    async loadMeeting() {
      return { type: "vision_meeting", actualAttendance: stored };
    },
    async loadAttendedRecords() {
      return ATTENDED;
    },
    async emitRecorded(_t, personId, attendanceType) {
      calls.push({ kind: "recorded", personId, attendanceType });
    },
    async emitFinalized(_t, attendees, total) {
      calls.push({ kind: "finalized", attendees, total });
    },
    async commitFinalized(total) {
      calls.push({ kind: "commit", total });
      stored = total;
      return true;
    },
    async reconcileCount(total) {
      calls.push({ kind: "reconcile", total });
      stored = total;
    },
  };

  await runFinalizeAttendance(deps);
  await runFinalizeAttendance(deps);

  assert.equal(
    calls.filter((c) => c.kind === "commit").length,
    1,
    "the marker is claimed once; the second run has nothing to claim"
  );
  assert.equal(
    calls.filter((c) => c.kind === "reconcile").length,
    0,
    "the count did not move, so it is not rewritten"
  );
  // The event fires on both passes. That is the point of #323 WS3 — what stops
  // a duplicate is the generator, not a skipped emit.
  assert.equal(calls.filter((c) => c.kind === "finalized").length, 2);
  assert.equal(calls.filter((c) => c.kind === "recorded").length, 6);
  assert.equal(stored, 3);
});

test("losing the compare-and-set reports already_finalized, not a second finalize", async () => {
  const h = makeHarness({ attended: ATTENDED, commitLoses: true });

  const result = await runFinalizeAttendance(h.deps);

  assert.equal(result.outcome, "already_finalized");
  assert.equal(h.storedAttendance(), null);
});

// ----------------------------------------------------------------------------
// Guards
// ----------------------------------------------------------------------------

test("a meeting outside the church (or missing) throws before any write", async () => {
  const h = makeHarness({ meetingMissing: true, attended: ATTENDED });

  await assert.rejects(
    () => runFinalizeAttendance(h.deps),
    /Meeting not found/
  );
  assert.deepEqual(h.calls, []);
});

test("non-vision meetings still finalize and pass their type downstream", async () => {
  const h = makeHarness({
    meetingType: "team_meeting",
    attended: [{ personId: "person-9", attendanceType: null }],
  });

  const result = await runFinalizeAttendance(h.deps);

  assert.equal(result.outcome, "finalized");
  assert.equal(h.storedAttendance(), 1);
});
