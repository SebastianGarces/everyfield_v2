import assert from "node:assert/strict";
import { mock } from "node:test";

const START = new Date("2026-08-20T12:00:00.000Z");
const RETURN = new Date("2026-08-28T12:00:00.000Z");
const LITERAL = "  Create café follow-up — keep these bytes.  ";

function required(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`missing ${name}`);
  return value;
}

const mode = required("EVRY_CONVERSATION_PROOF_MODE");
if (mode !== "create" && mode !== "resume" && mode !== "retry") {
  throw new Error("invalid EVRY_CONVERSATION_PROOF_MODE");
}
const plantId = required("EVRY_CONVERSATION_PROOF_PLANT_ID");
const actorUserId = required("EVRY_CONVERSATION_PROOF_ACTOR_ID");
const planId = required("EVRY_CONVERSATION_PROOF_PLAN_ID");
const planFingerprint = required("EVRY_CONVERSATION_PROOF_PLAN_FINGERPRINT");
const firstPersonId = required("EVRY_CONVERSATION_PROOF_PERSON_A_ID");
const secondPersonId = required("EVRY_CONVERSATION_PROOF_PERSON_B_ID");

mock.module("@/lib/auth/session", {
  namedExports: {
    verifySession: async () => ({
      user: {
        id: actorUserId,
        churchId: plantId,
        sendingChurchId: null,
        sendingNetworkId: null,
        seat: "owner",
      },
    }),
  },
});

