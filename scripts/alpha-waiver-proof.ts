import assert from "node:assert/strict";
import { db } from "@/db";
import {
  churches,
  users,
  persons,
  churchMeetings,
  tasks,
  taskStatusHistory,
} from "@/db/schema";
import { and, eq } from "drizzle-orm";
import { handleMeetingAttendanceFinalized } from "@/lib/tasks/events";
import {
  getTask,
  updateTask,
  reopenTask,
  completeTask,
  getTaskCounts,
  assertMayActOnTask,
  listTaskStatusHistory,
} from "@/lib/tasks/service";
import { SeatRefusalError } from "@/lib/auth/seat-rules";
async function main() {
  const target = new URL(process.env.DATABASE_URL!);
  assert.ok(
    target.hostname === "localhost" || target.hostname === "127.0.0.1",
    "Proof requires owned loopback database"
  );
  assert.equal(
    target.pathname,
    "/alpha_waiver",
    "Proof refuses any database except owned alpha_waiver"
  );
  const [church] = await db
    .insert(churches)
    .values({
      name: "__alpha_waiver__",
      timeZone: "America/Chicago",
      onboardingCompletedAt: new Date(),
    })
    .returning();
  const [owner] = await db
    .insert(users)
    .values({
      name: "QA owner",
      email: `${crypto.randomUUID()}@example.test`,
      passwordHash: "local",
      churchId: church.id,
      seat: "owner",
    })
    .returning();
  await db.insert(persons).values({
    churchId: church.id,
    firstName: "QA",
    lastName: "Owner",
    userId: owner.id,
    status: "leader",
    createdBy: owner.id,
  });
  const [member] = await db
    .insert(users)
    .values({
      name: "QA member",
      email: `${crypto.randomUUID()}@example.test`,
      passwordHash: "local",
      churchId: church.id,
      seat: "member",
    })
    .returning();
  const [foreign] = await db
    .insert(churches)
    .values({ name: "__alpha_waiver_foreign__" })
    .returning();
  const [person] = await db
    .insert(persons)
    .values({
      churchId: church.id,
      firstName: "QA",
      lastName: "Contact",
      createdBy: owner.id,
    })
    .returning();
  const start = new Date("2026-09-01T18:00:00Z");
  const [meeting] = await db
    .insert(churchMeetings)
    .values({
      churchId: church.id,
      title: "QA vision",
      type: "vision_meeting",
      datetime: start,
      createdBy: owner.id,
    })
    .returning();
  const attendees = [
    { personId: person.id, attendanceType: "first_time" as const },
  ];
  await handleMeetingAttendanceFinalized(
    meeting.id,
    "vision_meeting",
    church.id,
    attendees
  );
  let rows = await db
    .select()
    .from(tasks)
    .where(eq(tasks.followUpObligationKey, `${meeting.id}:${person.id}`));
  assert.equal(rows.length, 1);
  let row = rows[0];
  assert.equal(
    row.followUpStartedAt?.toISOString(),
    "2026-09-01T23:00:00.000Z"
  );
  assert.equal(row.followUpMeetingId, meeting.id);
  assert.equal(row.dueDate, "2026-09-03"); // late finalization does not reset48h
  assert.equal(await getTask(foreign.id, row.id), null);
  assert.throws(() => assertMayActOnTask(member, row), SeatRefusalError);
  assertMayActOnTask(owner, row);
  await updateTask(church.id, row.id, { status: "no_longer_needed" });
  row = (await getTask(church.id, row.id))!;
  assert.equal(row.status, "no_longer_needed");
  assert.equal(row.completedAt, null);
  assert.equal(row.completedById, null);
  assert.equal((await getTaskCounts(church.id)).complete, 0);
  assert.equal((await getTaskCounts(church.id)).noLongerNeeded, 1);
  await assert.rejects(() => completeTask(church.id, row.id, owner));
  const history = await listTaskStatusHistory(church.id, row.id);
  assert.equal(history[0].previousStatus, "not_started");
  assert.equal(history[0].status, "no_longer_needed");
  assert.deepEqual(await listTaskStatusHistory(foreign.id, row.id), []);
  await Promise.all([
    handleMeetingAttendanceFinalized(
      meeting.id,
      "vision_meeting",
      church.id,
      attendees
    ),
    handleMeetingAttendanceFinalized(
      meeting.id,
      "vision_meeting",
      church.id,
      attendees
    ),
  ]);
  assert.equal(
    (
      await db
        .select()
        .from(tasks)
        .where(eq(tasks.followUpObligationKey, `${meeting.id}:${person.id}`))
    ).length,
    1
  );
  await updateTask(church.id, row.id, { dueDate: "2026-09-20" });
  await db
    .update(tasks)
    .set({ deletedAt: new Date() })
    .where(eq(tasks.id, row.id));
  await handleMeetingAttendanceFinalized(
    meeting.id,
    "vision_meeting",
    church.id,
    attendees
  );
  assert.equal(
    (
      await db
        .select()
        .from(tasks)
        .where(eq(tasks.followUpObligationKey, `${meeting.id}:${person.id}`))
    ).length,
    1
  );
  await db.update(tasks).set({ deletedAt: null }).where(eq(tasks.id, row.id));
  await reopenTask(church.id, row.id, owner);
  assert.equal((await getTask(church.id, row.id))?.status, "not_started");
  assert.equal((await listTaskStatusHistory(church.id, row.id)).length, 2);
  const [second] = await db
    .insert(churchMeetings)
    .values({
      churchId: church.id,
      title: "QA other meeting",
      type: "vision_meeting",
      datetime: new Date("2026-09-10T18:00:00Z"),
      createdBy: owner.id,
    })
    .returning();
  await handleMeetingAttendanceFinalized(
    second.id,
    "vision_meeting",
    church.id,
    attendees
  );
  assert.equal(
    (
      await db
        .select()
        .from(tasks)
        .where(
          and(eq(tasks.relatedId, person.id), eq(tasks.category, "follow_up"))
        )
    ).length,
    2
  );
  const [legacyMeeting] = await db
    .insert(churchMeetings)
    .values({
      churchId: church.id,
      title: "QA legacy meeting",
      type: "vision_meeting",
      datetime: new Date("2026-09-15T18:00:00Z"),
      createdBy: owner.id,
    })
    .returning();
  await handleMeetingAttendanceFinalized(
    legacyMeeting.id,
    "vision_meeting",
    church.id,
    attendees
  );
  const [legacy] = await db
    .select()
    .from(tasks)
    .where(eq(tasks.followUpObligationKey, `${legacyMeeting.id}:${person.id}`));
  await db
    .update(tasks)
    .set({
      followUpObligationKey: null,
      followUpStartedAt: null,
      followUpMeetingId: null,
    })
    .where(eq(tasks.id, legacy.id));
  await updateTask(church.id, legacy.id, { status: "no_longer_needed" });
  assert.equal((await getTask(church.id, legacy.id))?.followUpStartedAt, null);
  await updateTask(church.id, legacy.id, {
    dueDate: "2026-09-25",
    relatedType: null,
    relatedId: null,
  });
  await db
    .update(tasks)
    .set({ deletedAt: new Date() })
    .where(eq(tasks.id, legacy.id));
  await handleMeetingAttendanceFinalized(
    legacyMeeting.id,
    "vision_meeting",
    church.id,
    attendees
  );
  assert.equal(
    (
      await db
        .select()
        .from(tasks)
        .where(
          eq(tasks.followUpObligationKey, `${legacyMeeting.id}:${person.id}`)
        )
    ).length,
    0
  );
  assert.equal(
    (
      await db
        .select()
        .from(tasks)
        .where(
          eq(tasks.followUpObligationKey, `legacy:2026-09-17:${person.id}`)
        )
    ).length,
    1
  );
  console.log(
    JSON.stringify({
      passed: true,
      checks: [
        "generated immutable provenance",
        "late finalization preserves origin",
        "church/own-task permission denial",
        "waived counts no completion",
        "waived completion refusal",
        "transition history and tenant scope",
        "concurrent replay dedup",
        "date-edit and soft-delete dedup",
        "reopen preserves history",
        "distinct meeting obligations",
        "legacy waiver identity without invented metric provenance",
      ],
      churchId: church.id,
      taskId: row.id,
    })
  );
}
main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
