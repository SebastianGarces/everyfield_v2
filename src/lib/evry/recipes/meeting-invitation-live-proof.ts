import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { mock } from "node:test";

import { and, eq } from "drizzle-orm";

import { db } from "@/db";
import {
  churches,
  communications,
  evryExecutionAttempts,
  evryExecutionOutcomes,
  evryPlanConfirmations,
  meetingAttendance,
  persons,
  sendingChurches,
  users,
} from "@/db/schema";

type SessionUser = Readonly<{
  id: string;
  churchId: string;
  seat: "owner";
  sendingChurchId: null;
  sendingNetworkId: null;
}>;

let sessionUser: SessionUser | null = null;
mock.module("@/lib/auth/session", {
  namedExports: {
    verifySession: async () => {
      if (!sessionUser) throw new Error("Unauthorized");
      return { user: sessionUser };
    },
    verifyFreshSession: async () => {
      if (!sessionUser) throw new Error("Unauthorized");
      return { user: sessionUser };
    },
  },
});

type Modules = Awaited<ReturnType<typeof loadModules>>;

async function loadModules() {
  const [
    viewer,
    plans,
    planService,
    recipes,
    meetings,
    communication,
    executor,
    datetime,
    meetingOutput,
    artifactLifecycle,
    trustedReview,
    production,
    conversations,
    planResume,
    planRepository,
    reuse,
    productionReuse,
    invitation,
  ] = await Promise.all([
    import("@/lib/evry/eligibility/viewer"),
    import("@/lib/evry/plans"),
    import("@/lib/evry/plans/service"),
    import("@/lib/evry/recipes"),
    import("@/lib/evry/capabilities/meetings/runtime"),
    import("@/lib/evry/capabilities/communication/messages"),
    import("@/lib/evry/executor"),
    import("@/lib/evry/resolvers/datetime"),
    import("@/lib/evry/capabilities/meetings/dependency-output"),
    import("@/lib/evry/artifacts/lifecycle"),
    import("@/lib/evry/artifacts/trusted-plan-review"),
    import("@/lib/evry/capabilities/production"),
    import("@/lib/evry/conversations/service"),
    import("@/lib/evry/conversations/plan-resume"),
    import("@/lib/evry/plans/repository"),
    import("@/lib/evry/conversations/reuse"),
    import("@/lib/evry/recipes/production-reuse"),
    import("@/lib/evry/recipes/meeting-invitation"),
  ]);
  return {
    viewer,
    plans,
    planService,
    recipes,
    meetings,
    communication,
    executor,
    datetime,
    meetingOutput,
    artifactLifecycle,
    trustedReview,
    production,
    conversations,
    planResume,
    planRepository,
    reuse,
    productionReuse,
    invitation,
  };
}

