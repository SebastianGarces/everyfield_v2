import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { mock } from "node:test";

import { and, eq } from "drizzle-orm";

import { db } from "@/db";
import {
  churches,
  churchMeetings,
  locations,
  ministryTeams,
  personActivities,
  persons,
  sessions,
  teamMemberships,
  teamResponsibilities,
  teamRoles,
  trainingCompletions,
  trainingPrograms,
  users,
} from "@/db/schema";
import { UnauthorizedError } from "@/lib/auth/unauthorized";
import {
  getRoleTemplates,
  playbookResponsibilities,
} from "@/lib/ministry-teams/role-templates";

type SessionUser = Readonly<{
  id: string;
  churchId: string | null;
  sendingChurchId: string | null;
  sendingNetworkId: string | null;
  seat: "owner" | "admin" | "member" | null;
}>;

const SCRATCH = "__evry teams live proof__";
const FIXTURE_SESSION_ID = "7".repeat(64);
let sessionUser: SessionUser | null = null;

mock.module("@/lib/auth/session", {
  namedExports: {
    verifySession: async () => {
      if (!sessionUser) throw new Error("Unauthorized");
      return { user: sessionUser };
    },
    verifyFreshSession: async () => {
      if (!sessionUser) throw new UnauthorizedError();
      const [fresh] = await db
        .select({
          session: sessions,
          user: {
            id: users.id,
            churchId: users.churchId,
            sendingChurchId: users.sendingChurchId,
            sendingNetworkId: users.sendingNetworkId,
            seat: users.seat,
          },
        })
        .from(sessions)
        .innerJoin(users, eq(sessions.userId, users.id))
        .where(eq(sessions.id, FIXTURE_SESSION_ID))
        .limit(1);
      if (!fresh || fresh.session.expiresAt <= new Date())
        throw new UnauthorizedError();
      return fresh;
    },
  },
});

async function response(
  post: (
    request: Request,
    context: { params: Promise<{ planId: string }> }
  ) => Promise<Response>,
  plan: { planId: string; fingerprint: string }
) {
  const result = await post(
    new Request(`http://localhost/api/evry/plans/${plan.planId}/execute`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ fingerprint: plan.fingerprint }),
    }),
    { params: Promise.resolve({ planId: plan.planId }) }
  );
  return { status: result.status, body: await result.json() };
}

