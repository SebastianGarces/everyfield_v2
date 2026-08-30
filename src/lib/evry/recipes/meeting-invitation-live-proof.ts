import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { mock } from "node:test";

import { and, eq } from "drizzle-orm";

import { db } from "@/db";
import {
  churches,
  communications,
  evryExecutionOutcomes,
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
    revalidatePlan: modules.planResume.revalidateProductionEvryConversationPlan,
    resume: modules.conversations.resumeEvryConversation,
    append: modules.conversations.appendTrustedEvryConversationMessage,
    confirm: modules.planService.confirmEvryActionPlan,
    async execute(input) {
      return modules.recipes.runEvryRecipe({
        actor: input.actor,
        planId: input.planId,
        fingerprint: input.fingerprint,
        registry,
      });
    },
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
  const plan = await persistApprovedPlan(modules, scenario, registry);
  const first = await modules.recipes.runEvryRecipe({
    actor: scenario.actor,
    planId: plan.id,
    fingerprint: plan.fingerprint,
    registry,
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
  const second = await modules.recipes.runEvryRecipe({
    actor: scenario.actor,
    planId: plan.id,
    fingerprint: plan.fingerprint,
    registry,
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
    "Meeting invitation live proof passed: atomic create/guest success, missing/tampered/version/tenancy drift refusal, and send-only retry"
  );
}

main().catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
});