async function seedScenario(modules: Modules, label: string) {
  const [church] = await db
    .insert(churches)
    .values({
      name: `__evry invitation ${label}__`,
      timeZone: "UTC",
      streetAddress: "1 Exact Plan Way",
      city: "Albany",
      stateRegion: "NY",
      country: "USA",
    })
    .returning({ id: churches.id });
  assert.ok(church);
  const [actorRow] = await db
    .insert(users)
    .values({
      email: `${randomUUID()}@example.test`,
      passwordHash: "scratch",
      name: label,
      seat: "owner",
      churchId: church.id,
    })
    .returning({ id: users.id });
  assert.ok(actorRow);
  sessionUser = {
    id: actorRow.id,
    churchId: church.id,
    seat: "owner",
    sendingChurchId: null,
    sendingNetworkId: null,
  };
  const actor = await modules.viewer.requireEvryPlantViewer();
  const peopleEmails = [
    `alex.${randomUUID()}@example.test`,
    `beth.${randomUUID()}@example.test`,
  ] as const;
  const insertedPeople = await db
    .insert(persons)
    .values([
      {
        churchId: church.id,
        firstName: "Alex",
        lastName: label,
        email: peopleEmails[0],
        status: "core_group",
        createdBy: actorRow.id,
      },
      {
        churchId: church.id,
        firstName: "Beth",
        lastName: label,
        email: peopleEmails[1],
        status: "prospect",
        createdBy: actorRow.id,
      },
    ])
    .returning({ id: persons.id, updatedAt: persons.updatedAt });
  const guestUsers = await db
    .insert(users)
    .values(
      peopleEmails.map((email, index) => ({
        email,
        passwordHash: "scratch",
        name: index === 0 ? "Alex guest" : "Beth guest",
        seat: "member" as const,
        churchId: church.id,
      }))
    )
    .returning({ id: users.id });
  const requestKey = modules.plans.mintEvryPlanRequestKey();
  const calendarDate = new Date(Date.now() + 10 * 86_400_000)
    .toISOString()
    .slice(0, 10);
  const dateTime = await modules.datetime.resolveEvryPlantDateTimeRequest({
    capabilityIdentity: "meetings.create",
    sourceText: `${calendarDate} at 10:00 AM`,
  });
  assert.equal(dateTime.status, "resolved");
  if (dateTime.status !== "resolved") {
    throw new Error("The live fixture date must resolve exactly");
  }
  const resolved = {
    kind: "resolved" as const,
    meetingType: "vision_meeting" as const,
    dateTime: dateTime.dateTime,
    durationMinutes: 90,
    location: { id: null, name: "Church", address: "1 Exact Plan Way" },
    guests: insertedPeople.map((person, index) => ({
      personId: person.id,
      label: index === 0 ? "Alex" : "Beth",
      email: peopleEmails[index]!,
      expectedPersonUpdatedAt: person.updatedAt.toISOString(),
    })),
    exclusions: [],
    subject: "Vision Meeting invitation",
    body: "Please join the Vision Meeting.",
  };
  const snapshot = await modules.recipes.resolveMeetingInvitationPlan({
    actor,
    resolved,
    requestKey,
    now: new Date(),
  });
  assert.ok(snapshot);
  return {
    actor,
    churchId: church.id,
    people: insertedPeople,
    guestUsers,
    calendarDate,
    requestKey,
    snapshot,
  };
}

async function persistApprovedPlan(
  modules: Modules,
  scenario: Awaited<ReturnType<typeof seedScenario>>,
  registry: ReturnType<
    Modules["recipes"]["createMeetingInvitationRecipeRegistry"]
  >
) {
  const plan = await modules.recipes.createEvryRecipePlan({
    actor: scenario.actor,
    policy: {
      classification: "application_action",
      continuation: { kind: "application_action", literalUserText: "invite" },
    },
    recipeIdentity: modules.recipes.MEETING_INVITATION_RECIPE_IDENTITY,
    inputValues: {
      plan: {
        request: {
          sourceText: "August 5, 2027 at 10 AM",
          durationMinutes: 90,
          subject: "Vision Meeting invitation",
          body: "Please join the Vision Meeting.",
        },
        requestKey: scenario.requestKey,
        now: new Date().toISOString(),
      },
    },
    requestKey: scenario.requestKey,
    registry,
    reviewRegistry: modules.recipes.MEETING_INVITATION_REVIEW_REGISTRY,
    eligibleCapabilities: [
      { identity: "meetings.create" },
      { identity: "meetings.add-guests" },
      { identity: "communication.messages.send" },
    ],
  });
  const confirmation = await modules.planService.confirmEvryActionPlan({
    actor: scenario.actor,
    planId: plan.id,
    fingerprint: plan.fingerprint,
    decidedAt: new Date(),
    registry: registry.executionRegistry.planRegistry,
  });
  assert.ok(
    confirmation.status === "approved" ||
      confirmation.status === "already_approved"
  );
  return plan;
}

function productionDispatcher(
  modules: Modules,
  registry: ReturnType<
    Modules["recipes"]["createMeetingInvitationRecipeRegistry"]
  >
) {
  return modules.production.createProductionEvryActionPlanDispatcher({
    findPlan: modules.planRepository.findExactEvryActionPlan,
    executeGeneric: modules.executor.executeEvryActionPlan,
    executeRecipe: modules.executor.executeEvryRecipePlan,
    meetingInvitationRegistry: registry,
  });
}

