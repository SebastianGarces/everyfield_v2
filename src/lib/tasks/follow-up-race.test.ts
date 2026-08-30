import assert from "node:assert/strict";
import { after, test, type TestContext } from "node:test";

import { and, eq, inArray, isNull, like, sql } from "drizzle-orm";

import { db } from "@/db";
import {
  churchMeetings,
  churches,
  phasePromptAnswers,
  phaseTransitions,
  persons,
  sendingChurches,
  tasks,
  users,
} from "@/db/schema";

import type { FinalizedAttendee } from "@/lib/meetings/events";

import { followUpDueDate, handleMeetingAttendanceFinalized } from "./events";
import {
  bulkCompleteTasks,
  bulkRescheduleTasks,
  completeTask,
  createNextRecurrence,
  createTask,
  deleteTask,
  getTask,
  listSubtasks,
  listTasks,
  reopenTask,
  updateTask,
} from "./service";
import {
  listFollowUpAssignees,
  listFollowUpTaskIdsOwnedBy,
  listOpenFollowUpTasks,
  mayOwnFollowUp,
  planFollowUpHandoff,
} from "./follow-up-ownership";
import { isExactTaskAssignee, TASK_ASSIGNEE_ERROR } from "./assignees";
import { taskNotificationFactsQuery } from "./notifications";
import { readTaskListPage } from "./list-page";
import { importTaskTemplate } from "./import";
import {
  acceptPhaseTemplatePrompt,
  declinePhaseTemplatePrompt,
} from "./phase-prompt";
import { runPostgresStatement } from "@/lib/testing/postgres-transaction-barrier";

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
      .delete(phasePromptAnswers)
      .where(eq(phasePromptAnswers.churchId, church.id));
    await db
      .delete(phaseTransitions)
      .where(eq(phaseTransitions.churchId, church.id));
    await db
      .delete(churchMeetings)
      .where(eq(churchMeetings.churchId, church.id));
    await db.delete(persons).where(eq(persons.churchId, church.id));
    await db.delete(users).where(eq(users.churchId, church.id));
    await db.delete(churches).where(eq(churches.id, church.id));
  }
  await db
    .delete(sendingChurches)
    .where(like(sendingChurches.name, SCRATCH_NAME));
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

