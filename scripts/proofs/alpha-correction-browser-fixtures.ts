import assert from "node:assert/strict";
import { writeFileSync } from "node:fs";
import { randomUUID, randomBytes } from "node:crypto";
import { db } from "@/db";
import {
  churches,
  users,
  persons,
  assessments,
  interviews,
  commitments,
  ministryTeams,
  teamRoles,
  teamMemberships,
  trainingPrograms,
  trainingCompletions,
  locations,
  churchMeetings,
  coachAssignments,
} from "@/db/schema";
import { hashPassword } from "@/lib/auth/password";
import { sql } from "drizzle-orm";
async function main() {
  assert.equal(process.env.EVERYFIELD_OWNED_PREVIEW, "1");
  const target = new URL(process.env.DATABASE_URL!);
  assert.equal(target.hostname, "localhost");
  assert.match(target.pathname, /^\/ef_preview_[a-f0-9]{12}$/);
  const identity = await db.execute(sql`select current_database() as name`);
  assert.equal(identity.rows[0].name, target.pathname.slice(1));
  const output = process.argv[2];
  assert(output, "Private manifest path required");
  const namespace = randomUUID();
  const password = randomBytes(24).toString("base64url");
  const passwordHash = await hashPassword(password);
  const [plant] = await db
    .insert(churches)
    .values({
      name: `Alpha correction ${namespace}`,
      currentPhase: 2,
      onboardingCompletedAt: new Date(),
      leadershipStatus: "planter_confirmed",
    })
    .returning();
  const [foreign] = await db
    .insert(churches)
    .values({
      name: `Alpha foreign ${namespace}`,
      currentPhase: 2,
      onboardingCompletedAt: new Date(),
      leadershipStatus: "planter_confirmed",
    })
    .returning();
  const accounts: Record<string, { id: string; email: string }> = {};
  for (const role of [
    "owner",
    "admin",
    "member",
    "foreign-owner",
    "coach",
  ] as const) {
    const [user] = await db
      .insert(users)
      .values({
        name: `Alpha ${role}`,
        email: `alpha-${role}-${namespace}@example.test`,
        passwordHash,
        seat:
          role === "coach" ? null : role === "foreign-owner" ? "owner" : role,
        churchId:
          role === "coach"
            ? null
            : role === "foreign-owner"
              ? foreign.id
              : plant.id,
      })
      .returning();
    accounts[role] = { id: user.id, email: user.email };
  }
  await db.insert(coachAssignments).values({
    coachUserId: accounts.coach.id,
    churchId: plant.id,
    status: "active",
  });
  const [person] = await db
    .insert(persons)
    .values({
      churchId: plant.id,
      firstName: "Alpha",
      lastName: "Correction Browser",
      status: "launch_team",
      createdBy: accounts.owner.id,
    })
    .returning();
  const [assessment] = await db
    .insert(assessments)
    .values({
      churchId: plant.id,
      personId: person.id,
      assessedBy: accounts.owner.id,
      committedScore: 1,
      compelledScore: 1,
      contagiousScore: 1,
      courageousScore: 1,
      totalScore: 4,
      assessmentDate: "2026-09-01",
      committedNotes: "Original assessment",
    })
    .returning();
  const [interview] = await db
    .insert(interviews)
    .values({
      churchId: plant.id,
      personId: person.id,
      interviewedBy: accounts.owner.id,
      interviewDate: "2026-09-01",
      maturityStatus: "pass",
      giftedStatus: "pass",
      chemistryStatus: "pass",
      rightReasonsStatus: "pass",
      seasonStatus: "pass",
      overallResult: "qualified",
      nextSteps: "Original next step",
    })
    .returning();
  const [commitment] = await db
    .insert(commitments)
    .values({
      churchId: plant.id,
      personId: person.id,
      commitmentType: "launch_team",
      signedDate: "2026-09-01",
      witnessedBy: accounts.owner.id,
      notes: "Original commitment",
    })
    .returning();
  const [team] = await db
    .insert(ministryTeams)
    .values({
      churchId: plant.id,
      name: "Alpha correction team",
      description: "Original team description",
      type: "custom",
      status: "active",
      createdBy: accounts.owner.id,
    })
    .returning();
  const [role] = await db
    .insert(teamRoles)
    .values({
      churchId: plant.id,
      teamId: team.id,
      name: "Alpha learner",
      createdBy: accounts.owner.id,
    })
    .returning();
  await db.insert(teamMemberships).values({
    churchId: plant.id,
    teamId: team.id,
    roleId: role.id,
    personId: person.id,
    status: "active",
    createdBy: accounts.owner.id,
  });
  const [program] = await db
    .insert(trainingPrograms)
    .values({
      churchId: plant.id,
      teamId: team.id,
      name: "Alpha training",
      description: "Original training",
      isRequired: true,
      createdBy: accounts.owner.id,
    })
    .returning();
  await db.insert(trainingCompletions).values({
    churchId: plant.id,
    personId: person.id,
    trainingProgramId: program.id,
    completedAt: new Date(),
    verifiedBy: accounts.owner.id,
    createdBy: accounts.owner.id,
  });
  const [location] = await db
    .insert(locations)
    .values({
      churchId: plant.id,
      name: "Alpha correction venue",
      address: "123 Alpha Lane",
    })
    .returning();
  const [meeting] = await db
    .insert(churchMeetings)
    .values({
      churchId: plant.id,
      type: "vision_meeting",
      title: "Alpha correction Vision",
      datetime: new Date("2026-09-01T12:00:00Z"),
      status: "completed",
      locationId: location.id,
      locationName: location.name,
      locationAddress: location.address,
      createdBy: accounts.owner.id,
    })
    .returning();
  writeFileSync(
    output,
    JSON.stringify(
      {
        namespace,
        plantId: plant.id,
        foreignPlantId: foreign.id,
        accounts,
        password,
        personId: person.id,
        assessmentId: assessment.id,
        interviewId: interview.id,
        commitmentId: commitment.id,
        teamId: team.id,
        programId: program.id,
        locationId: location.id,
        meetingId: meeting.id,
      },
      null,
      2
    ),
    { mode: 0o600 }
  );
  console.log(
    "Owned correction browser fixtures created; credentials retained only in private manifest"
  );
}
void main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