function pausingGuestExecution(
  modules: Modules,
  dependencyFault?: "missing" | "tampered"
) {
  const actual = modules.meetings.MEETINGS_EXECUTION_CAPABILITIES.find(
    ({ planCapability }) => planCapability.identity === "meetings.add-guests"
  );
  assert.ok(actual);
  let pause = true;
  return modules.executor.defineEvryExecutionCapability({
    planCapability: actual.planCapability,
    async executeIfCurrent(input) {
      if (pause) {
        pause = false;
        return { status: "retryable" };
      }
      if (dependencyFault === "missing") {
        return actual.executeIfCurrent({ ...input, dependencyOutputs: [] });
      }
      if (dependencyFault === "tampered") {
        return actual.executeIfCurrent({
          ...input,
          dependencyOutputs: input.dependencyOutputs?.map((dependency) => ({
            ...dependency,
            value: {
              ...(dependency.value as Readonly<Record<string, unknown>>),
              meetingId: randomUUID(),
            },
          })),
        });
      }
      return actual.executeIfCurrent(input);
    },
  });
}

async function proveSendOnlyRetry(modules: Modules) {
  const scenario = await seedScenario(modules, "retry");
  let calls = 0;
  const send = modules.communication.createCommunicationEvryMessageExecutions({
    mailer: {
      async send() {
        calls++;
        return calls === 1
          ? { status: "retryable" as const, reason: "fixture outage" }
          : { status: "accepted" as const, providerId: `fixture-${calls}` };
      },
    },
  }).send;
  const registry = modules.recipes.createMeetingInvitationRecipeRegistry({
    send,
  });
  const execute = productionDispatcher(modules, registry);
  const now = new Date();
  const created = await modules.conversations.createEvryConversation({
    actor: scenario.actor,
    requestKey: randomUUID(),
    message:
      `Create a meeting for ${scenario.calendarDate} at 10 AM at the church location, lasting 90 minutes. ` +
      "Invite the core team and add prospects who have not visited a Vision Meeting. " +
      "Draft an email invitation and send it to them.",
    pageContext: null,
    requestPageContext: null,
    now,
  });
  assert.ok(created.activePlan);
  const confirmationArtifact =
    created.conversation.messages.at(-1)?.artifacts[0]?.artifact;
  assert.equal(confirmationArtifact?.kind, "confirmation");
  if (
    confirmationArtifact?.kind !== "confirmation" ||
    !("steps" in confirmationArtifact)
  ) {
    throw new Error("Production recipe continuation omitted its review");
  }
  assert.equal(
    confirmationArtifact.steps
      .flatMap(({ counts }) => counts)
      .filter(({ label }) => label.includes("notifications"))
      .reduce((sum, { count }) => sum + count, 0) > 0,
    true
  );
  const plan = created.activePlan.identity;
  const lifecycle = modules.artifactLifecycle.createEvryArtifactLifecycle({
    planRegistry: modules.production.PRODUCTION_EVRY_PLAN_REGISTRY,
    executionRegistry: modules.production.PRODUCTION_EVRY_EXECUTION_REGISTRY,
    reusableRecipeIdentities:
      modules.productionReuse.PRODUCTION_EVRY_RECIPE_REUSE_REGISTRY.identities,
    revalidatePlan: modules.planResume.revalidateProductionEvryConversationPlan,
    resume: modules.conversations.resumeEvryConversation,
    append: modules.conversations.appendTrustedEvryConversationMessage,
    confirm: modules.planService.confirmEvryActionPlan,
    execute,
    cancel: modules.planRepository.cancelExactEvryActionPlan,
    reviewPlan: (input) =>
      modules.trustedReview.trustedEvryPlanReview({
        ...input,
        reviewRegistry: modules.production.PRODUCTION_EVRY_REVIEW_REGISTRY,
      }),
    now: () => new Date(),
  });
  const first = await lifecycle({
    actor: scenario.actor,
    conversationId: created.conversation.id,
    request: {
      action: "execute",
      requestKey: randomUUID(),
      plan,
    },
  });
  assert.equal(first.status, "retryable");
  if (first.status !== "retryable") {
    throw new Error("Production lifecycle did not expose a safe retry");
  }
  assert.equal(
    first.resumed.conversation.messages.at(-1)?.artifacts[0]?.kind,
    "progress"
  );
  assert.equal(calls, 2);
  assert.equal(
    await db
      .select({ id: meetingAttendance.id })
      .from(meetingAttendance)
      .where(eq(meetingAttendance.churchId, scenario.churchId))
      .then((rows) => rows.length),
    2
  );
  assert.deepEqual(
    await db
      .select({ status: communications.status })
      .from(communications)
      .where(eq(communications.churchId, scenario.churchId))
      .then((rows) => rows.map(({ status }) => status)),
    ["sending"]
  );
  const second = await lifecycle({
    actor: scenario.actor,
    conversationId: created.conversation.id,
    request: {
      action: "retry",
      requestKey: randomUUID(),
      plan,
    },
  });
  assert.equal(second.status, "executed");
  if (second.status !== "executed") {
    throw new Error("Production lifecycle did not append its terminal receipt");
  }
  assert.equal(
    second.resumed.conversation.messages.at(-1)?.artifacts[0]?.kind,
    "result"
  );
  assert.equal(calls, 3);
  const resultArtifact = second.resumed.conversation.messages
    .at(-1)
    ?.artifacts.find(({ document }) => document.kind === "result");
  assert.ok(resultArtifact);
  assert.deepEqual(
    resultArtifact.document.kind === "result" &&
      "artifactVersion" in resultArtifact.document
      ? resultArtifact.document.reuse
      : null,
    {
      recipeIdentity: modules.recipes.MEETING_INVITATION_RECIPE_IDENTITY,
      label: "Reuse",
    }
  );

  const changedEmail = `casey.${randomUUID()}@example.test`;
  await db.insert(persons).values({
    churchId: scenario.churchId,
    firstName: "Casey",
    lastName: "Current recipient",
    email: changedEmail,
    status: "launch_team",
    createdBy: scenario.actor.userId,
  });
  await db.insert(users).values({
    email: changedEmail,
    passwordHash: "scratch",
    name: "Casey guest",
    seat: "member",
    churchId: scenario.churchId,
  });
  const reuseRequestKey = randomUUID();
  const reused = await modules.reuse.reuseCompletedEvryRecipe({
    actor: scenario.actor,
    sourceConversationId: second.resumed.conversation.id,
    resultArtifactId: resultArtifact.id,
    recipeIdentity: modules.recipes.MEETING_INVITATION_RECIPE_IDENTITY,
    requestKey: reuseRequestKey,
    now: new Date(),
  });
  assert.equal(reused.status, "created");
  if (reused.status !== "created" || !reused.resumed.activePlan) {
    throw new Error("Completed meeting invitation did not create a fresh plan");
  }
  const reuseReplay = await modules.reuse.reuseCompletedEvryRecipe({
    actor: scenario.actor,
    sourceConversationId: second.resumed.conversation.id,
    resultArtifactId: resultArtifact.id,
    recipeIdentity: modules.recipes.MEETING_INVITATION_RECIPE_IDENTITY,
    requestKey: reuseRequestKey,
    now: new Date(),
  });
  assert.equal(reuseReplay.status, "created");
  if (reuseReplay.status === "created") {
    assert.equal(
      reuseReplay.resumed.conversation.id,
      reused.resumed.conversation.id
    );
    assert.deepEqual(
      reuseReplay.resumed.activePlan?.identity,
      reused.resumed.activePlan.identity
    );
  }
  assert.notEqual(
    reused.resumed.conversation.id,
    second.resumed.conversation.id
  );
  assert.match(
    reused.resumed.conversation.messages[0]?.body ?? "",
    /Reuse this successful meeting invitation with fresh application data\./
  );
  assert.match(
    reused.resumed.conversation.messages[0]?.body ?? "",
    /Resolve the church location again\./
  );
  assert.equal(
    reused.resumed.conversation.messages.some((message) =>
      message.artifacts.some(({ document }) => document.kind === "result")
    ),
    false
  );
  const freshConfirmation = reused.resumed.conversation.messages
    .flatMap(({ artifacts }) => artifacts)
    .find(({ document }) => document.kind === "confirmation")?.document;
  assert.equal(freshConfirmation?.kind, "confirmation");
  if (freshConfirmation?.kind === "confirmation") {
    assert.deepEqual(
      freshConfirmation.plan,
      reused.resumed.activePlan.identity
    );
    assert.notDeepEqual(freshConfirmation.plan, plan);
  }

  const originalPlan = await modules.planRepository.findExactEvryActionPlan({
    planId: plan.planId,
    actorUserId: scenario.actor.userId,
    plantId: scenario.actor.plantId,
    fingerprint: plan.fingerprint,
  });
  const freshPlan = await modules.planRepository.findExactEvryActionPlan({
    planId: reused.resumed.activePlan.identity.planId,
    actorUserId: scenario.actor.userId,
    plantId: scenario.actor.plantId,
    fingerprint: reused.resumed.activePlan.identity.fingerprint,
  });
  assert.ok(originalPlan);
  assert.ok(freshPlan);
  const originalDocument = modules.plans.parseStoredEvryActionPlan({
    document: originalPlan.document,
    registry: modules.production.PRODUCTION_EVRY_PLAN_REGISTRY,
  });
  const freshDocument = modules.plans.parseStoredEvryActionPlan({
    document: freshPlan.document,
    registry: modules.production.PRODUCTION_EVRY_PLAN_REGISTRY,
  });
  const snapshotFor = (document: typeof originalDocument) =>
    modules.invitation.MEETING_INVITATION_PLAN_SNAPSHOT_SCHEMA.parse({
      meeting: document.steps[0]?.arguments,
      guests: document.steps[1]?.arguments,
      communication: document.steps[2]?.arguments,
    });
  const originalSnapshot = snapshotFor(originalDocument);
  const freshSnapshot = snapshotFor(freshDocument);
  assert.notEqual(originalPlan.id, freshPlan.id);
  assert.notEqual(originalPlan.requestKey, freshPlan.requestKey);
  assert.notEqual(originalPlan.fingerprint, freshPlan.fingerprint);
  assert.notDeepEqual(originalPlan.document, freshPlan.document);
  assert.notEqual(
    originalSnapshot.meeting.meetingId,
    freshSnapshot.meeting.meetingId
  );
  assert.notEqual(
    originalSnapshot.communication.communicationId,
    freshSnapshot.communication.communicationId
  );
  assert.deepEqual(
    originalSnapshot.guests.targets
      .map(({ attendanceId }) => attendanceId)
      .filter((attendanceId) =>
        freshSnapshot.guests.targets.some(
          (target) => target.attendanceId === attendanceId
        )
      ),
    []
  );
  assert.equal(originalSnapshot.communication.audience.recipients.length, 2);
  assert.equal(freshSnapshot.communication.audience.recipients.length, 3);
  assert.equal(
    freshSnapshot.communication.audience.recipients.some(
      ({ email }) => email === changedEmail
    ),
    true
  );
  assert.deepEqual(
    await db
      .select({ id: evryPlanConfirmations.id })
      .from(evryPlanConfirmations)
      .where(eq(evryPlanConfirmations.planId, freshPlan.id)),
    []
  );
  assert.deepEqual(
    await db
      .select({ id: evryExecutionAttempts.id })
      .from(evryExecutionAttempts)
      .where(eq(evryExecutionAttempts.planId, freshPlan.id)),
    []
  );
  assert.equal(
    await db
      .select({ id: meetingAttendance.id })
      .from(meetingAttendance)
      .where(eq(meetingAttendance.churchId, scenario.churchId))
      .then((rows) => rows.length),
    2
  );
  assert.deepEqual(
    await db
      .select({ status: communications.status })
      .from(communications)
      .where(eq(communications.churchId, scenario.churchId))
      .then((rows) => rows.map(({ status }) => status)),
    ["sent"]
  );
  const outcomes = await db
    .select({
      stepId: evryExecutionOutcomes.stepId,
      status: evryExecutionOutcomes.status,
      resultCode: evryExecutionOutcomes.resultCode,
      effectKey: evryExecutionOutcomes.effectKey,
      dependencyOutput: evryExecutionOutcomes.dependencyOutput,
    })
    .from(evryExecutionOutcomes)
    .where(
      and(
        eq(evryExecutionOutcomes.planId, plan.planId),
        eq(evryExecutionOutcomes.subject, "step")
      )
    );
  assert.deepEqual(
    outcomes
      .map(({ stepId, status, resultCode }) => ({
        stepId,
        status,
        resultCode,
      }))
      .toSorted((left, right) =>
        (left.stepId ?? "").localeCompare(right.stepId ?? "")
      ),
    ["add-guests", "create-meeting", "send-invitations"].map((stepId) => ({
      stepId,
      status: "completed",
      resultCode: "effect_completed",
    }))
  );
  assert.equal(
    outcomes.every(({ effectKey }) => effectKey !== null),
    true
  );
  const createOutcome = outcomes.find(
    ({ stepId }) => stepId === "create-meeting"
  );
  assert.ok(createOutcome);
  const meetingId =
    modules.meetingOutput.MEETING_CREATE_DEPENDENCY_OUTPUT_SCHEMA.parse(
      createOutcome.dependencyOutput
    ).meetingId;
  assert.equal(
    await db
      .select({ meetingId: meetingAttendance.meetingId })
      .from(meetingAttendance)
      .where(eq(meetingAttendance.churchId, scenario.churchId))
      .then((rows) => rows.every((row) => row.meetingId === meetingId)),
    true
  );
}

