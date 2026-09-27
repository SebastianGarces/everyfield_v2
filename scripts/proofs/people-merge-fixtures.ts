import { db } from "@/db";
import { sql } from "drizzle-orm";
import * as schema from "@/db/schema";
import { personMergeReferences } from "@/lib/people/merge-references";

export async function seedMergeHistory(
  churchId: string,
  actorId: string,
  sourceId: string,
  survivorId: string,
  meetingId: string,
  communicationId: string
) {
  const common = { churchId, personId: sourceId };
  const [household] = await db
    .insert(schema.households)
    .values({ churchId, name: "Merge household" })
    .returning();
  await db.execute(
    sql`update persons set household_id=${household.id},household_role='head' where id=${sourceId}`
  );
  const tagRows = await db
    .insert(schema.tags)
    .values([
      { churchId, name: "Shared merge tag" },
      { churchId, name: "Distinct merge tag" },
    ])
    .returning();
  await db.insert(schema.personTags).values([
    { ...common, tagId: tagRows[0].id },
    { ...common, tagId: tagRows[1].id },
    { churchId, personId: survivorId, tagId: tagRows[0].id },
  ]);
  await db.insert(schema.assessments).values({
    ...common,
    assessedBy: actorId,
    committedScore: 4,
    compelledScore: 3,
    contagiousScore: 2,
    courageousScore: 1,
    totalScore: 10,
    assessmentDate: "2026-01-02",
    committedNotes: "Retain assessment detail",
  });
  await db.insert(schema.interviews).values({
    ...common,
    interviewedBy: actorId,
    interviewDate: "2026-01-03",
    maturityStatus: "pass",
    giftedStatus: "pass",
    chemistryStatus: "concern",
    rightReasonsStatus: "pass",
    seasonStatus: "pass",
    overallResult: "qualified_with_notes",
    chemistryNotes: "Retain interview detail",
  });
  await db.insert(schema.commitments).values({
    ...common,
    commitmentType: "core_group",
    signedDate: "2026-01-04",
    witnessedBy: actorId,
    documentUrl: "private-document-proof",
    notes: "Retain signed commitment",
  });
  await db.insert(schema.skillsInventory).values([
    {
      ...common,
      skillCategory: "worship",
      skillName: "Voice",
      notes: "Retain skill detail",
    },
    {
      ...common,
      skillCategory: "worship",
      skillName: "Voice",
      notes: "Separate historical skill row",
    },
  ]);
  await db.insert(schema.meetingAttendance).values({
    ...common,
    meetingId,
    invitedById: sourceId,
    status: "attended",
    responseStatus: "confirmed",
    notes: "Retain attendance detail",
    createdBy: actorId,
  });
  await db.insert(schema.meetingResponses).values({
    ...common,
    meetingId,
    responseType: "interested",
    recordedById: actorId,
    notes: "Retain card detail",
  });
  await db.insert(schema.invitations).values([
    {
      churchId,
      meetingId,
      inviterId: sourceId,
      inviteeId: sourceId,
      inviteeName: "Existing self-reference",
    },
    {
      churchId,
      meetingId,
      inviterId: sourceId,
      inviteeId: null,
      inviteeName: "Unlinked guest",
    },
  ]);
  await db.insert(schema.meetingChecklistItems).values({
    churchId,
    meetingId,
    itemName: "Retain checklist detail",
    category: "materials",
    assignedTo: sourceId,
  });
  const [team] = await db
    .insert(schema.ministryTeams)
    .values({
      churchId,
      name: "Merge history team",
      type: "custom",
      leaderId: sourceId,
      leaderSource: "explicit",
      createdBy: actorId,
    })
    .returning();
  const [role] = await db
    .insert(schema.teamRoles)
    .values({
      churchId,
      teamId: team.id,
      name: "History role",
      createdBy: actorId,
    })
    .returning();
  await db.insert(schema.teamMemberships).values({
    ...common,
    teamId: team.id,
    roleId: role.id,
    createdBy: actorId,
    startDate: "2026-01-05",
    notes: "Retain role detail",
  });
  const [training] = await db
    .insert(schema.trainingPrograms)
    .values({
      churchId,
      teamId: team.id,
      name: "Merge training",
      createdBy: actorId,
    })
    .returning();
  await db.insert(schema.trainingCompletions).values({
    ...common,
    trainingProgramId: training.id,
    completedAt: new Date("2026-01-06"),
    verifiedBy: actorId,
    createdBy: actorId,
    notes: "Retain training detail",
  });
  await db.insert(schema.communicationRecipients).values({
    ...common,
    communicationId,
    email: "original-delivery@example.test",
    status: "bounced",
    externalId: crypto.randomUUID(),
    errorMessage: "Historical bounce",
  });
  await db.insert(schema.meetingConfirmationTokens).values({
    ...common,
    meetingId,
    token: crypto.randomUUID(),
    status: "confirmed",
    respondedAt: new Date("2026-01-07"),
    expiresAt: new Date("2026-01-08"),
  });
  await db.insert(schema.tasks).values({
    churchId,
    title: "Merge history task",
    createdById: actorId,
    relatedType: "person",
    relatedId: sourceId,
    category: "follow_up",
    dueDate: "2026-01-09",
  });
  await db.insert(schema.notifications).values({
    churchId,
    recipientUserId: actorId,
    category: "tasks",
    type: "task.assigned",
    title: "Retained notification",
    body: "Immutable notification copy",
    entityType: "person",
    entityId: sourceId,
  });
  return {
    householdId: household.id,
    teamId: team.id,
    trainingId: training.id,
  };
}

export async function referenceSnapshot(sourceId: string, survivorId: string) {
  const tables = [...new Set(personMergeReferences.map((ref) => ref.table))];
  const queries = tables.map((table) => {
    const references = personMergeReferences.filter(
      (ref) => ref.table === table
    );
    return db.execute<{ id: string; row: Record<string, unknown> }>(
      sql`select id,to_jsonb(t) as row from ${sql.identifier(table)} t where ${sql.join(
        references.map(
          (ref) =>
            sql`${sql.identifier(ref.column)} in (${sourceId},${survivorId})`
        ),
        sql` or `
      )} order by id`
    );
  });
  const [first, ...rest] = queries;
  const results = await db.batch([first, ...rest]);
  return tables.map((table, index) => ({
    table,
    references: personMergeReferences.filter((ref) => ref.table === table),
    rows: results[index].rows,
  }));
}
