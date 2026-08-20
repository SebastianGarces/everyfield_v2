/**
 * G3 harness for FOLLOW-UP TASK GENERATION (#323 — VM-007, #162 hardening,
 * #158 reconcile). Real database.
 *
 * ----------------------------------------------------------------------------
 * What it proves, and why a script rather than a browser pass
 * ----------------------------------------------------------------------------
 *
 * Every acceptance criterion in #323 is about ROWS a background handler writes
 * when a meeting is finalized: who gets a task, what day it is due, what a
 * second finalize does, and what a crafted task can no longer do to the index
 * that guards the set. None of that is visible on a screen. So this runs the
 * real product path — `finalizeAttendance`, the same function the server action
 * calls — against a real database and reads the `tasks` rows back.
 *
 * It follows the rules `scripts/g3-association-lifecycle.ts` set:
 *
 *   * IT PRINTS EVERY ID IT USES, so the evidence names rows that existed;
 *   * IT MUTATES THROUGH THE PRODUCT PATH between the first assertion and the
 *     last — `finalizeAttendance` and `createTask`, never a hand-written INSERT
 *     into `tasks`. The only raw writes are the fixtures before the sequence and
 *     the cleanup after it, both announced;
 *   * IT LEAVES THE DATABASE AS FOUND. It creates its own churches, users,
 *     persons and meetings and deletes exactly those, so it is safe against the
 *     shared development branch.
 *
 *   pnpm g3:followups
 *   pnpm g3:followups --keep
 *
 * `--keep` skips the cleanup when a verifier wants to inspect the rows.
 */
import assert from "node:assert/strict";

import { and, eq, inArray, isNull } from "drizzle-orm";

import { db } from "@/db";
import {
  churchMeetings,
  churches,
  meetingAttendance,
  notifications,
  persons,
  tasks,
  users,
} from "@/db/schema";
import { addCalendarDays, toCalendarDate } from "@/lib/datetime";
import { finalizeAttendance } from "@/lib/meetings/service";
import { createTask } from "@/lib/tasks/service";
import { taskCreateSchema } from "@/lib/validations/tasks";

const KEEP = process.argv.includes("--keep");

function ok(label: string) {
  console.log(`PASS  ${label}`);
}

function id(label: string, value: string) {
  console.log(`ID    ${label.padEnd(30)} ${value}`);
}

function section(title: string) {
  console.log(`\n--- ${title} ---`);
}

/** Every live task the church holds, newest column set only. */
async function liveTasks(churchId: string) {
  return db
    .select({
      id: tasks.id,
      title: tasks.title,
      category: tasks.category,
      dueDate: tasks.dueDate,
      relatedType: tasks.relatedType,
      relatedId: tasks.relatedId,
      completionEvent: tasks.completionEvent,
    })
    .from(tasks)
    .where(and(eq(tasks.churchId, churchId), isNull(tasks.deletedAt)));
}

/** The live follow-up tasks pointing at one person. */
async function followUpsFor(churchId: string, personId: string) {
  const rows = await liveTasks(churchId);
  return rows.filter(
    (row) =>
      row.category === "follow_up" &&
      row.relatedType === "person" &&
      row.relatedId === personId
  );
}

