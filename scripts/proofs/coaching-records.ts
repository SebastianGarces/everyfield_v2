/** Owned database proof and browser fixtures. Run once per fresh preview stack. */
import assert from "node:assert/strict";
import { readFileSync, writeFileSync } from "node:fs";
import { hash } from "@node-rs/argon2";
import { and, eq, sql, isNull } from "drizzle-orm";
import { mock } from "node:test";
import { db } from "@/db";
import {
  churches,
  users,
  persons,
  tasks,
  churchMeetings,
  ministryTeams,
  teamRoles,
  teamMemberships,
  coachAssignments,
  churchPrivacySettings,
  planterCheckins,
  type User,
} from "@/db/schema";
import { readCoachedPlant, readCoachedCollection } from "@/lib/coaching/read";
import { readCoachedRecord } from "@/lib/coaching/record-read";
import { type CoachedCollection } from "@/lib/coaching/collections";
import { acceptCoachInvitationAs } from "@/lib/invitations/coach";
import { UnauthorizedError } from "@/lib/auth/unauthorized";

async function main() {
  const database = new URL(process.env.DATABASE_URL!);
  assert.equal(process.env.EVERYFIELD_OWNED_PREVIEW, "1");
  assert.equal(database.hostname, "localhost");
  assert.match(database.pathname, /^\/ef_preview_[a-f0-9]{12}$/);
  const identity = await db.execute<{ name: string }>(
    sql`select current_database() as name`
  );
  assert.equal(identity.rows[0].name, database.pathname.slice(1));
  const [input, output, evidencePath] = process.argv.slice(2);
  for (const path of [input, output, evidencePath])
    assert.ok(path?.startsWith("/private/tmp/"));
  const fixture = JSON.parse(readFileSync(input, "utf8"));
  assert.equal(fixture.database, identity.rows[0].name);
  const churchId: string = fixture.primaryChurchId;
  const foreignId: string = fixture.foreignChurchId;
  const [owner] = await db
    .select()
    .from(users)
    .where(eq(users.email, "owner@preview.example.test"));
  const [foreignOwner] = await db
    .select()
    .from(users)
    .where(eq(users.email, "foreign-owner@preview.example.test"));
  const [coach] = await db
    .insert(users)
    .values({
      name: "Invited coach",
      email: "coach-valid@example.test",
      passwordHash: await hash(fixture.password),
      seat: null,
    })
    .returning();
  const token = new URL(
    fixture.paths.validCoachInvitation,
    "http://local.test"
  ).searchParams.get("invitation");
  await acceptCoachInvitationAs({ id: coach.id, email: coach.email }, token);
  assert.equal(coach.churchId, null);
  assert.equal(coach.seat, null);
  assert.equal(coach.sendingChurchId, null);
  assert.equal(coach.sendingNetworkId, null);
  const [emptyPlant] = await db
    .insert(churches)
    .values({ name: "Coach empty plant", onboardingCompletedAt: new Date() })
    .returning();
  await db.insert(coachAssignments).values([
    { coachUserId: coach.id, churchId: emptyPlant.id },
    { coachUserId: foreignOwner.id, churchId },
  ]);
  await db
    .insert(churchPrivacySettings)
    .values({ churchId })
    .onConflictDoUpdate({
      target: churchPrivacySettings.churchId,
      set: {
        sharePeople: false,
        shareTasks: false,
        shareMeetings: false,
        shareFinancials: false,
        shareMinistryTeams: false,
        shareFacilities: false,
        shareWiki: false,
      },
    });
  const count = 60;
  await db.insert(persons).values(
    Array.from({ length: count }, () => ({
      churchId,
      firstName: "Tied",
      lastName: "Coach contact",
      createdBy: owner.id,
    }))
  );
  await db.insert(tasks).values(
    Array.from({ length: count }, () => ({
      churchId,
      title: "Tied coach task",
      createdById: owner.id,
    }))
  );
  await db.insert(churchMeetings).values(
    Array.from({ length: count }, () => ({
      churchId,
      title: "Tied coach meeting",
      type: "orientation" as const,
      datetime: new Date("2026-11-01T10:00:00Z"),
      createdBy: owner.id,
    }))
  );
  const teams = await db
    .insert(ministryTeams)
    .values(
      Array.from({ length: count }, (_, i) => ({
        churchId,
        name: i === 0 ? "Coach proof team" : "Tied coach team",
        type: "custom" as const,
        description: "Read-only team description",
        createdBy: owner.id,
      }))
    )
    .returning({ id: ministryTeams.id });
  const [foreignTeam] = await db
    .insert(ministryTeams)
    .values({
      churchId: foreignId,
      name: "Foreign team must stay hidden",
      type: "custom",
      createdBy: foreignOwner.id,
    })
    .returning();
  const [role] = await db
    .insert(teamRoles)
    .values({
      churchId,
      teamId: teams[0].id,
      name: "Welcome lead",
      description: "Welcome people",
      createdBy: owner.id,
    })
    .returning();
  await db.insert(teamMemberships).values({
    churchId,
    teamId: teams[0].id,
    roleId: role.id,
    personId: fixture.primaryPersonId,
    status: "active",
    createdBy: owner.id,
  });
  await db.insert(tasks).values({
    churchId,
    title: "Prepare welcome cards",
    description: "Use the recorded checklist",
    parentTaskId: fixture.primaryTaskId,
    createdById: owner.id,
  });
  await db
    .update(tasks)
    .set({
      description:
        "<p>Read-only <strong>task description</strong></p><ul><li>First item</li></ul>",
      dueDate: "2026-11-05",
    })
    .where(eq(tasks.id, fixture.primaryTaskId));
  const storageCanary = "PRIVATE_STORAGE_KEY_DO_NOT_EXPOSE";
  const checkinCanary = "PERSONAL_CHECKIN_DO_NOT_EXPOSE";
  await db
    .update(persons)
    .set({ photoUrl: storageCanary, notes: "Ordinary profile notes" })
    .where(eq(persons.id, fixture.primaryPersonId));
  await db.insert(planterCheckins).values({
    churchId,
    weekStart: "2026-09-21",
    spiritually: "steady",
    marriageFamily: "steady",
    financially: "steady",
    pace: "steady",
    note: checkinCanary,
    answeredById: owner.id,
  });

  const collections: CoachedCollection[] = [
    "people",
    "tasks",
    "meetings",
    "teams",
  ];
  const expected = {
    people: (
      await db
        .select({ id: persons.id })
        .from(persons)
        .where(and(eq(persons.churchId, churchId), isNull(persons.deletedAt)))
    ).map((row) => row.id),
    tasks: (
      await db
        .select({ id: tasks.id })
        .from(tasks)
        .where(
          and(
            eq(tasks.churchId, churchId),
            isNull(tasks.deletedAt),
            isNull(tasks.parentTaskId)
          )
        )
    ).map((row) => row.id),
    meetings: (
      await db
        .select({ id: churchMeetings.id })
        .from(churchMeetings)
        .where(eq(churchMeetings.churchId, churchId))
    ).map((row) => row.id),
    teams: teams.map((row) => row.id),
  };
  const detailIds = {
    people: fixture.primaryPersonId,
    tasks: fixture.primaryTaskId,
    meetings: fixture.planningMeetingId,
    teams: teams[0].id,
  };
  const [foreignPerson] = await db
    .select({ id: persons.id })
    .from(persons)
    .where(eq(persons.churchId, foreignId))
    .limit(1);
  const [foreignTask] = await db
    .select({ id: tasks.id })
    .from(tasks)
    .where(eq(tasks.churchId, foreignId))
    .limit(1);
  const [foreignMeeting] = await db
    .select({ id: churchMeetings.id })
    .from(churchMeetings)
    .where(eq(churchMeetings.churchId, foreignId))
    .limit(1);
  const foreignRecords = {
    people: foreignPerson.id,
    tasks: foreignTask.id,
    meetings: foreignMeeting.id,
    teams: foreignTeam.id,
  };
  const results = [];
  for (const collection of collections) {
    const ids: string[] = [];
    let pages = 0;
    for (let page = 1; ; page++) {
      const result = await readCoachedCollection(
        coach,
        churchId,
        collection,
        page
      );
      assert.ok(result);
      assert.ok(result.rows.length <= 25);
      ids.push(...result.rows.map((row) => row.id));
      pages++;
      if (!result.hasNext) break;
      assert.ok(page < 10);
    }
    assert.ok(pages > 2);
    assert.equal(new Set(ids).size, ids.length);
    assert.deepEqual(new Set(ids), new Set(expected[collection]));
    const empty = await readCoachedCollection(
      coach,
      emptyPlant.id,
      collection,
      1
    );
    assert.ok(empty);
    assert.equal(empty.rows.length, 0);
    assert.equal(empty.hasNext, false);
    assert.equal(
      await readCoachedCollection(coach, foreignId, collection, 1),
      null
    );
    assert.equal(
      await readCoachedRecord(
        coach,
        churchId,
        collection,
        foreignRecords[collection]
      ),
      null
    );
    assert.equal(
      await readCoachedRecord(coach, churchId, collection, crypto.randomUUID()),
      null
    );
    assert.equal(
      await readCoachedRecord(coach, churchId, collection, "invalid"),
      null
    );
    const detail = await readCoachedRecord(
      coach,
      churchId,
      collection,
      detailIds[collection]
    );
    assert.ok(detail);
    const serialized = JSON.stringify(detail);
    for (const forbidden of [
      storageCanary,
      checkinCanary,
      "passwordHash",
      "userId",
      "photoUrl",
    ])
      assert.ok(!serialized.includes(forbidden));
    assert.ok(
      await readCoachedRecord(
        foreignOwner,
        churchId,
        collection,
        detailIds[collection]
      )
    );
    results.push({
      collection,
      pages,
      rows: ids.length,
      empty: true,
      foreignAndMissingRefused: true,
      mixedTenancyCoach: true,
      privateFieldsAbsent: true,
    });
  }
  const profile = await readCoachedRecord(
    coach,
    churchId,
    "people",
    fixture.primaryPersonId
  );
  assert.ok(profile?.kind === "people");
  assert.ok(profile.tags.length);
  assert.ok(profile.skills.length);
  assert.ok(profile.person.householdName);
  const task = await readCoachedRecord(
    coach,
    churchId,
    "tasks",
    fixture.primaryTaskId
  );
  assert.ok(task?.kind === "tasks");
  assert.equal(task.steps.length, 1);
  await db
    .update(coachAssignments)
    .set({ status: "inactive" })
    .where(
      and(
        eq(coachAssignments.coachUserId, coach.id),
        eq(coachAssignments.churchId, churchId)
      )
    );
  assert.equal(await readCoachedPlant(coach, churchId), null);
  for (const collection of collections) {
    assert.equal(
      await readCoachedCollection(coach, churchId, collection, 1),
      null
    );
    assert.equal(
      await readCoachedRecord(
        coach,
        churchId,
        collection,
        detailIds[collection]
      ),
      null
    );
  }
  await db
    .update(coachAssignments)
    .set({ status: "active" })
    .where(
      and(
        eq(coachAssignments.coachUserId, coach.id),
        eq(coachAssignments.churchId, churchId)
      )
    );

  let actor: User = coach;
  mock.module("@/lib/auth/session", {
    namedExports: { verifySession: async () => ({ user: actor }) },
  });
  mock.module("next/cache", {
    namedExports: { refresh() {}, revalidatePath() {} },
  });
  mock.module("next/navigation", {
    namedExports: {
      redirect() {
        throw new UnauthorizedError();
      },
    },
  });
  const { quickAddTaskAction, completeTaskAction } =
    await import("@/app/(dashboard)/tasks/actions");
  const form = new FormData();
  form.set("title", "Forbidden coach mutation");
  await assert.rejects(() => quickAddTaskAction(form), /Forbidden/);
  await assert.rejects(
    () => completeTaskAction(fixture.primaryTaskId),
    /Forbidden/
  );
  actor = foreignOwner;
  const denied = await completeTaskAction(fixture.primaryTaskId);
  assert.equal(denied.success, false);
  const [unchanged] = await db
    .select({ status: tasks.status })
    .from(tasks)
    .where(eq(tasks.id, fixture.primaryTaskId));
  assert.equal(unchanged.status, "not_started");
  writeFileSync(
    output,
    JSON.stringify(
      {
        database: identity.rows[0].name,
        email: coach.email,
        password: fixture.password,
        churchId,
        foreignId,
        emptyPlantId: emptyPlant.id,
        detailIds,
        foreignRecords,
        coachId: coach.id,
        storageCanary,
        checkinCanary,
      },
      null,
      2
    ) + "\n",
    { mode: 0o600 }
  );
  writeFileSync(
    evidencePath,
    JSON.stringify(
      {
        collections: results,
        acceptedInvitation: true,
        coachHasNoSeatOrTenancy: true,
        allSharingOff: true,
        endedAssignmentRefused: true,
        coachWriteRefused: true,
        otherPlantOwnerCannotWriteCoachedTask: true,
      },
      null,
      2
    ) + "\n",
    { mode: 0o600 }
  );
  console.log(
    "Coaching proof passed: all pages, four details, privacy and authorization; private browser fixtures written."
  );
}
main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
