import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { mock } from "node:test";

import { and, eq } from "drizzle-orm";

import { db } from "@/db";
import {
  churches,
  churchMeetings,
  evryExecutionEffectClaims,
  evryExecutionOutcomes,
  locations,
  meetingAttendance,
  ministryTeams,
  notifications,
  personActivities,
  persons,
  sendingChurches,
  sessions,
  teamMemberships,
  teamResponsibilities,
  teamRoles,
  trainingCompletions,
  trainingPrograms,
  users,
} from "@/db/schema";
import { UnauthorizedError } from "@/lib/auth/unauthorized";
import { formatDateTime } from "@/lib/datetime";
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
      {
        proposeTeamsEvryEffect,
        TEAMS_EXECUTION_CAPABILITIES,
        TEAMS_EXECUTION_REGISTRY,
        TEAMS_PLAN_REGISTRY,
      },
      planRepository,
      plans,
      route,
      viewer,
      effectContracts,
      teamsConversation,
      atomicEffect,
      executor,
      meetingNotifications,
      executorRepository,
      capabilityAuthorization,
      auditIdentity,
    ] = await Promise.all([
      import("./resolver"),
      import("./runtime"),
      import("@/lib/evry/plans/repository"),
      import("@/lib/evry/plans"),
      import("@/app/api/evry/plans/[planId]/execute/route"),
      import("@/lib/evry/eligibility/viewer"),
      import("./effect-contracts"),
      import("./conversation"),
      import("./atomic-effect"),
      import("@/lib/evry/executor"),
      import("@/lib/meetings/notifications"),
      import("@/lib/evry/executor/repository"),
      import("@/lib/evry/eligibility/capabilities"),
      import("@/lib/evry/audit/identity"),
    ]);
    const actorRef = await viewer.requireEvryPlantViewer();
    const post = route.createEvryPlanExecutePost({
      registry: TEAMS_EXECUTION_REGISTRY,
    });
    const planOperations = new Map<
      string,
      Parameters<typeof resolveTeamsEvryEffect>[0]["selection"]["operation"]
    >();
    const successfulPlans = new Map<
      Parameters<typeof resolveTeamsEvryEffect>[0]["selection"]["operation"],
      { planId: string; fingerprint: string }
    >();
    let plannedMeetingInstant: string | null = null;
    let plannedMeetingNotificationCount: number | null = null;
    let plannedMeetingNotificationIntents: readonly {
      churchId: string;
      recipientUserId: string;
      category: "meetings";
      type: string;
      title: string;
      body: string;
      entityType: "meeting";
      entityId: string;
      dedupeKey: string;
      scheduledFor: string;
    }[] = [];

    async function approve(
      selection: Parameters<typeof resolveTeamsEvryEffect>[0]["selection"],
      planningActor = actorRef
    ) {
      const plannedAt = new Date();
      const resolved = await resolveTeamsEvryEffect({
        actor: planningActor,
        selection,
        now: plannedAt,
      });
      assert.ok(resolved, `resolved ${selection.operation}`);
      if (selection.operation === "createMeetingAction") {
        plannedMeetingInstant =
          resolved.arguments.disclosure.dateTime?.instantUtc ?? null;
        plannedMeetingNotificationCount =
          resolved.arguments.notificationIntents.length;
        plannedMeetingNotificationIntents =
          resolved.arguments.notificationIntents;
      }
      const proposed = await proposeTeamsEvryEffect({
        actor: planningActor,
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
      planOperations.set(proposed.plan.planId, selection.operation);
      return proposed.plan;
    }

    async function execute(plan: { planId: string; fingerprint: string }) {
      const result = await response(post, plan);
      const operation = planOperations.get(plan.planId);
      if (operation && result.status === 200)
        successfulPlans.set(operation, plan);
      return result;
    }

    const fullInitialization = await approve({
      kind: "effect",
      operation: "initializeTeamsWithRolesAction",
      values: {},
    });
    assert.equal((await execute(fullInitialization)).status, 200);
    assert.ok(
      (await db.select().from(teamRoles)).length > 0,
      "full initialization reaches real team and role writes"
    );
    await db.delete(teamRoles).where(eq(teamRoles.churchId, plantId));
    await db.delete(ministryTeams).where(eq(ministryTeams.churchId, plantId));

    const partialInitialization = await approve({
      kind: "effect",
      operation: "initializeTeamsAction",
      values: { teamKeys: "technology" },
    });
    assert.equal((await execute(partialInitialization)).status, 200);

    const create = await approve({
      kind: "effect",
      operation: "createTeamAction",
      values: { name: "Live Team", description: "Exact" },
    });
    const double = await Promise.all([execute(create), execute(create)]);
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
      updateRacePlans.map((plan) => execute(plan))
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

    // Authorization was minted while this was an exact plant account. A
    // competing tenancy appears before the adapter's single SQL statement.
    // The statement itself must fail closed rather than rely on the earlier
    // session reload and write through a malformed actor row.
    const dualTenancyPlan = await approve({
      kind: "effect",
      operation: "createTeamAction",
      values: { name: "Dual Tenancy Must Not Land" },
    });
    const dualTenancyStored = await planRepository.findExactEvryActionPlan({
      planId: dualTenancyPlan.planId,
      actorUserId: actorId,
      plantId,
      fingerprint: dualTenancyPlan.fingerprint,
    });
    assert.ok(dualTenancyStored);
    const dualTenancyDocument = plans.parseStoredEvryActionPlan({
      document: dualTenancyStored.document,
      registry: TEAMS_PLAN_REGISTRY,
    });
    const dualTenancyStep = dualTenancyDocument.steps[0];
    assert.ok(dualTenancyStep);
    const dualTenancyAuthorization =
      await capabilityAuthorization.authorizeEvryEffectCapability(
        dualTenancyStep.capabilityIdentity
      );
    assert.ok(dualTenancyAuthorization);
    const dualTenancySnapshot =
      await executorRepository.startOrResumeEvryExecution({
        planId: dualTenancyPlan.planId,
        actorUserId: actorId,
        plantId,
        fingerprint: dualTenancyPlan.fingerprint,
        startedAt: new Date(),
      });
    assert.ok(dualTenancySnapshot);
    const [competingTenancy] = await db
      .insert(sendingChurches)
      .values({ name: "__Evry Teams competing tenancy__" })
      .returning({ id: sendingChurches.id });
    assert.ok(competingTenancy);
    await db
      .update(users)
      .set({ sendingChurchId: competingTenancy.id })
      .where(eq(users.id, actorId));
    const dualTenancyResult = await atomicEffect.executeTeamsEffect({
      authorization: dualTenancyAuthorization,
      effectKey: auditIdentity.executionEffectKey(
        dualTenancyPlan.planId,
        dualTenancyPlan.fingerprint,
        dualTenancyStep.id
      ),
      execution: {
        attemptId: dualTenancySnapshot.attempt.id,
        planId: dualTenancyPlan.planId,
        actorUserId: actorId,
        plantId,
        fingerprint: dualTenancyPlan.fingerprint,
        correlationId: dualTenancySnapshot.attempt.correlationId,
        stepId: dualTenancyStep.id,
        capabilityIdentity: dualTenancyStep.capabilityIdentity,
      },
      arguments: dualTenancyStep.arguments,
    });
    await db
      .update(users)
      .set({ sendingChurchId: null })
      .where(eq(users.id, actorId));
    assert.deepEqual(dualTenancyResult, {
      status: "refused",
      excludedCount: 1,
    });
    assert.equal(
      (
        await db
          .select()
          .from(ministryTeams)
          .where(
            and(
              eq(ministryTeams.churchId, plantId),
              eq(ministryTeams.name, "Dual Tenancy Must Not Land")
            )
          )
      ).length,
      0
    );
    assert.equal(
      (
        await db
          .select()
          .from(evryExecutionEffectClaims)
          .where(eq(evryExecutionEffectClaims.planId, dualTenancyPlan.planId))
      ).length,
      0,
      "malformed tenancy cannot claim an exact Teams effect"
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
    assert.equal((await execute(drift)).status, 409);
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
    assert.equal((await execute(seatPlan)).status, 409);
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
    await db.update(users).set({ seat: "member" }).where(eq(users.id, actorId));
    sessionUser = {
      id: actorId,
      churchId: plantId,
      sendingChurchId: null,
      sendingNetworkId: null,
      seat: "member",
    };
    const memberActorRef = await viewer.requireEvryPlantViewer();
    const responsibilityConversation = {
      id: randomUUID(),
      actorUserId: actorId,
      plantId,
      title: "Responsibilities first view",
      createdAt: new Date(),
      lastActivityAt: new Date(),
      activePlan: null,
      stateVersion: 0,
      state: {},
      messages: [],
    };
    const responsibilityViews = await Promise.all(
      [randomUUID(), randomUUID()].map((userRequestKey) =>
        teamsConversation.continueTeamsEvryConversation.continue({
          actor: memberActorRef,
          conversation: responsibilityConversation as never,
          userRequestKey,
          literalUserText: `review ministry team ${predefined.id} responsibilities`,
          pageContext: null,
          requestPageContext: null,
          now: new Date(),
        })
      )
    );
    const responsibilityPlans = [];
    for (const result of responsibilityViews) {
      assert.ok(
        result,
        "Member first view resolves through the Teams continuation"
      );
      assert.equal(result.activePlan?.mode, "set");
      if (result.activePlan?.mode !== "set")
        throw new Error("missing seed plan");
      const plan = result.activePlan.plan;
      assert.equal(result.artifacts[0]?.kind, "confirmation");
      const confirmed = await planRepository.confirmExactEvryActionPlan({
        planId: plan.planId,
        actorUserId: actorId,
        plantId,
        fingerprint: plan.fingerprint,
        decidedAt: new Date(),
      });
      assert.equal(confirmed.status, "approved");
      planOperations.set(plan.planId, "initializeResponsibilities");
      responsibilityPlans.push(plan);
    }
    const responsibilityRace = await Promise.all(
      responsibilityPlans.map((plan) => execute(plan))
    );
    assert.deepEqual(
      responsibilityRace.map(({ status }) => status).toSorted(),
      [200, 409]
    );
    const responsibilityWinner =
      responsibilityPlans[
        responsibilityRace.findIndex(({ status }) => status === 200)
      ]!;
    assert.equal((await execute(responsibilityWinner)).status, 200);
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
    const seededView =
      await teamsConversation.continueTeamsEvryConversation.continue({
        actor: memberActorRef,
        conversation: responsibilityConversation as never,
        userRequestKey: randomUUID(),
        literalUserText: `review ministry team ${predefined.id} responsibilities`,
        pageContext: null,
        requestPageContext: null,
        now: new Date(),
      });
    assert.equal(seededView?.activePlan, undefined);
    assert.equal(seededView?.artifacts[0]?.kind, "read");
    await db.update(users).set({ seat: "owner" }).where(eq(users.id, actorId));
    sessionUser = {
      id: actorId,
      churchId: plantId,
      sendingChurchId: null,
      sendingNetworkId: null,
      seat: "owner",
    };

    const createRolePlan = await approve({
      kind: "effect",
      operation: "createRoleAction",
      values: {
        teamId: created[0]!.id,
        name: "Live Steward",
        description: "Owns the live proof",
      },
    });
    assert.equal((await execute(createRolePlan)).status, 200);
    assert.equal(
      (
        await db
          .select()
          .from(teamRoles)
          .where(
            and(
              eq(teamRoles.teamId, created[0]!.id),
              eq(teamRoles.name, "Live Steward")
            )
          )
      ).length,
      1
    );

    const createResponsibilityPlan = await approve({
      kind: "effect",
      operation: "createResponsibilityAction",
      values: { teamId: predefined.id, title: "Prepare the live proof" },
    });
    assert.equal((await execute(createResponsibilityPlan)).status, 200);
    const [createdResponsibility] = await db
      .select()
      .from(teamResponsibilities)
      .where(
        and(
          eq(teamResponsibilities.teamId, predefined.id),
          eq(teamResponsibilities.title, "Prepare the live proof")
        )
      );
    assert.ok(createdResponsibility);

    const updateResponsibilityPlan = await approve({
      kind: "effect",
      operation: "updateResponsibilityAction",
      values: {
        responsibilityId: createdResponsibility.id,
        title: "Verify the live proof",
      },
    });
    assert.equal((await execute(updateResponsibilityPlan)).status, 200);

    const completeResponsibilityPlan = await approve({
      kind: "effect",
      operation: "setResponsibilityCompleteAction",
      values: { responsibilityId: createdResponsibility.id, completed: "true" },
    });
    assert.equal((await execute(completeResponsibilityPlan)).status, 200);
    const [completedResponsibility] = await db
      .select()
      .from(teamResponsibilities)
      .where(eq(teamResponsibilities.id, createdResponsibility.id));
    assert.equal(completedResponsibility.title, "Verify the live proof");
    assert.ok(completedResponsibility.completedAt);

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
      roleImportPlans.map((plan) => execute(plan))
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

    const deleteResponsibilityPlan = await approve({
      kind: "effect",
      operation: "deleteResponsibilityAction",
      values: { responsibilityId: completedResponsibility.id },
    });
    assert.equal((await execute(deleteResponsibilityPlan)).status, 200);
    assert.equal(
      (
        await db
          .select()
          .from(teamResponsibilities)
          .where(eq(teamResponsibilities.id, completedResponsibility.id))
      ).length,
      0
    );

    const bridgeEmail = `${randomUUID()}@teams-proof.invalid`;
    const [ordinaryAccount] = await db
      .insert(users)
      .values({
        email: bridgeEmail.toLowerCase(),
        passwordHash: "scratch",
        name: "Ordinary Account",
        seat: "member",
        churchId: plantId,
      })
      .returning({ id: users.id });
    const [bridgedPerson] = await db
      .insert(persons)
      .values({
        churchId: plantId,
        userId: null,
        email: bridgeEmail.toUpperCase(),
        firstName: "Email",
        lastName: "Bridge",
        status: "core_group",
        createdBy: actorId,
      })
      .returning();
    const [meetingRole] = await db
      .insert(teamRoles)
      .values({
        churchId: plantId,
        teamId: created[0]!.id,
        name: "Meeting Guest",
        createdBy: actorId,
      })
      .returning();
    await db.insert(teamMemberships).values({
      churchId: plantId,
      teamId: created[0]!.id,
      roleId: meetingRole.id,
      personId: bridgedPerson.id,
      status: "active",
      createdBy: actorId,
    });

    const meetingPlan = await approve({
      kind: "effect",
      operation: "createMeetingAction",
      values: {
        teamId: created[0]!.id,
        title: "Live Rehearsal",
        datetime: "2031-02-03T18:30",
        locationName: "Room 201",
        meetingSubtype: "rehearsal",
      },
    });
    assert.equal(plannedMeetingInstant, "2031-02-03T18:30:00.000Z");
    assert.equal(plannedMeetingNotificationCount, 7);
    assert.equal((await execute(meetingPlan)).status, 200);
    const [meeting] = await db
      .select()
      .from(churchMeetings)
      .where(eq(churchMeetings.title, "Live Rehearsal"));
    assert.deepEqual(meeting.agenda, []);
    assert.equal(meeting.datetime.toISOString(), plannedMeetingInstant);
    const [savedLocation] = await db
      .select()
      .from(locations)
      .where(eq(locations.id, meeting.locationId!));
    assert.equal(savedLocation.name, "Room 201");
    assert.equal(savedLocation.address, "");
    const attendance = await db
      .select()
      .from(meetingAttendance)
      .where(eq(meetingAttendance.meetingId, meeting.id));
    assert.deepEqual(
      attendance.map(({ personId }) => personId),
      [bridgedPerson.id],
      "the active member is the exact meeting guest roster"
    );
    const notificationRows = await db
      .select()
      .from(notifications)
      .where(eq(notifications.entityId, meeting.id));
    assert.equal(notificationRows.length, 7);
    assert.equal(
      notificationRows.filter(({ type }) => type === "meeting.scheduled")
        .length,
      1
    );
    for (const days of [7, 3, 1]) {
      assert.equal(
        notificationRows.filter(
          ({ type }) => type === `meeting.reminder.${days}d`
        ).length,
        2
      );
    }
    assert.equal(
      notificationRows.filter(
        ({ recipientUserId }) => recipientUserId === ordinaryAccount.id
      ).length,
      4,
      "the non-owner account is found by mixed-case email, not persons.user_id"
    );
    assert.equal(
      notificationRows.filter(
        ({ recipientUserId }) => recipientUserId === actorId
      ).length,
      3
    );
    const displayedMeetingTime = formatDateTime(meeting.datetime);
    assert.ok(
      notificationRows.every(({ body }) => body.includes(displayedMeetingTime)),
      "confirmation, stored UTC wall clock, and notification copy agree"
    );

    const isolatedFailureReports: Array<
      Awaited<
        ReturnType<
          typeof meetingNotifications.reconcileMeetingNotificationIntents
        >
      >
    > = [];
    const failureRegistry = executor.createEvryExecutionCapabilityRegistry(
      TEAMS_EXECUTION_CAPABILITIES.map((registration) =>
        registration.planCapability.identity ===
        effectContracts.TEAMS_EFFECT_IDENTITY_BY_OPERATION.createMeetingAction
          ? executor.defineEvryExecutionCapability({
              planCapability: registration.planCapability,
              executeIfCurrent: (effectInput) =>
                atomicEffect.executeTeamsEffect(effectInput, {
                  reconcileMeetingNotifications: async (
                    churchId,
                    meetingId,
                    intents
                  ) => {
                    const report =
                      await meetingNotifications.reconcileMeetingNotificationIntents(
                        churchId,
                        meetingId,
                        intents,
                        {
                          ...meetingNotifications.dbMeetingNotificationDeps,
                          enqueue: async (notification) => {
                            if (
                              notification.recipientUserId ===
                              ordinaryAccount.id
                            ) {
                              throw new Error(
                                "isolated recipient enqueue failure"
                              );
                            }
                            return meetingNotifications.dbMeetingNotificationDeps.enqueue(
                              notification
                            );
                          },
                        }
                      );
                    isolatedFailureReports.push(report);
                    return report;
                  },
                }),
            })
          : registration
      )
    );
    const failurePost = route.createEvryPlanExecutePost({
      registry: failureRegistry,
    });
    const failurePlan = await approve({
      kind: "effect",
      operation: "createMeetingAction",
      values: {
        teamId: created[0]!.id,
        title: "Best-effort Failure",
        datetime: "2031-02-10T18:30",
        meetingSubtype: "rehearsal",
      },
    });
    assert.equal(plannedMeetingNotificationCount, 7);
    assert.deepEqual(
      plannedMeetingNotificationIntents
        .map(({ recipientUserId, type }) => `${recipientUserId}:${type}`)
        .toSorted(),
      [
        `${ordinaryAccount.id}:meeting.scheduled`,
        ...[1, 3, 7].map(
          (days) => `${ordinaryAccount.id}:meeting.reminder.${days}d`
        ),
        ...[1, 3, 7].map((days) => `${actorId}:meeting.reminder.${days}d`),
      ].toSorted(),
      "the immutable plan discloses every intended recipient and type"
    );
    assert.deepEqual(
      plannedMeetingNotificationIntents
        .filter(({ type }) => type.startsWith("meeting.reminder."))
        .map(({ type, scheduledFor }) => `${type}:${scheduledFor}`)
        .toSorted(),
      [
        ...[ordinaryAccount.id, actorId].flatMap(() => [
          "meeting.reminder.7d:2031-02-03T18:30:00.000Z",
          "meeting.reminder.3d:2031-02-07T18:30:00.000Z",
          "meeting.reminder.1d:2031-02-09T18:30:00.000Z",
        ]),
      ].toSorted(),
      "the immutable plan discloses every intended reminder time"
    );
    assert.ok(
      plannedMeetingNotificationIntents.every(
        ({
          churchId,
          category,
          title,
          body,
          entityType,
          entityId,
          dedupeKey,
        }) =>
          churchId === plantId &&
          category === "meetings" &&
          title.includes("Best-effort Failure") &&
          body.includes("Best-effort Failure") &&
          entityType === "meeting" &&
          entityId === plannedMeetingNotificationIntents[0]!.entityId &&
          dedupeKey.includes(entityId)
      ),
      "the immutable plan binds literal F11 anchor, copy, entity, and dedupe fields"
    );
    assert.equal((await response(failurePost, failurePlan)).status, 200);
    assert.deepEqual(isolatedFailureReports, [
      {
        cancelled: 0,
        considered: 7,
        recorded: 3,
        created: 3,
        skipped: 0,
        failed: 4,
        reason: null,
      },
    ]);
    const [failureMeeting] = await db
      .select()
      .from(churchMeetings)
      .where(eq(churchMeetings.title, "Best-effort Failure"));
    assert.ok(failureMeeting, "notification failure kept the meeting");
    assert.equal(
      (
        await db
          .select()
          .from(meetingAttendance)
          .where(eq(meetingAttendance.meetingId, failureMeeting.id))
      ).length,
      1,
      "notification failure kept the exact guest roster"
    );
    assert.equal(
      (
        await db
          .select()
          .from(notifications)
          .where(eq(notifications.entityId, failureMeeting.id))
      ).length,
      3,
      "one recipient's failures did not cost the other recipient"
    );
    assert.equal(
      (await response(failurePost, failurePlan)).status,
      200,
      "the exact plan remains a successful keyed replay"
    );
    assert.equal(
      (
        await db
          .select()
          .from(churchMeetings)
          .where(eq(churchMeetings.title, "Best-effort Failure"))
      ).length,
      1,
      "replay did not duplicate the meeting"
    );
    assert.equal(
      (
        await db
          .select()
          .from(meetingAttendance)
          .where(eq(meetingAttendance.meetingId, failureMeeting.id))
      ).length,
      1,
      "replay did not duplicate guests"
    );
    assert.equal(
      (
        await db
          .select()
          .from(notifications)
          .where(eq(notifications.entityId, failureMeeting.id))
      ).length,
      3,
      "terminal replay duplicates neither the meeting nor the successful recipient rows"
    );

    const crashRegistry = executor.createEvryExecutionCapabilityRegistry(
      TEAMS_EXECUTION_CAPABILITIES.map((registration) =>
        registration.planCapability.identity ===
        effectContracts.TEAMS_EFFECT_IDENTITY_BY_OPERATION.createMeetingAction
          ? executor.defineEvryExecutionCapability({
              planCapability: registration.planCapability,
              executeIfCurrent: (effectInput) =>
                atomicEffect.executeTeamsEffect(effectInput, {
                  afterDurableCommit: () => {
                    throw new Error("simulated process interruption");
                  },
                }),
            })
          : registration
      )
    );
    const crashPost = route.createEvryPlanExecutePost({
      registry: crashRegistry,
    });
    const crashPlan = await approve({
      kind: "effect",
      operation: "createMeetingAction",
      values: {
        teamId: created[0]!.id,
        title: "Crash Recovery Meeting",
        datetime: "2031-02-17T18:30",
        meetingSubtype: "rehearsal",
      },
    });
    const crashIntentCount = plannedMeetingNotificationIntents.length;
    assert.equal(crashIntentCount, 7);
    assert.equal(
      (await response(crashPost, crashPlan)).status,
      503,
      "the interrupted adapter leaves the executor step retryable"
    );
    const [crashMeeting] = await db
      .select()
      .from(churchMeetings)
      .where(eq(churchMeetings.title, "Crash Recovery Meeting"));
    assert.ok(crashMeeting, "the meeting committed before interruption");
    assert.equal(
      (
        await db
          .select()
          .from(meetingAttendance)
          .where(eq(meetingAttendance.meetingId, crashMeeting.id))
      ).length,
      1
    );
    assert.equal(
      (
        await db
          .select()
          .from(notifications)
          .where(eq(notifications.entityId, crashMeeting.id))
      ).length,
      0,
      "interruption occurred before F11 reconciliation"
    );
    assert.equal(
      (
        await db
          .select()
          .from(evryExecutionEffectClaims)
          .where(eq(evryExecutionEffectClaims.planId, crashPlan.planId))
      ).length,
      1,
      "the atomic domain claim survived"
    );
    assert.equal(
      (
        await db
          .select()
          .from(evryExecutionOutcomes)
          .where(eq(evryExecutionOutcomes.planId, crashPlan.planId))
      ).filter(({ subject }) => subject === "step").length,
      0,
      "the domain claim is not a terminal executor step"
    );
    assert.equal(
      (await response(route.POST, crashPlan)).status,
      200,
      "production executor replay reaches post-commit F11 reconciliation"
    );
    assert.equal(
      (
        await db
          .select()
          .from(churchMeetings)
          .where(eq(churchMeetings.title, "Crash Recovery Meeting"))
      ).length,
      1
    );
    assert.equal(
      (
        await db
          .select()
          .from(meetingAttendance)
          .where(eq(meetingAttendance.meetingId, crashMeeting.id))
      ).length,
      1
    );
    assert.equal(
      (
        await db
          .select()
          .from(notifications)
          .where(eq(notifications.entityId, crashMeeting.id))
      ).length,
      crashIntentCount,
      "production replay filled every missing literal intent exactly once"
    );
    assert.equal(
      (await response(route.POST, crashPlan)).status,
      200,
      "terminal production replay remains stable"
    );
    assert.equal(
      (
        await db
          .select()
          .from(notifications)
          .where(eq(notifications.entityId, crashMeeting.id))
      ).length,
      crashIntentCount,
      "F11 dedupe prevents replay duplication"
    );

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
    assert.equal((await execute(historyPlan)).status, 200);
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
    assert.equal((await execute(trainingProgramPlan)).status, 200);
    const [program] = await db
      .select()
      .from(trainingPrograms)
      .where(eq(trainingPrograms.name, "Live Safety"));
    const trainingCompletionPlan = await approve({
      kind: "effect",
      operation: "markTrainingCompleteAction",
      values: { programId: program.id, personId: historyPerson.id },
    });
    assert.equal((await execute(trainingCompletionPlan)).status, 200);
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
    assert.equal((await execute(removeHistoryPlan)).status, 200);
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
      assignmentPlans.map((plan) => execute(plan))
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
    assert.equal((await execute(leadershipPlan)).status, 200);
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
    assert.equal((await execute(deleteRolePlan)).status, 200);
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
    assert.equal((await execute(explicitLeaderPlan)).status, 200);
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
    assert.equal((await execute(leadershipImportPlan)).status, 200);
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
      values: { teamKeys: "prayer" },
    });
    await db
      .update(ministryTeams)
      .set({ name: "Renamed Worship" })
      .where(eq(ministryTeams.id, predefined.id));
    assert.equal((await execute(initializationDriftPlan)).status, 409);
    assert.equal(
      (
        await db
          .select()
          .from(ministryTeams)
          .where(
            and(
              eq(ministryTeams.churchId, plantId),
              eq(ministryTeams.templateKey, "prayer")
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
          },
        },
        now: new Date(),
      }),
      null
    );

    for (const operation of effectContracts.TEAMS_EFFECT_OPERATIONS) {
      const plan = successfulPlans.get(operation);
      assert.ok(plan, `${operation} reached a real successful execution`);
      assert.equal(
        (await execute(plan)).status,
        200,
        `${operation} recovers its original keyed result on replay`
      );
    }
    const liveOutcomes = Object.fromEntries(
      effectContracts.TEAMS_EFFECT_OPERATIONS.map((operation) => [
        effectContracts.TEAMS_EFFECT_IDENTITY_BY_OPERATION[operation],
        { execution: true, idempotency: true, errors: true },
      ])
    );

    process.stdout.write(
      `EVRY_TEAMS_LIVE_OUTCOMES=${JSON.stringify(liveOutcomes)}\nEvry Teams live effect proof passed: every effect execution and keyed replay, serializable same-baseline races, raw-row drift, fresh owner and Member authority, first-view seed, every mutation shape, UTC-naive meeting composition, canonical email bridge recipients, history reactivation, role race, People/leader lineage, canonical auto-fill, cascades, Phase dirtiness, and foreign targets.\n`
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
