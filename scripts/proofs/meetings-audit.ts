/** Disposable-database action proof and browser fixtures for meeting corrections.
 * Run with Node 24 --experimental-test-module-mocks --import tsx.
 * The environment must name the owned database and a private output file.
 */
import assert from "node:assert/strict";
import { writeFileSync } from "node:fs";
import { mock } from "node:test";
import { hash } from "@node-rs/argon2";
import { and, eq } from "drizzle-orm";
import { db } from "@/db";
import {
  churches,
  users,
  persons,
  churchMeetings,
  meetingAttendance,
  meetingChecklistItems,
  meetingEvaluations,
  meetingResponses,
  type User,
  type MeetingType,
} from "@/db/schema";
import { UnauthorizedError } from "@/lib/auth/unauthorized";

async function main() {
  const database = new URL(process.env.DATABASE_URL!);
  assert.ok(
    /^ef_preview_[a-f0-9]{12}$/.test(process.env.MEETINGS_AUDIT_DATABASE ?? ""),
    "name the owned preview database"
  );
  assert.equal(process.env.EVERYFIELD_OWNED_PREVIEW, "1");
  assert.equal(database.hostname, "localhost");
  assert.equal(database.pathname, `/${process.env.MEETINGS_AUDIT_DATABASE}`);
  const output = process.env.MEETINGS_AUDIT_FIXTURE_PATH;
  assert.ok(output);
  assert.ok(
    output.startsWith("/private/tmp/"),
    "private fixture output is required"
  );

  let actor: User | null = null;
  mock.module("@/lib/auth/session", {
    namedExports: {
      verifySession: async () => {
        if (!actor) throw new UnauthorizedError();
        return { user: actor };
      },
    },
  });
  mock.module("next/cache", {
    namedExports: { refresh() {}, revalidatePath() {} },
  });
  mock.module("next/navigation", {
    namedExports: {
      redirect() {
        throw new Error("redirect");
      },
    },
  });
  const actions = await import("@/app/(dashboard)/meetings/actions");
  const { getMeeting, getAttendanceSummary, finalizeAttendance } =
    await import("@/lib/meetings/service");

  const password = crypto.randomUUID();
  const passwordHash = await hash(password);
  const fixtureKey = crypto.randomUUID().slice(0, 8);
  const plants = await db
    .insert(churches)
    .values([
      {
        name: `Meeting proof ${fixtureKey}`,
        currentPhase: 2,
        onboardingCompletedAt: new Date(),
      },
      {
        name: `Foreign meeting proof ${fixtureKey}`,
        currentPhase: 2,
        onboardingCompletedAt: new Date(),
      },
    ])
    .returning();
  const accounts = await db
    .insert(users)
    .values([
      {
        name: "Meeting Owner",
        email: `owner-${fixtureKey}@proof.invalid`,
        seat: "owner",
        churchId: plants[0].id,
        passwordHash,
      },
      {
        name: "Meeting Member",
        email: `member-${fixtureKey}@proof.invalid`,
        seat: "member",
        churchId: plants[0].id,
        passwordHash,
      },
      {
        name: "Foreign Owner",
        email: `foreign-${fixtureKey}@proof.invalid`,
        seat: "owner",
        churchId: plants[1].id,
        passwordHash,
      },
    ])
    .returning();
  const [owner, member, foreign] = accounts;
  const people = await db
    .insert(persons)
    .values([
      {
        churchId: owner.churchId!,
        firstName: "Ada",
        lastName: "Guest",
        status: "core_group",
        createdBy: owner.id,
      },
      {
        churchId: owner.churchId!,
        firstName: "Absent",
        lastName: "Guest",
        createdBy: owner.id,
      },
      {
        churchId: owner.churchId!,
        firstName: "Excused",
        lastName: "Guest",
        createdBy: owner.id,
      },
      {
        churchId: foreign.churchId!,
        firstName: "Foreign",
        lastName: "Guest",
        createdBy: foreign.id,
      },
    ])
    .returning();
  const meetingRows = await db
    .insert(churchMeetings)
    .values([
      ...(
        ["vision_meeting", "orientation", "team_meeting"] as MeetingType[]
      ).map((type, i) => ({
        churchId: owner.churchId!,
        type,
        title: `Proof ${type}`,
        datetime: new Date("2026-09-20T16:00:00Z"),
        status: "completed" as const,
        meetingNumber: i + 1,
        actualAttendance: 1,
        createdBy: owner.id,
      })),
      {
        churchId: owner.churchId!,
        type: "vision_meeting" as const,
        title: "Proof planned vision",
        datetime: new Date("2027-01-01T16:00:00Z"),
        status: "planning" as const,
        meetingNumber: 4,
        createdBy: owner.id,
      },
      {
        churchId: foreign.churchId!,
        type: "vision_meeting" as const,
        title: "Proof foreign vision",
        datetime: new Date("2026-09-20T16:00:00Z"),
        status: "completed" as const,
        actualAttendance: 1,
        createdBy: foreign.id,
      },
    ])
    .returning();
  const [vision, orientation, team, planned, other] = meetingRows;
  for (const meeting of meetingRows) {
    const author = meeting.churchId === owner.churchId ? owner : foreign;
    const person = author === owner ? people[0] : people[3];
    await db.insert(meetingAttendance).values({
      churchId: meeting.churchId,
      meetingId: meeting.id,
      personId: person.id,
      status: "attended",
      attendanceType: "core_group",
      createdBy: author.id,
    });
  }
  await db.insert(meetingAttendance).values([
    {
      churchId: owner.churchId!,
      meetingId: vision.id,
      personId: people[1].id,
      status: "absent",
      attendanceType: "first_time",
      createdBy: owner.id,
    },
    {
      churchId: owner.churchId!,
      meetingId: vision.id,
      personId: people[2].id,
      status: "excused",
      attendanceType: "returning",
      createdBy: owner.id,
    },
  ]);
  const checklist = await db
    .insert(meetingChecklistItems)
    .values(
      meetingRows.map((meeting) => ({
        churchId: meeting.churchId,
        meetingId: meeting.id,
        itemName: "Proof materials",
        category: "materials" as const,
      }))
    )
    .returning();
  const fixture = {
    database: database.pathname,
    password,
    accounts: accounts.map(({ id, email, seat }) => ({ id, email, seat })),
    meetings: Object.fromEntries(meetingRows.map((m) => [m.title, m.id])),
    personId: people[0].id,
    churches: plants.map((p) => p.id),
  };
  writeFileSync(output, JSON.stringify(fixture, null, 2), { mode: 0o600 });

  const row = async () =>
    (
      await db
        .select()
        .from(meetingAttendance)
        .where(
          and(
            eq(meetingAttendance.meetingId, vision.id),
            eq(meetingAttendance.personId, people[0].id)
          )
        )
    )[0];
  actor = owner;
  const before = await row();
  const [cardBefore] = await db
    .insert(meetingResponses)
    .values({
      churchId: owner.churchId!,
      meetingId: vision.id,
      personId: people[0].id,
      responseType: "interested",
    })
    .returning();
  for (const status of ["confirmed", "declined", "pending"]) {
    assert.deepEqual(
      await actions.updateRsvpStatusAction(vision.id, people[0].id, status),
      { success: true, data: null }
    );
    const actual = await row();
    assert.equal(actual.responseStatus, status === "pending" ? null : status);
    assert.equal(actual.status, before.status);
    assert.equal(actual.attendanceType, before.attendanceType);
    assert.equal(actual.invitedById, before.invitedById);
    const [cardAfter] = await db
      .select()
      .from(meetingResponses)
      .where(eq(meetingResponses.id, cardBefore.id));
    assert.deepEqual(cardAfter, cardBefore);
  }
  assert.equal(
    (
      await actions.updateRsvpStatusAction(
        vision.id,
        people[0].id,
        "interested"
      )
    ).success,
    false
  );
  assert.equal(
    (await actions.updateRsvpStatusAction(other.id, people[3].id, "confirmed"))
      .success,
    false
  );
  assert.equal(
    (
      await actions.updateRsvpStatusAction(
        vision.id,
        crypto.randomUUID(),
        "confirmed"
      )
    ).success,
    false
  );
  actor = member;
  await assert.rejects(
    actions.updateRsvpStatusAction(vision.id, people[0].id, "confirmed"),
    { name: "SeatRefusalError" }
  );
  actor = null;
  await assert.rejects(
    actions.updateRsvpStatusAction(vision.id, people[0].id, "confirmed"),
    UnauthorizedError
  );
  assert.equal((await row()).responseStatus, null);
  console.log(
    "PASS RSVP choices/reset, invalid state, missing/foreign guest, Member and signed-out refusal; attendance preserved"
  );

  actor = owner;
  const form = new FormData();
  for (const key of [
    "attendanceScore",
    "locationScore",
    "logisticsScore",
    "agendaScore",
    "vibeScore",
    "messageScore",
    "closeScore",
    "nextStepsScore",
  ])
    form.set(key, "4");
  for (const meeting of [orientation, team, planned, other]) {
    assert.equal(
      (await actions.createEvaluationAction(meeting.id, form)).success,
      false
    );
    assert.equal(
      (
        await db
          .select()
          .from(meetingEvaluations)
          .where(eq(meetingEvaluations.meetingId, meeting.id))
      ).length,
      0
    );
  }
  assert.equal(
    (await actions.createEvaluationAction(vision.id, new FormData())).success,
    false
  );
  actor = member;
  assert.equal(
    (await actions.createEvaluationAction(vision.id, form)).success,
    false
  );
  actor = owner;
  assert.equal(
    (await actions.createEvaluationAction(vision.id, form)).success,
    true
  );
  for (const meeting of [orientation, team, other]) {
    const item = checklist.find((c) => c.meetingId === meeting.id)!;
    assert.equal(
      (await actions.toggleChecklistItemAction(item.id, true)).success,
      false
    );
    assert.equal(
      (
        await db
          .select()
          .from(meetingChecklistItems)
          .where(eq(meetingChecklistItems.id, item.id))
      )[0].isChecked,
      false
    );
    assert.equal(
      (
        await actions.recordResponseCardAction(meeting.id, {
          personId: meeting === other ? people[3].id : people[0].id,
          responseType: "interested",
        })
      ).success,
      false
    );
    assert.equal(
      (await actions.clearResponseCardAction(meeting.id, people[0].id)).success,
      false
    );
    assert.equal(
      (
        await db
          .select()
          .from(meetingResponses)
          .where(eq(meetingResponses.meetingId, meeting.id))
      ).length,
      0
    );
  }
  assert.equal(
    (await actions.toggleChecklistItemAction(checklist[0].id, true)).success,
    true
  );
  assert.equal(
    (
      await actions.recordResponseCardAction(vision.id, {
        personId: people[0].id,
        responseType: "interested",
      })
    ).success,
    true
  );
  assert.equal(
    (await actions.clearResponseCardAction(vision.id, people[0].id)).success,
    true
  );
  console.log(
    "PASS actual action/DB Vision type/status guards, valid evaluation/checklist/card writes, no foreign or invalid writes"
  );

  const detail = (await getMeeting(owner.churchId!, vision.id))!;
  assert.equal(detail.totalAttendees, 1);
  assert.equal(detail.newAttendees, 0);
  assert.equal(detail.returningAttendees, 0);
  assert.deepEqual(await getAttendanceSummary(owner.churchId!, vision.id), {
    total: 1,
    firstTime: 0,
    returning: 0,
    coreGroup: 1,
  });
  await db
    .update(churchMeetings)
    .set({ actualAttendance: 95 })
    .where(eq(churchMeetings.id, vision.id));
  assert.equal(
    (await getMeeting(owner.churchId!, vision.id))!.actualAttendance,
    95
  );
  assert.equal(
    (await getAttendanceSummary(owner.churchId!, vision.id)).total,
    1
  );
  await finalizeAttendance(owner.churchId!, vision.id);
  assert.equal(
    (await getMeeting(owner.churchId!, vision.id))!.actualAttendance,
    1
  );
  await finalizeAttendance(owner.churchId!, vision.id);
  assert.equal(
    (await getMeeting(owner.churchId!, vision.id))!.actualAttendance,
    1
  );
  console.log(
    "PASS absent/excused guests excluded from attendance totals; sparse aggregate mismatch reproduced and supported finalize reconciles/replays"
  );
  console.log(
    "PASS fixture saved privately for browser proof; remove the owned database after review"
  );
}
main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
