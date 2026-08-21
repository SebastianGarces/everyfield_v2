import assert from "node:assert/strict";
import { after, test, type TestContext } from "node:test";

import { and, eq, isNull, like, sql } from "drizzle-orm";

import { db } from "@/db";
import { churchMeetings, churches, persons, tasks, users } from "@/db/schema";

import type { FinalizedAttendee } from "@/lib/meetings/events";

import { followUpDueDate, handleMeetingAttendanceFinalized } from "./events";

// ----------------------------------------------------------------------------
// #521 — THE TWO RESIDUALS #323 DEFERRED, ASSERTED AGAINST A REAL POSTGRES.
//
// Both are properties of an index predicate under concurrency, and neither is
// visible to a unit test: the SQL that `handleMeetingAttendanceFinalized` emits
// was already correct in both cases, and the bugs lived in what the DATABASE
// did with two of them at once (`declaration-race.test.ts` says the same thing
// about the same class).
//
//   1. THE RECONCILE RACE. A top-up insert — a late-added first-timer,
//      reconciled after the finalize — carries no evaluation row, so before
//      `tasks_person_follow_up_unique_idx` no index stood over it and two
//      concurrent reconciles could each write that person the same follow-up.
//
//   2. THE STOLEN SLOT. `tasks_meeting_evaluation_unique_idx` was partial on
//      the completion event and the soft-delete, while the guard that reads it
//      also demands `related_type = 'meeting'`. A row carrying that event, a
//      meeting's id and `related_type = 'person'` therefore held the slot while
//      remaining invisible to the guard: the real INSERT failed 23505, was
//      classified as a benign lost race, and the meeting finalized with NO
//      tasks at all, permanently (#323 WS1, from #162).
//
//      #323 shut the client-reachable door by deleting `completionEvent` from
//      the zod schemas (`src/lib/validations/tasks.test.ts` pins that half).
//      This is the other half, and it is the one a boundary test cannot make:
//      the row is written STRAIGHT TO THE TABLE, as a script, a repair or a
//      future writer would, and the generation still has to produce its tasks.
//
// OPT-IN, on `declaration-race.test.ts`'s terms: `LIVE_DB_TESTS=1` plus a
// `select 1` probe, so the hermetic suite stays green and an explicit opt-in
// against a dead database skips loudly rather than failing. Everything written
// here is namespaced by `SCRATCH_NAME` and swept in `after`, including on
// failure.
// ----------------------------------------------------------------------------

const LIVE_DB = process.env.LIVE_DB_TESTS === "1";
const skip = LIVE_DB
  ? false
  : "opt-in: run `LIVE_DB_TESTS=1 pnpm test:live` — a real Postgres is the only place these two guards are visible";

const UNREACHABLE =
  "SKIPPED — LIVE_DB_TESTS=1 was set but DATABASE_URL points at no reachable Postgres, so the races did NOT run";

async function databaseReachable(): Promise<boolean> {
  try {
    await db.execute(sql`select 1`);
    return true;
  } catch {
    return false;
  }
}

/** Namespaces every row this file writes, so the sweep cannot touch real data. */
const SCRATCH_NAME = "__t521 follow-up race scratch__";

/** The meeting's own day. Every follow-up it generates is due this day + 2. */
const MEETING_DAY = new Date("2026-05-10T18:00:00.000Z");

const RUNS = 3;

interface Fixture {
  churchId: string;
  planterId: string;
  meetingId: string;
}

/**
 * A plant with an Owner and one finalized-able vision meeting.
 *
 * The Owner seat is load-bearing rather than decoration: the handler infers the
 * planter from it and returns early with a warning when there is none, so a
 * seatless fixture would make every assertion below vacuous.
 */
async function seed(): Promise<Fixture> {
  const [church] = await db
    .insert(churches)
    .values({ name: SCRATCH_NAME, onboardingCompletedAt: new Date() })
    .returning({ id: churches.id });

  const [planter] = await db
    .insert(users)
    .values({
      email: `${crypto.randomUUID()}@scratch.invalid`,
      passwordHash: "scratch",
      name: SCRATCH_NAME,
      seat: "owner",
      churchId: church.id,
    })
    .returning({ id: users.id });

  const [meeting] = await db
    .insert(churchMeetings)
    .values({
      churchId: church.id,
      title: SCRATCH_NAME,
      type: "vision_meeting",
      datetime: MEETING_DAY,
      createdBy: planter.id,
    })
    .returning({ id: churchMeetings.id });

  return {
    churchId: church.id,
    planterId: planter.id,
    meetingId: meeting.id,
  };
}

async function addPerson(fixture: Fixture, firstName: string): Promise<string> {
  const [person] = await db
    .insert(persons)
    .values({
      churchId: fixture.churchId,
      firstName,
      lastName: SCRATCH_NAME,
      createdBy: fixture.planterId,
    })
    .returning({ id: persons.id });

  return person.id;
}