test(
  "a dual-tenancy assignee is null in every projection and blocks every service write",
  { skip },
  async (t: TestContext) => {
    if (!(await databaseReachable())) return t.skip(UNREACHABLE);

    await sweep();
    const fixture = await seed();
    try {
      const [sendingChurch] = await db
        .insert(sendingChurches)
        .values({ name: SCRATCH_NAME })
        .returning({ id: sendingChurches.id });
      const [dual] = await db
        .insert(users)
        .values({
          email: `${crypto.randomUUID()}@scratch.invalid`,
          passwordHash: "scratch",
          name: "Unavailable dual tenancy assignee",
          seat: "member",
          churchId: fixture.churchId,
          sendingChurchId: sendingChurch.id,
        })
        .returning({ id: users.id });
      const [dualPerson] = await db
        .insert(persons)
        .values({
          churchId: fixture.churchId,
          firstName: "Unavailable",
          lastName: "Assignee",
          status: "core_group",
          userId: dual.id,
          createdBy: fixture.planterId,
        })
        .returning({ id: persons.id });
      const [actor] = await db
        .select()
        .from(users)
        .where(eq(users.id, fixture.planterId));
      assert.ok(actor);

      assert.equal(await isExactTaskAssignee(fixture.churchId, dual.id), false);
      assert.equal(await mayOwnFollowUp(fixture.churchId, dual.id), false);
      assert.equal(
        await planFollowUpHandoff(fixture.churchId, dualPerson.id),
        null
      );
      assert.equal(
        (await listFollowUpAssignees(fixture.churchId)).some(
          ({ id }) => id === dual.id
        ),
        false
      );

      await assert.rejects(
        createTask(fixture.churchId, fixture.planterId, {
          title: "Must not land",
          status: "not_started",
          priority: "medium",
          assignedToId: dual.id,
          category: "general",
        }),
        { message: TASK_ASSIGNEE_ERROR }
      );

      const [legacy] = await db
        .insert(tasks)
        .values({
          churchId: fixture.churchId,
          title: "Legacy malformed assignment",
          createdById: fixture.planterId,
          assignedToId: dual.id,
          category: "follow_up",
        })
        .returning({ id: tasks.id });

      const detail = await getTask(fixture.churchId, legacy.id);
      assert.equal(detail?.assignedToId, null);
      assert.equal(detail?.assigneeName, null);
      assert.equal(detail?.assigneeEmail, null);
      const listed = await listTasks(fixture.churchId, {
        includeCompleted: true,
      });
      const listRow = listed.tasks.find(({ id }) => id === legacy.id);
      assert.equal(listRow?.assignedToId, null);
      assert.equal(listRow?.assigneeName, null);
      assert.equal(listRow?.assigneeEmail, null);
      const ownership = (await listOpenFollowUpTasks(fixture.churchId)).find(
        ({ taskId }) => taskId === legacy.id
      );
      assert.equal(ownership?.ownerName, null);
      assert.equal(ownership?.ownerEmail, null);
      assert.equal(ownership?.assignedToId, null);
      assert.equal(ownership?.ownerIsCommitted, false);
      assert.deepEqual(
        await listFollowUpTaskIdsOwnedBy(fixture.churchId, dual.id),
        []
      );
      const [notificationFacts] = await taskNotificationFactsQuery(
        fixture.churchId,
        [legacy.id]
      );
      assert.equal(notificationFacts?.assignedToId, null);

      await assert.rejects(
        updateTask(fixture.churchId, legacy.id, { title: "Still refused" }),
        { message: TASK_ASSIGNEE_ERROR }
      );
      assert.equal(
        (
          await db
            .select({ title: tasks.title })
            .from(tasks)
            .where(eq(tasks.id, legacy.id))
        )[0]?.title,
        "Legacy malformed assignment"
      );

      const [malformedComplete, malformedReopen, deleteParent] = await db
        .insert(tasks)
        .values([
          {
            churchId: fixture.churchId,
            title: "Malformed complete",
            createdById: fixture.planterId,
            assignedToId: dual.id,
          },
          {
            churchId: fixture.churchId,
            title: "Malformed reopen",
            status: "complete",
            completedAt: new Date(),
            completedById: fixture.planterId,
            createdById: fixture.planterId,
            assignedToId: dual.id,
          },
          {
            churchId: fixture.churchId,
            title: "Exact parent with malformed child",
            createdById: fixture.planterId,
            assignedToId: fixture.planterId,
          },
        ])
        .returning({ id: tasks.id });
      const [deleteChild] = await db
        .insert(tasks)
        .values({
          churchId: fixture.churchId,
          title: "Malformed child",
          createdById: fixture.planterId,
          assignedToId: dual.id,
          parentTaskId: deleteParent.id,
        })
        .returning({ id: tasks.id });

      const checklist = await listSubtasks(fixture.churchId, deleteParent.id);
      assert.equal(checklist[0]?.id, deleteChild.id);
      assert.equal(checklist[0]?.assignedToId, null);
      assert.equal(checklist[0]?.assigneeName, null);
      assert.equal(checklist[0]?.assigneeEmail, null);

      await assert.rejects(
        completeTask(fixture.churchId, malformedComplete.id, actor),
        { message: TASK_ASSIGNEE_ERROR }
      );
      await assert.rejects(
        reopenTask(fixture.churchId, malformedReopen.id, actor),
        { message: TASK_ASSIGNEE_ERROR }
      );
      await assert.rejects(deleteTask(fixture.churchId, deleteParent.id), {
        message: TASK_ASSIGNEE_ERROR,
      });

      const malformedAfterSingleWrites = await db
        .select({
          id: tasks.id,
          status: tasks.status,
          deletedAt: tasks.deletedAt,
        })
        .from(tasks)
        .where(
          inArray(tasks.id, [
            malformedComplete.id,
            malformedReopen.id,
            deleteParent.id,
            deleteChild.id,
          ])
        );
      assert.deepEqual(
        new Map(
          malformedAfterSingleWrites.map((row) => [
            row.id,
            [row.status, row.deletedAt],
          ])
        ),
        new Map([
          [malformedComplete.id, ["not_started", null]],
          [malformedReopen.id, ["complete", null]],
          [deleteParent.id, ["not_started", null]],
          [deleteChild.id, ["not_started", null]],
        ])
      );

      const [malformedBulkComplete, malformedBulkReschedule] = await db
        .insert(tasks)
        .values([
          {
            churchId: fixture.churchId,
            title: "Malformed bulk complete",
            createdById: fixture.planterId,
            assignedToId: dual.id,
          },
          {
            churchId: fixture.churchId,
            title: "Malformed bulk reschedule",
            createdById: fixture.planterId,
            assignedToId: dual.id,
            dueDate: "2026-01-01",
          },
        ])
        .returning({ id: tasks.id });

      const bulkComplete = await bulkCompleteTasks(
        fixture.churchId,
        [malformedBulkComplete.id],
        actor
      );
      assert.deepEqual(bulkComplete.succeeded, []);
      assert.deepEqual(
        bulkComplete.failed.map(({ taskId, reason }) => [taskId, reason]),
        [[malformedBulkComplete.id, "Task not found"]]
      );
      const bulkReschedule = await bulkRescheduleTasks(
        fixture.churchId,
        [malformedBulkReschedule.id],
        "2026-12-31"
      );
      assert.deepEqual(bulkReschedule.succeeded, []);
      assert.deepEqual(
        bulkReschedule.failed.map(({ taskId, reason }) => [taskId, reason]),
        [[malformedBulkReschedule.id, "Task not found"]]
      );
      const malformedBulkRows = await db
        .select({ id: tasks.id, status: tasks.status, dueDate: tasks.dueDate })
        .from(tasks)
        .where(
          inArray(tasks.id, [
            malformedBulkComplete.id,
            malformedBulkReschedule.id,
          ])
        );
      assert.deepEqual(
        new Map(
          malformedBulkRows.map((row) => [row.id, [row.status, row.dueDate]])
        ),
        new Map([
          [malformedBulkComplete.id, ["not_started", null]],
          [malformedBulkReschedule.id, ["not_started", "2026-01-01"]],
        ])
      );

      await assert.rejects(
        importTaskTemplate({
          churchId: fixture.churchId,
          userId: dual.id,
          templateKey: "post-meeting-follow-up",
        }),
        { message: TASK_ASSIGNEE_ERROR }
      );
      await assert.rejects(
        acceptPhaseTemplatePrompt({
          churchId: fixture.churchId,
          userId: dual.id,
          templateKeys: ["post-meeting-follow-up"],
        }),
        { message: TASK_ASSIGNEE_ERROR }
      );
      await assert.rejects(
        declinePhaseTemplatePrompt({
          churchId: fixture.churchId,
          userId: dual.id,
          expectedTransitionId: crypto.randomUUID(),
        }),
        { message: TASK_ASSIGNEE_ERROR }
      );
      assert.equal(
        (
          await db
            .select({ count: sql<number>`count(*)::int` })
            .from(tasks)
            .where(
              and(
                eq(tasks.churchId, fixture.churchId),
                eq(tasks.createdById, dual.id)
              )
            )
        )[0]?.count,
        0
      );

      // Ordinary exact-plant assignees still travel through every mutation
      // family. The malformed-row assertions above are not a blanket ban on
      // assigned work.
      const exactSingle = await createTask(
        fixture.churchId,
        fixture.planterId,
        {
          title: "Exact assignee single writes",
          status: "not_started",
          priority: "medium",
          assignedToId: fixture.planterId,
          category: "general",
        }
      );
      await updateTask(fixture.churchId, exactSingle.id, {
        title: "Exact assignee updated",
      });
      await completeTask(fixture.churchId, exactSingle.id, actor);
      await reopenTask(fixture.churchId, exactSingle.id, actor);
      await deleteTask(fixture.churchId, exactSingle.id);
      assert.ok(
        (
          await db
            .select({ deletedAt: tasks.deletedAt })
            .from(tasks)
            .where(eq(tasks.id, exactSingle.id))
        )[0]?.deletedAt
      );

      const [exactBulkComplete, exactBulkReschedule] = await db
        .insert(tasks)
        .values([
          {
            churchId: fixture.churchId,
            title: "Exact bulk complete",
            createdById: fixture.planterId,
            assignedToId: fixture.planterId,
          },
          {
            churchId: fixture.churchId,
            title: "Exact bulk reschedule",
            createdById: fixture.planterId,
            assignedToId: fixture.planterId,
          },
        ])
        .returning({ id: tasks.id });
      assert.deepEqual(
        (
          await bulkCompleteTasks(
            fixture.churchId,
            [exactBulkComplete.id],
            actor
          )
        ).succeeded,
        [exactBulkComplete.id]
      );
      assert.deepEqual(
        (
          await bulkRescheduleTasks(
            fixture.churchId,
            [exactBulkReschedule.id],
            "2026-12-31"
          )
        ).succeeded,
        [exactBulkReschedule.id]
      );
      const imported = await importTaskTemplate({
        churchId: fixture.churchId,
        userId: fixture.planterId,
        templateKey: "post-meeting-follow-up",
      });
      assert.ok(imported.created.length > 0);
      assert.ok(
        imported.created.every(
          ({ assignedToId }) => assignedToId === fixture.planterId
        )
      );

      for (const cursor of ["", "   ", "not-a-uuid"]) {
        const malformedDirect = await listTasks(fixture.churchId, { cursor });
        assert.deepEqual(malformedDirect, {
          tasks: [],
          total: 0,
          nextCursor: null,
          cursorAvailable: false,
        });
        const malformedUrl = await readTaskListPage(
          fixture.churchId,
          fixture.planterId,
          { cursor, view: "all" }
        );
        assert.equal(malformedUrl.cursorAvailable, false);
        assert.deepEqual(malformedUrl.tasks, []);
        const malformedAction = await readTaskListPage(
          fixture.churchId,
          fixture.planterId,
          { view: "all" },
          cursor
        );
        assert.equal(malformedAction.cursorAvailable, false);
        assert.deepEqual(malformedAction.tasks, []);
      }

      const omittedDirect = await listTasks(fixture.churchId, {
        includeCompleted: true,
      });
      assert.equal(omittedDirect.cursorAvailable, true);
      assert.ok(omittedDirect.tasks.length > 0);
      const omittedUrl = await readTaskListPage(
        fixture.churchId,
        fixture.planterId,
        { view: "all", completed: "true" }
      );
      assert.equal(omittedUrl.cursorAvailable, true);
      assert.ok(omittedUrl.tasks.length > 0);
    } finally {
      await sweep();
    }
  }
);