async function main() {
  const stamp = Date.now();

  // --------------------------------------------------------------------------
  // FIXTURES — the only raw writes before the sequence begins.
  // --------------------------------------------------------------------------
  section("fixtures (raw inserts, before any product call)");

  const [plant] = await db
    .insert(churches)
    .values({
      name: `G3 Follow-up Plant ${stamp}`,
      onboardingCompletedAt: new Date(),
    })
    .returning();
  id("church", plant.id);

  // A SECOND church, for the tenancy assertion in §6. Nothing in the sequence
  // writes to it until then.
  const [otherPlant] = await db
    .insert(churches)
    .values({
      name: `G3 Other Plant ${stamp}`,
      onboardingCompletedAt: new Date(),
    })
    .returning();
  id("other church", otherPlant.id);

  const [planter, otherPlanter] = await db
    .insert(users)
    .values([
      {
        email: `g3-followups-planter-${stamp}@example.test`,
        passwordHash: "x",
        seat: "owner" as const,
        churchId: plant.id,
      },
      {
        email: `g3-followups-other-${stamp}@example.test`,
        passwordHash: "x",
        seat: "owner" as const,
        churchId: otherPlant.id,
      },
    ])
    .returning();
  id("planter (owner seat)", planter.id);
  id("other planter", otherPlanter.id);

  // The register. Ann and Cy are strangers; Bob attended an earlier meeting;
  // Dee is core group. Their `attendance_type` is written explicitly here
  // because `deriveAttendanceType` is F3's job and is proven by its own tests —
  // what THIS script is about is what the generator does with the answer.
  const [ann, bob, cy, dee] = await db
    .insert(persons)
    .values([
      {
        churchId: plant.id,
        firstName: "Ann",
        lastName: `First${stamp}`,
        createdBy: planter.id,
      },
      {
        churchId: plant.id,
        firstName: "Bob",
        lastName: `Return${stamp}`,
        createdBy: planter.id,
      },
      {
        churchId: plant.id,
        firstName: "Cy",
        lastName: `Late${stamp}`,
        createdBy: planter.id,
      },
      {
        churchId: plant.id,
        firstName: "Dee",
        lastName: `Core${stamp}`,
        status: "core_group" as const,
        createdBy: planter.id,
      },
    ])
    .returning();
  for (const [label, person] of [
    ["ann (first_time)", ann],
    ["bob (returning)", bob],
    ["cy (first_time, late)", cy],
    ["dee (core_group)", dee],
  ] as const) {
    id(label, person.id);
  }

  // A vision meeting held FOUR DAYS AGO, finalized today. That gap is the whole
  // point of VM-007 AC 7: the follow-up window belongs to the meeting, so the
  // generated task must be due two days after the MEETING, which is already in
  // the past.
  const meetingDay = new Date(Date.now() - 4 * 24 * 60 * 60 * 1000);
  const [meeting] = await db
    .insert(churchMeetings)
    .values({
      churchId: plant.id,
      type: "vision_meeting" as const,
      title: `G3 Vision Meeting ${stamp}`,
      datetime: meetingDay,
      createdBy: planter.id,
    })
    .returning();
  id("vision meeting", meeting.id);
  console.log(`      held ${toCalendarDate(meetingDay)}, finalized today`);

  // A team meeting, to prove non-vision meetings still generate nothing.
  const [teamMeeting] = await db
    .insert(churchMeetings)
    .values({
      churchId: plant.id,
      type: "team_meeting" as const,
      title: `G3 Team Meeting ${stamp}`,
      datetime: meetingDay,
      createdBy: planter.id,
    })
    .returning();
  id("team meeting", teamMeeting.id);

  // A SECOND vision meeting, whose id §5 tries to strand with a crafted task.
  const [targetMeeting] = await db
    .insert(churchMeetings)
    .values({
      churchId: plant.id,
      type: "vision_meeting" as const,
      title: `G3 Target Meeting ${stamp}`,
      datetime: meetingDay,
      createdBy: planter.id,
    })
    .returning();
  id("suppression-target meeting", targetMeeting.id);

  await db.insert(meetingAttendance).values([
    {
      churchId: plant.id,
      meetingId: meeting.id,
      personId: ann.id,
      attendanceType: "first_time" as const,
      status: "attended" as const,
    },
    {
      churchId: plant.id,
      meetingId: meeting.id,
      personId: bob.id,
      attendanceType: "returning" as const,
      status: "attended" as const,
    },
    {
      churchId: plant.id,
      meetingId: meeting.id,
      personId: dee.id,
      attendanceType: "core_group" as const,
      status: "attended" as const,
    },
  ]);
  console.log("      register: ann (first_time), bob (returning), dee (core)");

  try {
    // ------------------------------------------------------------------------
    // §1 — VM-007: a follow-up for the first-timer, and nobody else
    // ------------------------------------------------------------------------
    section("§1 first finalize — who gets a follow-up (VM-007, #323 WS2)");

    const first = await finalizeAttendance(plant.id, meeting.id);
    assert.equal(first.outcome, "finalized");
    assert.equal(first.total, 3);
    ok("finalizeAttendance reported `finalized`, 3 attended");

    const afterFirst = await liveTasks(plant.id);
    const followUps = afterFirst.filter((t) => t.category === "follow_up");

    assert.deepEqual(
      followUps.map((t) => t.relatedId).sort(),
      [ann.id],
      "only the first-time attendee is owed a follow-up"
    );
    ok("ann (first_time) has a follow-up task");

    assert.equal(
      (await followUpsFor(plant.id, bob.id)).length,
      0,
      "a returning attendee gets no follow-up"
    );
    assert.equal(
      (await followUpsFor(plant.id, dee.id)).length,
      0,
      "a core-group attendee gets no follow-up"
    );
    ok("bob (returning) and dee (core_group) got none");

    // ------------------------------------------------------------------------
    // §2 — VM-007 AC 7: the due date anchors to the MEETING, not the finalize
    // ------------------------------------------------------------------------
    section("§2 the 48-hour window is the meeting's (VM-007 AC 7)");

    const expectedDue = addCalendarDays(meetingDay, 2);
    const today = toCalendarDate(new Date());

    assert.equal(followUps[0].dueDate, expectedDue);
    console.log(`      due ${followUps[0].dueDate}, today is ${today}`);
    ok(`follow-up due ${expectedDue} — the meeting day + 2`);

    assert.ok(
      followUps[0].dueDate! < today,
      "finalized four days late, so the task is created already due — the window is the point"
    );
    ok("the task is already overdue, which is the correct statement");

    const evaluation = afterFirst.find((t) => t.relatedType === "meeting");
    assert.ok(evaluation, "the evaluation task exists");
    assert.equal(
      evaluation.completionEvent,
      "meeting.evaluation.completed",
      "the evaluation task still carries its auto-completion hook"
    );
    assert.equal(
      evaluation.dueDate,
      addCalendarDays(new Date(), 1),
      "the planter's 24-hour evaluation task is unchanged: it anchors to now"
    );
    ok("the evaluation task is unchanged — due tomorrow, not meeting-anchored");

    // ------------------------------------------------------------------------
    // §3 — MEET-011 idempotency: a replay writes nothing
    // ------------------------------------------------------------------------
    section("§3 a replay changes nothing (MEET-011, #136 AC2)");

    const replay = await finalizeAttendance(plant.id, meeting.id);
    assert.equal(replay.outcome, "already_finalized");

    const afterReplay = await liveTasks(plant.id);
    assert.equal(
      afterReplay.length,
      afterFirst.length,
      "a replay must not add a row"
    );
    assert.deepEqual(
      afterReplay.map((t) => t.id).sort(),
      afterFirst.map((t) => t.id).sort(),
      "and must not replace one either"
    );
    ok(`row count steady at ${afterReplay.length} across two finalizes`);

    // ------------------------------------------------------------------------
    // §4 — #158: reconciling after a finalize no longer drops the late arrival
    // ------------------------------------------------------------------------
    section("§4 the Ann+Bob -> add Cy -> finalize sequence (#323 WS3)");

    await db.insert(meetingAttendance).values({
      churchId: plant.id,
      meetingId: meeting.id,
      personId: cy.id,
      attendanceType: "first_time" as const,
      status: "attended" as const,
    });
    console.log("      cy added to the register after the finalize");

    const reconciled = await finalizeAttendance(plant.id, meeting.id);
    assert.equal(
      reconciled.outcome,
      "reconciled",
      "the count moved, so this call reconciles"
    );
    assert.equal(reconciled.total, 4);
    ok("finalizeAttendance reported `reconciled`, 4 attended");

    const cyFollowUps = await followUpsFor(plant.id, cy.id);
    assert.equal(
      cyFollowUps.length,
      1,
      "the late-added first-timer gets exactly one follow-up — this is the bug #158 reported"
    );
    assert.equal(
      cyFollowUps[0].dueDate,
      expectedDue,
      "and it carries the same meeting-anchored window as the others"
    );
    ok("cy has exactly one follow-up, due the same meeting day + 2");

    // The idempotency #136 established survives the top-up.
    assert.equal(
      (await followUpsFor(plant.id, ann.id)).length,
      1,
      "the original attendee's follow-up is not duplicated"
    );
    const afterReconcile = await liveTasks(plant.id);
    assert.equal(
      afterReconcile.filter((t) => t.relatedType === "meeting").length,
      1,
      "and no second evaluation task appears"
    );
    assert.equal(
      afterReconcile.length,
      afterFirst.length + 1,
      "exactly one row was added: cy's"
    );
    ok(
      `row count ${afterFirst.length} -> ${afterReconcile.length}: the delta only`
    );

    // A fourth press with nothing changed still writes nothing.
    const settled = await finalizeAttendance(plant.id, meeting.id);
    assert.equal(settled.outcome, "already_finalized");
    assert.equal((await liveTasks(plant.id)).length, afterReconcile.length);
    ok("a further press adds nothing and reports `already_finalized`");

    // ------------------------------------------------------------------------
    // §5 — the suppression vector, closed by deleting the dead zod field
    // ------------------------------------------------------------------------
    section("§5 the crafted task can no longer strand a meeting (#323 WS1)");

    // The exact payload #162 described: the evaluation completion event, a
    // MEETING's id as `relatedId`, and `relatedType: 'person'` so the
    // generator's guard (which demands `related_type = 'meeting'`) never sees
    // it while the partial index — keyed on (church_id, related_id) alone —
    // does. Posted through the boundary the form posts through.
    const crafted = taskCreateSchema.parse({
      title: `G3 crafted ${stamp}`,
      relatedType: "person",
      relatedId: targetMeeting.id,
      completionEvent: "meeting.evaluation.completed",
    });
    assert.equal(
      "completionEvent" in crafted,
      false,
      "the field is gone from the schema, so the parse drops it"
    );
    ok("taskCreateSchema strips the crafted completionEvent at the boundary");

    const craftedTask = await createTask(plant.id, planter.id, crafted);
    id("crafted task", craftedTask.id);
    assert.equal(
      craftedTask.completionEvent,
      null,
      "the stored row carries no completion event, so it holds no index slot"
    );
    ok("the created row's completion_event is NULL — no index slot occupied");

    // The proof that matters: the meeting it targeted still generates its full
    // set. Before the fix this finalize wrote NOTHING, permanently.
    await db.insert(meetingAttendance).values({
      churchId: plant.id,
      meetingId: targetMeeting.id,
      personId: ann.id,
      attendanceType: "first_time" as const,
      status: "attended" as const,
    });

    const targetResult = await finalizeAttendance(plant.id, targetMeeting.id);
    assert.equal(targetResult.outcome, "finalized");

    const targetTasks = (await liveTasks(plant.id)).filter(
      (t) => t.relatedType === "meeting" && t.relatedId === targetMeeting.id
    );
    assert.equal(
      targetTasks.length,
      1,
      "the targeted meeting got its evaluation task — it was not stranded at zero"
    );
    ok("the targeted meeting finalized with its full task set");

    // ------------------------------------------------------------------------
    // §6 — non-vision meetings, and the tenancy filter on the title lookup
    // ------------------------------------------------------------------------
    section("§6 non-vision generates nothing; the title lookup is scoped");

    const before = (await liveTasks(plant.id)).length;
    await db.insert(meetingAttendance).values({
      churchId: plant.id,
      meetingId: teamMeeting.id,
      personId: ann.id,
      attendanceType: "first_time" as const,
      status: "attended" as const,
    });
    const teamResult = await finalizeAttendance(plant.id, teamMeeting.id);
    assert.equal(teamResult.outcome, "finalized");
    assert.equal(
      (await liveTasks(plant.id)).length,
      before,
      "a team meeting generates no follow-up and no evaluation task"
    );
    ok("the team meeting finalized and wrote no tasks");

    // #323 WS1: the meeting-title lookup carries `church_id`. Asking the OTHER
    // church to finalize this church's meeting must reach nothing — neither a
    // task nor the title.
    const foreign = await finalizeAttendance(otherPlant.id, meeting.id).then(
      () => "resolved",
      (error: unknown) => (error as Error).message
    );
    assert.match(
      foreign,
      /Meeting not found/,
      "a foreign meeting id is refused before any write"
    );
    assert.equal(
      (await liveTasks(otherPlant.id)).length,
      0,
      "and the other church holds no task from this run"
    );
    ok("a cross-tenant finalize is refused and writes nothing");

    section("all assertions passed");
  } finally {
    if (KEEP) {
      console.log("\n--keep: rows left in place for inspection");
      return;
    }
    section("cleanup (deletes ONLY the rows above)");
    const churchIds = [plant.id, otherPlant.id];
    await db
      .delete(notifications)
      .where(inArray(notifications.churchId, churchIds));
    await db.delete(tasks).where(inArray(tasks.churchId, churchIds));
    await db
      .delete(meetingAttendance)
      .where(inArray(meetingAttendance.churchId, churchIds));
    await db
      .delete(churchMeetings)
      .where(inArray(churchMeetings.churchId, churchIds));
    await db.delete(persons).where(inArray(persons.churchId, churchIds));
    await db
      .delete(users)
      .where(inArray(users.id, [planter.id, otherPlanter.id]));
    await db.delete(churches).where(inArray(churches.id, churchIds));
    console.log("cleanup done — the database is as it was found");
  }
}

main().then(
  () => process.exit(0),
  (error) => {
    console.error(error);
    process.exit(1);
  }
);