function attendee(personId: string): FinalizedAttendee {
  return { personId, attendanceType: "first_time" };
}

/** Live follow-up rows for one person, straight from the table. */
async function followUpsFor(fixture: Fixture, personId: string) {
  return db
    .select({ id: tasks.id, dueDate: tasks.dueDate })
    .from(tasks)
    .where(
      and(
        eq(tasks.churchId, fixture.churchId),
        eq(tasks.category, "follow_up"),
        eq(tasks.relatedType, "person"),
        eq(tasks.relatedId, personId),
        isNull(tasks.deletedAt)
      )
    );
}

/** Live evaluation rows for the fixture's meeting, straight from the table. */
async function evaluationsFor(fixture: Fixture) {
  return db
    .select({ id: tasks.id, title: tasks.title })
    .from(tasks)
    .where(
      and(
        eq(tasks.churchId, fixture.churchId),
        eq(tasks.relatedType, "meeting"),
        eq(tasks.relatedId, fixture.meetingId),
        eq(tasks.completionEvent, "meeting.evaluation.completed"),
        isNull(tasks.deletedAt)
      )
    );
}

async function sweep(): Promise<void> {
  const scratch = await db
    .select({ id: churches.id })
    .from(churches)
    .where(like(churches.name, SCRATCH_NAME));

  for (const church of scratch) {
    await db.delete(tasks).where(eq(tasks.churchId, church.id));
    await db
      .delete(churchMeetings)
      .where(eq(churchMeetings.churchId, church.id));
    await db.delete(persons).where(eq(persons.churchId, church.id));
    await db.delete(users).where(eq(users.churchId, church.id));
    await db.delete(churches).where(eq(churches.id, church.id));
  }
}

after(async () => {
  if (!LIVE_DB) return;
  if (!(await databaseReachable())) return;
  await sweep();
});

// ----------------------------------------------------------------------------
// Residual 1 — the reconcile race
// ----------------------------------------------------------------------------

test(
  "two concurrent reconciles leave ONE follow-up for the late attendee, every run",
  { skip },
  async (t: TestContext) => {
    if (!(await databaseReachable())) return t.skip(UNREACHABLE);

    await sweep();

    for (let run = 1; run <= RUNS; run++) {
      const fixture = await seed();

      // The finalize that already happened: one first-timer, so the meeting
      // holds its evaluation task and Ann's follow-up.
      const ann = await addPerson(fixture, "Ann");
      await handleMeetingAttendanceFinalized(
        fixture.meetingId,
        "vision_meeting",
        fixture.churchId,
        [attendee(ann)]
      );

      // …and the late-added attendee the register gained afterwards. This is
      // the TOP-UP: the reconcile writes a follow-up and no evaluation row,
      // because the meeting already has one.
      const bo = await addPerson(fixture, "Bo");
      const register = [attendee(ann), attendee(bo)];

      await Promise.all([
        handleMeetingAttendanceFinalized(
          fixture.meetingId,
          "vision_meeting",
          fixture.churchId,
          register
        ),
        handleMeetingAttendanceFinalized(
          fixture.meetingId,
          "vision_meeting",
          fixture.churchId,
          register
        ),
      ]);

      const boRows = await followUpsFor(fixture, bo);
      assert.equal(
        boRows.length,
        1,
        `run ${run}: the raced reconcile wrote ${boRows.length} follow-ups for the late attendee, not 1`
      );
      assert.equal(
        boRows[0].dueDate,
        followUpDueDate(MEETING_DAY),
        `run ${run}: the surviving row must carry the MEETING's window, not the reconcile's`
      );

      // Ann is untouched: her row is the first finalize's, and neither racer
      // wrote her a second one.
      const annRows = await followUpsFor(fixture, ann);
      assert.equal(
        annRows.length,
        1,
        `run ${run}: the reconcile duplicated a follow-up that already existed`
      );

      assert.equal(
        (await evaluationsFor(fixture)).length,
        1,
        `run ${run}: the meeting must still hold exactly one evaluation task`
      );

      await sweep();
    }
  }
);