function request(url: string, body: unknown): Request {
  return new Request(url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

async function response(result: Response) {
  return {
    status: result.status,
    cacheControl: result.headers.get("cache-control"),
    body: await result.json(),
  };
}

async function createProof(): Promise<void> {
  const contract = await import("./contract");
  const artifacts = await import("./artifacts");
  const repository = await import("./repository");
  const service = await import("./service");
  const viewer = await import("@/lib/evry/eligibility/viewer");
  const route = await import("@/app/api/evry/conversations/route");

  const requestKey = required("EVRY_CONVERSATION_PROOF_CREATE_REQUEST_KEY");
  const clarificationRequestKey = required(
    "EVRY_CONVERSATION_PROOF_CLARIFICATION_REQUEST_KEY"
  );
  const clarificationMessageId = required(
    "EVRY_CONVERSATION_PROOF_CLARIFICATION_MESSAGE_ID"
  );
  const choiceRequestKey = required(
    "EVRY_CONVERSATION_PROOF_CHOICE_REQUEST_KEY"
  );
  const choiceMessageId = required("EVRY_CONVERSATION_PROOF_CHOICE_MESSAGE_ID");
  const choiceId = required("EVRY_CONVERSATION_PROOF_CHOICE_ID");
  const confirmationRequestKey = required(
    "EVRY_CONVERSATION_PROOF_CONFIRMATION_REQUEST_KEY"
  );
  const confirmationMessageId = required(
    "EVRY_CONVERSATION_PROOF_CONFIRMATION_MESSAGE_ID"
  );
  const created = await response(
    await route.createEvryConversationCreatePost({
      now: () => START,
      create: async (input) => {
        try {
          return await service.createEvryConversation(input);
        } catch (error) {
          console.error("fresh-process create cause", error);
          throw error;
        }
      },
    })(
      request("http://localhost/api/evry/conversations", {
        requestKey,
        message: LITERAL,
        pageContext: { kind: "person", recordId: firstPersonId },
      })
    )
  );
  assert.equal(created.status, 201);
  assert.equal(created.cacheControl, "private, no-store");
  assert.equal(created.body.status, "created");
  assert.equal(created.body.conversation.messages[0].body, LITERAL);

  const actor = await viewer.requireEvryPlantViewer();
  const conversationId = contract.evryConversationIdSchema.parse(
    created.body.conversation.id
  );
  const current = await repository.findEvryConversationRecord({
    conversationId,
    actorUserId,
    plantId,
  });
  assert.ok(current);
  const sourceMessageId = current.messages[0]?.id;
  assert.ok(sourceMessageId);
  const referencesState = contract.evryConversationStateDocumentSchema.parse({
    version: 1,
    resolvedReferences: [
      {
        key: "person.alex",
        entityType: "person",
        entityId: firstPersonId,
        label: "Alex Rivera",
        distinguishingFacts: [{ label: "Role", value: "Planter" }],
        sourceLink: {
          label: "Alex Rivera",
          href: `/people/${firstPersonId}`,
        },
        aliases: ["alex", "her"],
        sourceMessageId,
        resolvedAt: START.toISOString(),
        validThrough: "2026-09-20T12:00:00.000Z",
      },
      {
        key: "person.sam",
        entityType: "person",
        entityId: secondPersonId,
        label: "Sam Lee",
        distinguishingFacts: [{ label: "Role", value: "Team member" }],
        sourceLink: {
          label: "Sam Lee",
          href: `/people/${secondPersonId}`,
        },
        aliases: ["her", "sam"],
        sourceMessageId,
        resolvedAt: START.toISOString(),
        validThrough: "2026-09-20T12:00:00.000Z",
      },
    ],
    explicitChoices: [],
    activeRecipe: {
      identity: "task.follow_up",
      inputs: [{ key: "person_id", value: secondPersonId }],
      updatedAt: START.toISOString(),
    },
    pendingClarification: null,
    completedSteps: [],
    summary: {
      text: "Two people were resolved and Sam was explicitly selected.",
      throughSequence: 0,
    },
  });
  const plan = contract.evryConversationPlanIdentitySchema.parse({
    planId,
    fingerprint: planFingerprint,
  });
  const clarification = artifacts.parseEvryConversationArtifactDocument({
    kind: "clarification",
    mode: "choice",
    entityType: "person",
    prompt: "Which person do you mean?",
    choices: [
      {
        entityType: "person",
        id: firstPersonId,
        label: "Alex Rivera",
        distinguishingFacts: [{ label: "Role", value: "Planter" }],
        sourceLink: {
          label: "Alex Rivera",
          href: `/people/${firstPersonId}`,
        },
      },
      {
        entityType: "person",
        id: secondPersonId,
        label: "Sam Lee",
        distinguishingFacts: [{ label: "Role", value: "Team member" }],
        sourceLink: {
          label: "Sam Lee",
          href: `/people/${secondPersonId}`,
        },
      },
    ],
    defaultChoiceId: null,
  });
  const clarified = await service.appendTrustedEvryConversationMessage({
    messageId: contract.evryConversationMessageIdSchema.parse(
      clarificationMessageId
    ),
    actor,
    conversationId,
    requestKey: contract.evryConversationRequestKeySchema.parse(
      clarificationRequestKey
    ),
    expectedStateVersion: current.stateVersion,
    state: referencesState,
    author: "assistant",
    body: "Which person do you mean?",
    pageContext: null,
    relevanceKeys: [],
    deliveryStatus: "complete",
    artifacts: [clarification],
    idempotencyContext: { status: "none" },
    activePlan: { mode: "preserve" },
    now: new Date(START.valueOf() + 1_000),
  });
  const clarificationArtifactId = clarified.messages.find(
    ({ requestKey: storedKey }) => storedKey === clarificationRequestKey
  )?.artifacts[0]?.id;
  assert.ok(clarificationArtifactId);

  const choiceState = contract.evryConversationStateDocumentSchema.parse({
    ...referencesState,
    explicitChoices: [
      {
        id: choiceId,
        clarificationArtifactId,
        offeredReferences: [
          {
            referenceKey: "person.alex",
            entityType: "person",
            entityId: firstPersonId,
          },
          {
            referenceKey: "person.sam",
            entityType: "person",
            entityId: secondPersonId,
          },
        ],
        referenceKey: "person.sam",
        selectedEntityId: secondPersonId,
        sourceMessageId: choiceMessageId,
        selectedAt: new Date(START.valueOf() + 2_000).toISOString(),
      },
    ],
  });
  const chosen = await service.appendTrustedEvryConversationMessage({
    messageId: contract.evryConversationMessageIdSchema.parse(choiceMessageId),
    actor,
    conversationId,
    requestKey:
      contract.evryConversationRequestKeySchema.parse(choiceRequestKey),
    expectedStateVersion: clarified.stateVersion,
    state: choiceState,
    author: "user",
    body: "Sam Lee",
    pageContext: null,
    relevanceKeys: [
      contract.evryConversationRelevanceKeySchema.parse("person.sam"),
    ],
    deliveryStatus: "complete",
    artifacts: [],
    idempotencyContext: { status: "none" },
    activePlan: { mode: "preserve" },
    now: new Date(START.valueOf() + 2_000),
  });
  const confirmation = artifacts.parseEvryConversationArtifactDocument({
    kind: "confirmation",
    plan,
    title: "Create the follow-up task",
    actionLabel: "Create task",
    items: [{ label: "Person", value: "Sam Lee" }],
    consequences: ["One task will be created."],
  });
  const appended = await service.appendTrustedEvryConversationMessage({
    messageId: contract.evryConversationMessageIdSchema.parse(
      confirmationMessageId
    ),
    actor,
    conversationId,
    requestKey: contract.evryConversationRequestKeySchema.parse(
      confirmationRequestKey
    ),
    expectedStateVersion: chosen.stateVersion,
    state: choiceState,
    author: "assistant",
    body: "Review the task before creating it.",
    pageContext: null,
    relevanceKeys: [],
    deliveryStatus: "complete",
    artifacts: [confirmation],
    idempotencyContext: { status: "none" },
    activePlan: { mode: "set", plan },
    now: new Date(START.valueOf() + 3_000),
  });
  assert.equal(appended.messages.length, 4);
  assert.equal(
    appended.state.explicitChoices[0]?.selectedEntityId,
    secondPersonId
  );
  process.stdout.write(`${JSON.stringify({ conversationId })}\n`);
}

async function resumeProof(): Promise<void> {
  const conversationId = required("EVRY_CONVERSATION_PROOF_CONVERSATION_ID");
  const continueRequestKey = required(
    "EVRY_CONVERSATION_PROOF_CONTINUE_REQUEST_KEY"
  );
  const getRoute =
    await import("@/app/api/evry/conversations/[conversationId]/route");
  const messageRoute =
    await import("@/app/api/evry/conversations/[conversationId]/messages/route");
  const service = await import("./service");
  const planResume = await import("./plan-resume");
  const fixtures = await import("@/lib/evry/plans/fixtures.test-helper");
  const plans = await import("@/lib/evry/plans/repository");

  const revalidatePlan = planResume.createEvryConversationPlanResumeRevalidator(
    {
      registry: fixtures.PLAN_FIXTURE_REGISTRY,
      loadExact: plans.findExactEvryActionPlan,
      eligibleCapabilitiesForActor: () =>
        fixtures.ELIGIBLE_FIXTURE_CAPABILITIES,
      // This fixture is expired at RETURN. A target check here would mean the
      // resume boundary evaluated a dead plan as current.
      targetIsCurrent: async () => {
        assert.fail("an expired plan must not reach target validation");
      },
    }
  );

  const get = getRoute.createEvryConversationGet({
    now: () => RETURN,
    resume: (input) =>
      service.resumeEvryConversation({
        ...input,
        revalidatePlan,
      }),
  });
  const reopened = await response(
    await get(new Request("http://localhost/api/evry/conversations/id"), {
      params: Promise.resolve({ conversationId }),
    })
  );
  assert.equal(reopened.status, 200);
  assert.equal(reopened.cacheControl, "private, no-store");
  assert.equal(reopened.body.status, "available");
  assert.equal(reopened.body.conversation.messages[0].body, LITERAL);
  assert.equal(reopened.body.conversation.messages.length, 4);
  assert.equal(reopened.body.conversation.activePlan.status, "expired");
  assert.equal(reopened.body.conversation.activePlan.confirmable, false);
  assert.equal(
    reopened.body.conversation.state.explicitChoices[0].selectedEntityId,
    secondPersonId
  );

  const post = messageRoute.createEvryConversationMessagePost({
    now: () => RETURN,
    continueConversation: (input) =>
      service.continueEvryConversation({
        ...input,
        revalidatePlan,
      }),
  });
  const continued = await response(
    await post(
      request(
        `http://localhost/api/evry/conversations/${conversationId}/messages`,
        { requestKey: continueRequestKey, message: "Add her to it." }
      ),
      { params: Promise.resolve({ conversationId }) }
    )
  );
  assert.equal(continued.status, 200);
  assert.equal(continued.cacheControl, "private, no-store");
  assert.equal(continued.body.status, "continued");
  assert.deepEqual(continued.body.reference, {
    status: "resolved",
    entityType: "person",
    entityId: secondPersonId,
  });
  assert.equal(
    continued.body.conversation.messages.at(-1).body,
    "Add her to it."
  );
  process.stdout.write("Evry fresh-process resume proof passed\n");
}

async function changedStateRetryProof(): Promise<void> {
  const conversationId = required("EVRY_CONVERSATION_PROOF_CONVERSATION_ID");
  const continueRequestKey = required(
    "EVRY_CONVERSATION_PROOF_CONTINUE_REQUEST_KEY"
  );
  const messageRoute =
    await import("@/app/api/evry/conversations/[conversationId]/messages/route");
  const retried = await response(
    await messageRoute.POST(
      request(
        `http://localhost/api/evry/conversations/${conversationId}/messages`,
        { requestKey: continueRequestKey, message: "Add her to it." }
      ),
      { params: Promise.resolve({ conversationId }) }
    )
  );
  assert.deepEqual(retried, {
    status: 409,
    cacheControl: "private, no-store",
    body: { status: "stale" },
  });
  process.stdout.write("Evry changed-state replay proof passed\n");
}

void (
  mode === "create"
    ? createProof()
    : mode === "resume"
      ? resumeProof()
      : changedStateRetryProof()
).catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
});