test(
  "task and phase-answer mutations recheck exact tenancy after their preflight read",
  { skip },
  async (t: TestContext) => {
    if (!(await databaseReachable())) return t.skip(UNREACHABLE);

    await sweep();
    const fixture = await seed();
    try {
      const [sendingChurch] = await db
        .insert(sendingChurches)
        .values({ name: SCRATCH_NAME })
        .returning({ id: sendingChurches.id });
      const [assignee] = await db
        .insert(users)
        .values({
          email: `${crypto.randomUUID()}@scratch.invalid`,
          passwordHash: "scratch",
          name: "Race assignee",
          seat: "member",
          churchId: fixture.churchId,
        })
        .returning({ id: users.id });
      const [historicalCreator] = await db
        .insert(users)
        .values({
          email: `${crypto.randomUUID()}@scratch.invalid`,
          passwordHash: "scratch",
          name: "Historical recurrence creator",
          seat: "member",
          churchId: fixture.churchId,
        })
        .returning({ id: users.id });

      const makeActorDual = () =>
        runPostgresStatement(
          `update users set sending_church_id = '${sendingChurch.id}'::uuid where id = '${fixture.planterId}'::uuid;`
        );
      const makeActorExact = () =>
        runPostgresStatement(
          `update users set sending_church_id = null where id = '${fixture.planterId}'::uuid;`
        );
      const makeAssigneeDual = () =>
        runPostgresStatement(
          `update users set sending_church_id = '${sendingChurch.id}'::uuid where id = '${assignee.id}'::uuid;`
        );
      const makeAssigneeExact = () =>
        runPostgresStatement(
          `update users set sending_church_id = null where id = '${assignee.id}'::uuid;`
        );
      const makeCreatorDual = () =>
        runPostgresStatement(
          `update users set sending_church_id = '${sendingChurch.id}'::uuid where id = '${historicalCreator.id}'::uuid;`
        );
      const makeCreatorExact = () =>
        runPostgresStatement(
          `update users set sending_church_id = null where id = '${historicalCreator.id}'::uuid;`
        );

      const meetingPerson = await addPerson(fixture, "Planter drift");
      await assert.rejects(
        handleMeetingAttendanceFinalized(
          fixture.meetingId,
          "vision_meeting",
          fixture.churchId,
          [attendee(meetingPerson)],
          { beforeInsert: makeActorDual }
        ),
        { message: TASK_ASSIGNEE_ERROR }
      );
      assert.deepEqual(
        await followUpsFor(fixture, meetingPerson),
        [],
        "the attendee follow-up landed after the selected planter became dual-tenant"
      );
      assert.deepEqual(
        await evaluationsFor(fixture),
        [],
        "the meeting evaluation landed after the selected planter became dual-tenant"
      );

      await makeActorExact();
      await handleMeetingAttendanceFinalized(
        fixture.meetingId,
        "vision_meeting",
        fixture.churchId,
        [attendee(meetingPerson)]
      );
      assert.equal((await followUpsFor(fixture, meetingPerson)).length, 1);
      assert.equal((await evaluationsFor(fixture)).length, 1);

      await assert.rejects(
        createTask(
          fixture.churchId,
          fixture.planterId,
          {
            title: "Race must not land",
            status: "not_started",
            priority: "medium",
            assignedToId: assignee.id,
            category: "general",
          },
          undefined,
          { beforeInsert: makeAssigneeDual }
        ),
        { message: TASK_ASSIGNEE_ERROR }
      );
      assert.equal(
        (
          await db
            .select({ count: sql<number>`count(*)::int` })
            .from(tasks)
            .where(
              and(
                eq(tasks.churchId, fixture.churchId),
                eq(tasks.title, "Race must not land")
              )
            )
        )[0]?.count,
        0,
        "the separate connection changed tenancy after preflight, but the task still landed"
      );

      await makeAssigneeExact();
      const beforeImport = (
        await db
          .select({ count: sql<number>`count(*)::int` })
          .from(tasks)
          .where(eq(tasks.churchId, fixture.churchId))
      )[0]!.count;
      await assert.rejects(
        importTaskTemplate(
          {
            churchId: fixture.churchId,
            userId: fixture.planterId,
            templateKey: "post-meeting-follow-up",
          },
          { beforeInsert: makeActorDual }
        ),
        { message: TASK_ASSIGNEE_ERROR }
      );
      assert.equal(
        (
          await db
            .select({ count: sql<number>`count(*)::int` })
            .from(tasks)
            .where(eq(tasks.churchId, fixture.churchId))
        )[0]?.count,
        beforeImport,
        "the template import landed a partial or complete set after its user became dual-tenant"
      );

      await makeActorExact();
      const valid = await createTask(fixture.churchId, fixture.planterId, {
        title: "Exact actor still lands",
        status: "not_started",
        priority: "medium",
        assignedToId: assignee.id,
        category: "general",
      });
      assert.equal(valid.assignedToId, assignee.id);

      const recurring = await createTask(
        fixture.churchId,
        fixture.planterId,
        {
          title: "Recurring mutation boundary",
          status: "not_started",
          priority: "medium",
          dueDate: "2026-09-01",
          assignedToId: assignee.id,
          category: "general",
        },
        {
          isRecurring: true,
          recurrenceRule: { interval: "weekly", endDate: null },
        }
      );
      await createTask(fixture.churchId, fixture.planterId, {
        title: "Recurring checklist item",
        status: "not_started",
        priority: "medium",
        assignedToId: assignee.id,
        category: "general",
        parentTaskId: recurring.id,
      });
      await db
        .update(tasks)
        .set({ status: "complete", completedAt: new Date() })
        .where(eq(tasks.id, recurring.id));

      const completedRecurring = { ...recurring, status: "complete" as const };
      await assert.rejects(
        createNextRecurrence(completedRecurring, "2026-09-01", undefined, {
          beforeSuccessorInsert: makeAssigneeDual,
        }),
        { message: TASK_ASSIGNEE_ERROR }
      );
      assert.equal(
        (
          await db
            .select({ count: sql<number>`count(*)::int` })
            .from(tasks)
            .where(eq(tasks.title, recurring.title))
        )[0]?.count,
        1,
        "the recurrence successor landed after the exact assignee preflight became stale"
      );

      await makeAssigneeExact();
      const successor = await createNextRecurrence(
        completedRecurring,
        "2026-09-01"
      );
      assert.ok(successor);
      assert.equal(successor.assignedToId, assignee.id);
      assert.deepEqual(
        (await listSubtasks(fixture.churchId, successor.id)).map(
          ({ title, assignedToId }) => ({ title, assignedToId })
        ),
        [
          {
            title: "Recurring checklist item",
            assignedToId: assignee.id,
          },
        ]
      );

      const creatorRecurring = await createTask(
        fixture.churchId,
        historicalCreator.id,
        {
          title: "Recurring historical creator boundary",
          status: "not_started",
          priority: "medium",
          dueDate: "2026-09-15",
          assignedToId: assignee.id,
          category: "general",
        },
        {
          isRecurring: true,
          recurrenceRule: { interval: "weekly", endDate: null },
        }
      );
      await createTask(fixture.churchId, historicalCreator.id, {
        title: "Historical creator checklist",
        status: "not_started",
        priority: "medium",
        assignedToId: assignee.id,
        category: "general",
        parentTaskId: creatorRecurring.id,
      });
      const creatorCompletedAt = new Date();
      await db
        .update(tasks)
        .set({
          status: "complete",
          completedAt: creatorCompletedAt,
          completedById: fixture.planterId,
        })
        .where(eq(tasks.id, creatorRecurring.id));
      const completedWithFreshAuthority = {
        ...creatorRecurring,
        status: "complete" as const,
        completedAt: creatorCompletedAt,
        completedById: fixture.planterId,
      };

      await assert.rejects(
        createNextRecurrence(
          completedWithFreshAuthority,
          "2026-09-15",
          undefined,
          { beforeSuccessorInsert: makeCreatorDual }
        ),
        { message: TASK_ASSIGNEE_ERROR }
      );
      assert.equal(
        (
          await db
            .select({ count: sql<number>`count(*)::int` })
            .from(tasks)
            .where(eq(tasks.title, creatorRecurring.title))
        )[0]?.count,
        1,
        "a fresh exact completer must not carry a now-dual historical creator into a successor"
      );

      await makeCreatorExact();
      const creatorSuccessor = await createNextRecurrence(
        completedWithFreshAuthority,
        "2026-09-15"
      );
      assert.ok(creatorSuccessor);
      assert.equal(creatorSuccessor.createdById, historicalCreator.id);
      const creatorChildren = await db
        .select({ createdById: tasks.createdById })
        .from(tasks)
        .where(eq(tasks.parentTaskId, creatorSuccessor.id));
      assert.deepEqual(creatorChildren, [
        { createdById: historicalCreator.id },
      ]);

      const childRace = await createTask(
        fixture.churchId,
        fixture.planterId,
        {
          title: "Recurring checklist mutation boundary",
          status: "not_started",
          priority: "medium",
          dueDate: "2026-10-01",
          assignedToId: assignee.id,
          category: "general",
        },
        {
          isRecurring: true,
          recurrenceRule: { interval: "weekly", endDate: null },
        }
      );
      await createTask(fixture.churchId, fixture.planterId, {
        title: "Child race must not land",
        status: "not_started",
        priority: "medium",
        assignedToId: assignee.id,
        category: "general",
        parentTaskId: childRace.id,
      });
      await db
        .update(tasks)
        .set({ status: "complete", completedAt: new Date() })
        .where(eq(tasks.id, childRace.id));
      const childRaceSuccessor = await createNextRecurrence(
        { ...childRace, status: "complete" },
        "2026-10-01",
        undefined,
        { beforeChildrenInsert: makeAssigneeDual }
      );
      assert.ok(childRaceSuccessor);
      assert.deepEqual(
        await listSubtasks(fixture.churchId, childRaceSuccessor.id),
        [],
        "the recurrence checklist landed after its assignee preflight became stale"
      );

      await makeAssigneeExact();
      const [transition] = await db
        .insert(phaseTransitions)
        .values({
          churchId: fixture.churchId,
          fromPhase: 1,
          toPhase: 2,
          initiatedById: fixture.planterId,
          reason: "exact-tenancy mutation race",
          kind: "transition",
          rubricVersion: "race-proof",
        })
        .returning({ id: phaseTransitions.id });

      await assert.rejects(
        declinePhaseTemplatePrompt(
          {
            churchId: fixture.churchId,
            userId: fixture.planterId,
            expectedTransitionId: transition.id,
          },
          { beforeClaim: makeActorDual }
        ),
        { message: TASK_ASSIGNEE_ERROR }
      );
      assert.equal(
        (
          await db
            .select({ count: sql<number>`count(*)::int` })
            .from(phasePromptAnswers)
            .where(eq(phasePromptAnswers.transitionId, transition.id))
        )[0]?.count,
        0,
        "the separate connection changed tenancy after preflight, but the answer claim still landed"
      );

      await makeActorExact();
      assert.deepEqual(
        await declinePhaseTemplatePrompt({
          churchId: fixture.churchId,
          userId: fixture.planterId,
          expectedTransitionId: transition.id,
        }),
        { transitionId: transition.id }
      );
      assert.equal(
        (
          await db
            .select({ count: sql<number>`count(*)::int` })
            .from(phasePromptAnswers)
            .where(eq(phasePromptAnswers.transitionId, transition.id))
        )[0]?.count,
        1
      );
    } finally {
      await sweep();
    }
  }
);