test(
  "a raced top-up still lands the attendee the OTHER racer did not write",
  { skip },
  async (t: TestContext) => {
    if (!(await databaseReachable())) return t.skip(UNREACHABLE);

    // The reason the INSERT skips per row instead of aborting whole (#521).
    // Two reconciles read the register a moment apart, so their `owed` sets
    // differ: one knows about Ann, the other about Ann AND Bo. Under the
    // all-or-nothing shape the second one's unique violation rolled its WHOLE
    // statement back and Bo — a late-added first-timer, the exact case #323 WS3
    // made this handler convergent for — was dropped on the floor.
    await sweep();

    const fixture = await seed();

    try {
      const ann = await addPerson(fixture, "Ann");
      const bo = await addPerson(fixture, "Bo");

      await Promise.all([
        handleMeetingAttendanceFinalized(
          fixture.meetingId,
          "vision_meeting",
          fixture.churchId,
          [attendee(ann)]
        ),
        handleMeetingAttendanceFinalized(
          fixture.meetingId,
          "vision_meeting",
          fixture.churchId,
          [attendee(ann), attendee(bo)]
        ),
      ]);

      assert.equal(
        (await followUpsFor(fixture, ann)).length,
        1,
        "both racers owed Ann a follow-up; exactly one row may survive"
      );
      assert.equal(
        (await followUpsFor(fixture, bo)).length,
        1,
        "only one racer knew about Bo — aborting its whole statement is how a late-added first-timer is dropped"
      );
      assert.equal((await evaluationsFor(fixture)).length, 1);
    } finally {
      await sweep();
    }
  }
);

test(
  "the guard is the index, not the statement — a raw duplicate follow-up is refused",
  { skip },
  async (t: TestContext) => {
    if (!(await databaseReachable())) return t.skip(UNREACHABLE);

    // The handler can only be as safe as the constraint under it, so the
    // constraint is asserted directly: a future rewrite of the INSERT cannot
    // quietly remove the thing that makes the duplicate impossible.
    await sweep();

    const fixture = await seed();

    try {
      const ann = await addPerson(fixture, "Ann");
      const row = {
        churchId: fixture.churchId,
        title: "Follow up with Ann",
        category: "follow_up" as const,
        relatedType: "person" as const,
        relatedId: ann,
        dueDate: followUpDueDate(MEETING_DAY),
        createdById: fixture.planterId,
      };

      await db.insert(tasks).values(row);

      await assert.rejects(
        () => db.insert(tasks).values({ ...row, title: "Follow up again" }),
        (error: unknown) => {
          // Drizzle wraps the driver error, so the index name is on the
          // `cause`, not on the message it re-throws.
          const text = [
            error instanceof Error ? error.message : String(error),
            error instanceof Error && error.cause instanceof Error
              ? error.cause.message
              : "",
          ].join(" ");
          assert.match(text, /tasks_person_follow_up_unique_idx/);
          return true;
        },
        "a second live follow-up for one person on one day must be refused by the database"
      );

      // The index is PARTIAL, and both halves of that matter. A follow-up on
      // ANOTHER day is a different window and lands…
      await db
        .insert(tasks)
        .values({ ...row, dueDate: followUpDueDate(new Date("2026-06-01")) });

      // …and a soft-deleted row stops holding the slot, so a dismissed
      // follow-up can be regenerated.
      await db.delete(tasks).where(eq(tasks.relatedId, ann));
      await db.insert(tasks).values({ ...row, deletedAt: new Date() });
      await db.insert(tasks).values(row);

      assert.equal(
        (await followUpsFor(fixture, ann)).length,
        1,
        "the live row is the only one the partial index counts"
      );
    } finally {
      await sweep();
    }
  }
);

// ----------------------------------------------------------------------------
// Residual 2 — the stolen evaluation slot
// ----------------------------------------------------------------------------

test(
  "a crafted row written OUTSIDE the app can no longer strand a meeting at zero tasks",
  { skip },
  async (t: TestContext) => {
    if (!(await databaseReachable())) return t.skip(UNREACHABLE);

    await sweep();

    const fixture = await seed();

    try {
      const ann = await addPerson(fixture, "Ann");

      // THE SUPPRESSION VECTOR, in the one shape the boundary cannot refuse:
      // straight into the table, carrying the evaluation completion event and
      // the MEETING's id, but `related_type = 'person'`. The guard in
      // `handleMeetingAttendanceFinalized` filters on `related_type =
      // 'meeting'`, so it does not see this row; before #521 the index did not
      // filter on it either, so the row held the slot and every subsequent
      // generation for this meeting failed and was swallowed.
      await db.insert(tasks).values({
        churchId: fixture.churchId,
        title: "Crafted",
        relatedType: "person",
        relatedId: fixture.meetingId,
        completionEvent: "meeting.evaluation.completed",
        createdById: fixture.planterId,
      });

      await handleMeetingAttendanceFinalized(
        fixture.meetingId,
        "vision_meeting",
        fixture.churchId,
        [attendee(ann)]
      );

      assert.equal(
        (await evaluationsFor(fixture)).length,
        1,
        "the crafted row still holds the evaluation slot — the index predicate is wider than the guard's read"
      );
      assert.equal(
        (await followUpsFor(fixture, ann)).length,
        1,
        "the whole generation was aborted by the stolen slot, which is how a meeting finalized with no tasks at all"
      );
    } finally {
      await sweep();
    }
  }
);