async function main(): Promise<void> {
  let plantId: string | null = null;
  let actorId: string | null = null;
  try {
    const [plant] = await db
      .insert(churches)
      .values({ name: SCRATCH, leadershipStatus: "planter_confirmed" })
      .returning({ id: churches.id });
    plantId = plant.id;
    const [actor] = await db
      .insert(users)
      .values({
        email: `${randomUUID()}@teams-proof.invalid`,
        passwordHash: "scratch",
        name: SCRATCH,
        seat: "owner",
        churchId: plantId,
      })
      .returning({ id: users.id });
    actorId = actor.id;
    await db.insert(sessions).values({
      id: FIXTURE_SESSION_ID,
      userId: actorId,
      expiresAt: new Date(Date.now() + 3_600_000),
    });
    sessionUser = {
      id: actorId,
      churchId: plantId,
      sendingChurchId: null,
      sendingNetworkId: null,
      seat: "owner",
    };
    const [
      { resolveTeamsEvryEffect },
      { proposeTeamsEvryEffect, TEAMS_EXECUTION_REGISTRY },
      planRepository,
      plans,
      route,
      viewer,
    ] = await Promise.all([
      import("./resolver"),
      import("./runtime"),
      import("@/lib/evry/plans/repository"),
      import("@/lib/evry/plans"),
      import("@/app/api/evry/plans/[planId]/execute/route"),
      import("@/lib/evry/eligibility/viewer"),
    ]);
    const actorRef = await viewer.requireEvryPlantViewer();
    const post = route.createEvryPlanExecutePost({
      registry: TEAMS_EXECUTION_REGISTRY,
    });

    async function approve(
      selection: Parameters<typeof resolveTeamsEvryEffect>[0]["selection"]
    ) {
      const plannedAt = new Date();
      const resolved = await resolveTeamsEvryEffect({
        actor: actorRef,
        selection,
        now: plannedAt,
      });
      assert.ok(resolved, `resolved ${selection.operation}`);
      const proposed = await proposeTeamsEvryEffect({
        actor: actorRef,
        resolved,
        requestKey: plans.mintEvryPlanRequestKey(),
      });
      assert.ok(proposed, `proposed ${selection.operation}`);
      const confirmed = await planRepository.confirmExactEvryActionPlan({
        planId: proposed.plan.planId,
        actorUserId: actorId!,
        plantId: plantId!,
        fingerprint: proposed.plan.fingerprint,
        decidedAt: new Date(plannedAt.getTime() + 1),
      });
      assert.equal(confirmed.status, "approved");
      return proposed.plan;
    }

    const create = await approve({
      kind: "effect",
      operation: "createTeamAction",
      values: { name: "Live Team", description: "Exact" },
    });
    const double = await Promise.all([
      response(post, create),
      response(post, create),
    ]);
    assert.deepEqual(
      double.map(({ status }) => status),
      [200, 200]
    );
    let created = await db
      .select()
      .from(ministryTeams)
      .where(
        and(
          eq(ministryTeams.churchId, plantId),
          eq(ministryTeams.name, "Live Team")
        )
      );
    assert.equal(
      created.length,
      1,
      "idempotent double execution creates one team"
    );

    const updateRacePlans = await Promise.all([
      approve({
        kind: "effect",
        operation: "updateTeamAction",
        values: { teamId: created[0]!.id, name: "Update Winner A" },
      }),
      approve({
        kind: "effect",
        operation: "updateTeamAction",
        values: { teamId: created[0]!.id, name: "Update Winner B" },
      }),
    ]);
    const updateRace = await Promise.all(
      updateRacePlans.map((plan) => response(post, plan))
    );
    assert.deepEqual(
      updateRace.map(({ status }) => status).toSorted(),
      [200, 409]
    );
    const [updatedCreated] = await db
      .select()
      .from(ministryTeams)
      .where(eq(ministryTeams.id, created[0]!.id));
    created = [updatedCreated!];
    assert.ok(
      ["Update Winner A", "Update Winner B"].includes(created[0]!.name)
    );

    const drift = await approve({
      kind: "effect",
      operation: "updateTeamAction",
      values: { teamId: created[0]!.id, name: "Planned Name" },
    });
    await db
      .update(ministryTeams)
      .set({ description: "concurrent drift" })
      .where(eq(ministryTeams.id, created[0]!.id));
    assert.equal((await response(post, drift)).status, 409);
    const [notOverwritten] = await db
      .select()
      .from(ministryTeams)
      .where(eq(ministryTeams.id, created[0]!.id));
    assert.equal(notOverwritten.name, created[0]!.name);

    const seatPlan = await approve({
      kind: "effect",
      operation: "createTeamAction",
      values: { name: "Must Not Land" },
    });
    await db.update(users).set({ seat: "member" }).where(eq(users.id, actorId));
    assert.equal((await response(post, seatPlan)).status, 409);
    assert.equal(
      (
        await db
          .select()
          .from(ministryTeams)
          .where(
            and(
              eq(ministryTeams.churchId, plantId),
              eq(ministryTeams.name, "Must Not Land")
            )
          )
      ).length,
      0
    );
    await db.update(users).set({ seat: "owner" }).where(eq(users.id, actorId));

    const [predefined] = await db
      .insert(ministryTeams)
      .values({
        churchId: plantId,
        name: "Worship",
        templateKey: "worship",
        type: "predefined",
        description: "Live seed proof",
        createdBy: actorId,
      })
      .returning();
    const responsibilityPlans = await Promise.all([
      approve({
        kind: "effect",
        operation: "initializeResponsibilities",
        values: { teamId: predefined.id },
      }),
      approve({
        kind: "effect",
        operation: "initializeResponsibilities",
        values: { teamId: predefined.id },
      }),
    ]);
    const responsibilityRace = await Promise.all(
      responsibilityPlans.map((plan) => response(post, plan))
    );
    assert.deepEqual(
      responsibilityRace.map(({ status }) => status).toSorted(),
      [200, 409]
    );
    const responsibilityWinner =
      responsibilityPlans[
        responsibilityRace.findIndex(({ status }) => status === 200)
      ]!;
    assert.equal((await response(post, responsibilityWinner)).status, 200);
    assert.equal(
      (
        await db
          .select()
          .from(teamResponsibilities)
          .where(eq(teamResponsibilities.teamId, predefined.id))
      ).length,
      playbookResponsibilities("worship").length,
      "one confirmed first-view seed wins and its replay is complete"
    );
    assert.ok(
      (
        await db
          .select()
          .from(ministryTeams)
          .where(eq(ministryTeams.id, predefined.id))
      )[0]?.responsibilitiesSeededAt
    );

    const roleImportPlans = await Promise.all([
      approve({
        kind: "effect",
        operation: "importRoleTemplatesAction",
        values: { teamId: predefined.id, teamKey: "worship" },
      }),
      approve({
        kind: "effect",
        operation: "importRoleTemplatesAction",
        values: { teamId: predefined.id, teamKey: "worship" },
      }),
    ]);
    const roleImportRace = await Promise.all(
      roleImportPlans.map((plan) => response(post, plan))
    );
    assert.deepEqual(
      roleImportRace.map(({ status }) => status).toSorted(),
      [200, 409]
    );
    assert.equal(
      (
        await db
          .select()
          .from(teamRoles)
          .where(eq(teamRoles.teamId, predefined.id))
      ).length,
      getRoleTemplates("worship").length,
      "the same-baseline bulk import commits exactly one template set"
    );

    const [responsibilityToDelete] = await db
      .select()
      .from(teamResponsibilities)
      .where(eq(teamResponsibilities.teamId, predefined.id))
      .limit(1);
    const deleteResponsibilityPlan = await approve({
      kind: "effect",
      operation: "deleteResponsibilityAction",
      values: { responsibilityId: responsibilityToDelete.id },
    });
    assert.equal((await response(post, deleteResponsibilityPlan)).status, 200);
    assert.equal(
      (
        await db
          .select()
          .from(teamResponsibilities)
          .where(eq(teamResponsibilities.id, responsibilityToDelete.id))
      ).length,
      0
    );

    const meetingPlan = await approve({
      kind: "effect",
      operation: "createMeetingAction",
      values: {
        teamId: created[0]!.id,
        title: "Live Rehearsal",
        datetime: "2031-02-03T18:30",
        timezone: "America/New_York",
        locationName: "Room 201",
        meetingSubtype: "rehearsal",
      },
    });
    assert.equal((await response(post, meetingPlan)).status, 200);
    const [meeting] = await db
      .select()
      .from(churchMeetings)
      .where(eq(churchMeetings.title, "Live Rehearsal"));
    assert.deepEqual(meeting.agenda, []);
    const [savedLocation] = await db
      .select()
      .from(locations)
      .where(eq(locations.id, meeting.locationId!));
    assert.equal(savedLocation.name, "Room 201");
    assert.equal(savedLocation.address, "");

    const [historyRole] = await db
      .insert(teamRoles)
      .values({
        churchId: plantId,
        teamId: created[0]!.id,
        name: "History Seat",
        createdBy: actorId,
      })
      .returning();
    const [historyPerson] = await db
      .insert(persons)
      .values({
        churchId: plantId,
        firstName: "History",
        lastName: "Candidate",
        status: "core_group",
        createdBy: actorId,
      })
      .returning();
    const histories = await db
      .insert(teamMemberships)
      .values([
        {
          churchId: plantId,
          teamId: created[0]!.id,
          roleId: historyRole.id,
          personId: historyPerson.id,
          status: "inactive",
          startDate: "2029-01-01",
          endDate: "2029-01-02",
          createdBy: actorId,
          createdAt: new Date("2029-01-01T00:00:00.000Z"),
        },
        {
          churchId: plantId,
          teamId: created[0]!.id,
          roleId: historyRole.id,
          personId: historyPerson.id,
          status: "inactive",
          startDate: "2030-01-01",
          endDate: "2030-01-02",
          createdBy: actorId,
          createdAt: new Date("2030-01-01T00:00:00.000Z"),
        },
      ])
      .returning();
    const historyPlan = await approve({
      kind: "effect",
      operation: "assignMemberAction",
      values: {
        teamId: created[0]!.id,
        roleId: historyRole.id,
        personId: historyPerson.id,
      },
    });
    assert.equal((await response(post, historyPlan)).status, 200);
    const afterHistory = await db
      .select()
      .from(teamMemberships)
      .where(eq(teamMemberships.roleId, historyRole.id));
    assert.equal(
      afterHistory.find(({ id }) => id === histories[0]!.id)?.status,
      "inactive"
    );
    const reactivated = afterHistory.find(({ id }) => id === histories[1]!.id);
    assert.equal(reactivated?.status, "active");
    assert.equal(
      reactivated?.startDate,
      null,
      "an omitted start date matches the interface's NULL"
    );

    const trainingProgramPlan = await approve({
      kind: "effect",
      operation: "createTrainingProgramAction",
      values: {
        teamId: created[0]!.id,
        name: "Live Safety",
        isRequired: "true",
      },
    });
    assert.equal((await response(post, trainingProgramPlan)).status, 200);
    const [program] = await db
      .select()
      .from(trainingPrograms)
      .where(eq(trainingPrograms.name, "Live Safety"));
    const trainingCompletionPlan = await approve({
      kind: "effect",
      operation: "markTrainingCompleteAction",
      values: { programId: program.id, personId: historyPerson.id },
    });
    assert.equal((await response(post, trainingCompletionPlan)).status, 200);
    assert.equal(
      (
        await db
          .select()
          .from(trainingCompletions)
          .where(
            and(
              eq(trainingCompletions.trainingProgramId, program.id),
              eq(trainingCompletions.personId, historyPerson.id)
            )
          )
      ).length,
      1,
      "the association-add shape creates one verified completion"
    );

    const removeHistoryPlan = await approve({
      kind: "effect",
      operation: "removeMemberAction",
      values: { membershipId: reactivated!.id },
    });
    assert.equal((await response(post, removeHistoryPlan)).status, 200);
    const [removedHistory] = await db
      .select()
      .from(teamMemberships)
      .where(eq(teamMemberships.id, reactivated!.id));
    assert.equal(removedHistory.status, "inactive");
    assert.equal(
      (
        await db
          .select()
          .from(teamRoles)
          .where(eq(teamRoles.id, historyRole.id))
      )[0]?.status,
      "open"
    );

    const [role] = await db
      .insert(teamRoles)
      .values({
        churchId: plantId,
        teamId: created[0]!.id,
        name: "Race Seat",
        createdBy: actorId,
      })
      .returning();
    const people = await db
      .insert(persons)
      .values([
        {
          churchId: plantId,
          firstName: "First",
          lastName: "Candidate",
          status: "core_group",
          createdBy: actorId,
        },
        {
          churchId: plantId,
          firstName: "Second",
          lastName: "Candidate",
          status: "core_group",
          createdBy: actorId,
        },
      ])
      .returning();
    const assignmentPlans = [];
    for (const person of people) {
      assignmentPlans.push(
        await approve({
          kind: "effect",
          operation: "assignMemberAction",
          values: {
            teamId: created[0]!.id,
            roleId: role.id,
            personId: person.id,
          },
        })
      );
    }
    const raced = await Promise.all(
      assignmentPlans.map((plan) => response(post, plan))
    );
    assert.deepEqual(raced.map(({ status }) => status).toSorted(), [200, 409]);
    const memberships = await db
      .select()
      .from(teamMemberships)
      .where(
        and(
          eq(teamMemberships.roleId, role.id),
          eq(teamMemberships.status, "active")
        )
      );
    assert.equal(memberships.length, 1, "one active holder wins");
    const [winner] = await db
      .select()
      .from(persons)
      .where(eq(persons.id, memberships[0]!.personId));
    assert.equal(winner.status, "launch_team");
    assert.equal(
      (
        await db
          .select()
          .from(personActivities)
          .where(eq(personActivities.personId, winner.id))
      ).length,
      1
    );
    const [dirty] = await db
      .select({ at: churches.lastMaterialEventAt })
      .from(churches)
      .where(eq(churches.id, plantId));
    assert.ok(dirty.at, "membership assignment marks Phase Engine dirty");

    const leadershipPlan = await approve({
      kind: "effect",
      operation: "updateRoleAction",
      values: { roleId: role.id, isLeadershipRole: "true" },
    });
    assert.equal((await response(post, leadershipPlan)).status, 200);
    const [leaderTeam] = await db
      .select()
      .from(ministryTeams)
      .where(eq(ministryTeams.id, created[0]!.id));
    assert.equal(leaderTeam.leaderId, winner.id);
    const [promoted] = await db
      .select()
      .from(persons)
      .where(eq(persons.id, winner.id));
    assert.equal(promoted.status, "leader");
    assert.equal(
      (
        await db
          .select()
          .from(personActivities)
          .where(eq(personActivities.personId, winner.id))
      ).length,
      2
    );

    const deleteRolePlan = await approve({
      kind: "effect",
      operation: "deleteRoleAction",
      values: { roleId: role.id },
    });
    assert.equal((await response(post, deleteRolePlan)).status, 200);
    assert.equal(
      (await db.select().from(teamRoles).where(eq(teamRoles.id, role.id)))
        .length,
      0
    );
    assert.equal(
      (
        await db
          .select()
          .from(teamMemberships)
          .where(eq(teamMemberships.roleId, role.id))
      ).length,
      0
    );
    assert.equal(
      (
        await db
          .select()
          .from(ministryTeams)
          .where(eq(ministryTeams.id, created[0]!.id))
      )[0]?.leaderId,
      null
    );

    const explicitLeaderPlan = await approve({
      kind: "effect",
      operation: "assignTeamLeaderAction",
      values: { teamId: created[0]!.id, personId: historyPerson.id },
    });
    assert.equal((await response(post, explicitLeaderPlan)).status, 200);
    assert.equal(
      (
        await db
          .select()
          .from(ministryTeams)
          .where(eq(ministryTeams.id, created[0]!.id))
      )[0]?.leaderId,
      historyPerson.id
    );
    assert.equal(
      (
        await db.select().from(persons).where(eq(persons.id, historyPerson.id))
      )[0]?.status,
      "leader"
    );

    const [planterPerson] = await db
      .insert(persons)
      .values({
        churchId: plantId,
        userId: actorId,
        firstName: "Live",
        lastName: "Planter",
        status: "core_group",
        createdBy: actorId,
      })
      .returning();
    const [leadershipTeam] = await db
      .insert(ministryTeams)
      .values({
        churchId: plantId,
        name: "Leadership",
        templateKey: "senior_pastor",
        type: "predefined",
        createdBy: actorId,
      })
      .returning();
    const leadershipImportPlan = await approve({
      kind: "effect",
      operation: "importRoleTemplatesAction",
      values: {
        teamId: leadershipTeam.id,
        teamKey: "senior_pastor",
        roleKeys: "senior_pastor",
      },
    });
    assert.equal((await response(post, leadershipImportPlan)).status, 200);
    const [seniorRole] = await db
      .select()
      .from(teamRoles)
      .where(
        and(
          eq(teamRoles.teamId, leadershipTeam.id),
          eq(teamRoles.name, "Senior Pastor")
        )
      );
    const [seniorMembership] = await db
      .select()
      .from(teamMemberships)
      .where(eq(teamMemberships.roleId, seniorRole.id));
    assert.equal(seniorMembership.personId, planterPerson.id);
    assert.equal(
      seniorMembership.startDate,
      null,
      "automatic Senior Pastor fill matches assignMember's omitted start date"
    );
    assert.equal(
      (
        await db.select().from(persons).where(eq(persons.id, planterPerson.id))
      )[0]?.status,
      "leader"
    );
    assert.equal(
      (
        await db
          .select()
          .from(personActivities)
          .where(eq(personActivities.personId, planterPerson.id))
      ).length,
      2
    );

    const initializationDriftPlan = await approve({
      kind: "effect",
      operation: "initializeTeamsAction",
      values: { teamKeys: "worship,technology" },
    });
    await db
      .update(ministryTeams)
      .set({ name: "Renamed Worship" })
      .where(eq(ministryTeams.id, predefined.id));
    assert.equal((await response(post, initializationDriftPlan)).status, 409);
    assert.equal(
      (
        await db
          .select()
          .from(ministryTeams)
          .where(
            and(
              eq(ministryTeams.churchId, plantId),
              eq(ministryTeams.templateKey, "technology")
            )
          )
      ).length,
      0,
      "same-ID existing-team field drift refuses the immutable initialization plan"
    );

    const [foreignPlant] = await db
      .insert(churches)
      .values({ name: `${SCRATCH} foreign` })
      .returning({ id: churches.id });
    const [foreignTeam] = await db
      .insert(ministryTeams)
      .values({
        churchId: foreignPlant.id,
        name: "Foreign Team",
        type: "custom",
        createdBy: actorId,
      })
      .returning();
    assert.equal(
      await resolveTeamsEvryEffect({
        actor: actorRef,
        selection: {
          kind: "effect",
          operation: "updateTeamAction",
          values: { teamId: foreignTeam.id, name: "Leak" },
        },
        now: new Date(),
      }),
      null
    );
    assert.equal(
      await resolveTeamsEvryEffect({
        actor: actorRef,
        selection: {
          kind: "effect",
          operation: "createMeetingAction",
          values: {
            teamId: foreignTeam.id,
            datetime: "2031-02-03T18:30",
            timezone: "America/New_York",
          },
        },
        now: new Date(),
      }),
      null
    );

    process.stdout.write(
      "Evry Teams live effect proof passed: replay, serializable same-baseline races, raw-row drift, fresh seat, seed, every mutation shape, meeting composition, history reactivation, role race, People/leader lineage, canonical auto-fill, cascades, Phase dirtiness, and foreign targets.\n"
    );
  } finally {
    // The suite owns its whole disposable database. Evry audit/plan rows are
    // intentionally immutable and cannot be individually deleted; the live
    // stack drops the isolated database/container after the proof.
    sessionUser = null;
  }
}

main().catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
});