async function proveDependencyRefusal(
  modules: Modules,
  kind: "missing" | "tampered" | "drift" | "tenancy"
) {
  const scenario = await seedScenario(modules, kind);
  const registry = modules.recipes.createMeetingInvitationRecipeRegistry({
    addGuests: pausingGuestExecution(
      modules,
      kind === "drift" || kind === "tenancy" ? undefined : kind
    ),
    planResolver: modules.recipes.meetingInvitationPlanResolverRegistration({
      async resolveAuthorized() {
        return { kind: "planned", snapshot: scenario.snapshot };
      },
    }),
  });
  const execute = productionDispatcher(modules, registry);
  const plan = await persistApprovedPlan(modules, scenario, registry);
  const first = await execute({
    actor: scenario.actor,
    planId: plan.id,
    fingerprint: plan.fingerprint,
  });
  assert.equal(first.status, "retryable");
  if (kind === "drift") {
    await db
      .update(persons)
      .set({ firstName: "Changed", updatedAt: new Date() })
      .where(eq(persons.id, scenario.people[0]!.id));
  }
  if (kind === "tenancy") {
    const [sendingChurch] = await db
      .insert(sendingChurches)
      .values({ name: "__evry malformed invitation tenancy__" })
      .returning({ id: sendingChurches.id });
    assert.ok(sendingChurch);
    await db
      .update(users)
      .set({ sendingChurchId: sendingChurch.id })
      .where(eq(users.id, scenario.guestUsers[0]!.id));
  }
  const second = await execute({
    actor: scenario.actor,
    planId: plan.id,
    fingerprint: plan.fingerprint,
  });
  assert.equal(second.status, "partially_failed");
  assert.deepEqual(
    second.steps.map(({ status }) => status),
    ["completed", "refused", "skipped"]
  );
  assert.equal(
    await db
      .select({ id: meetingAttendance.id })
      .from(meetingAttendance)
      .where(eq(meetingAttendance.churchId, scenario.churchId))
      .then((rows) => rows.length),
    0
  );
  assert.equal(
    await db
      .select({ id: communications.id })
      .from(communications)
      .where(eq(communications.churchId, scenario.churchId))
      .then((rows) => rows.length),
    0
  );
}

async function main() {
  const modules = await loadModules();
  const mode = process.argv[2] ?? "all";
  if (mode === "all" || mode === "end_to_end") {
    await proveSendOnlyRetry(modules);
  }
  if (mode === "all" || mode === "partial_failure") {
    await proveDependencyRefusal(modules, "missing");
    await proveDependencyRefusal(modules, "tampered");
    await proveDependencyRefusal(modules, "drift");
    await proveDependencyRefusal(modules, "tenancy");
  }
  assert.ok(
    mode === "all" || mode === "end_to_end" || mode === "partial_failure"
  );
  console.log(
    "Meeting invitation live proof passed: atomic create/guest success, fresh recipe reuse, missing/tampered/version/tenancy drift refusal, and send-only retry"
  );
}

main().catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
});
