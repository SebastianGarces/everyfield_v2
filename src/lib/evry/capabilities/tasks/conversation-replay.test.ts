import assert from "node:assert/strict";
import test from "node:test";

import type { EvryStoredConversation } from "@/lib/evry/conversations/repository";
import { evryConversationPlanIdentitySchema } from "@/lib/evry/conversations/contract";
import type { EvryPlantActor } from "@/lib/evry/eligibility/viewer";
import {
  deriveEvryPlanRequestKey,
  fingerprintEvryActionPlan,
  fingerprintEvryActionPlanIntent,
  parseEvryActionPlanCandidate,
  parseStoredEvryActionPlan,
} from "@/lib/evry/plans";
import type { StoredEvryActionPlan } from "@/lib/evry/plans/repository";
import { trustedReviewForEvryPlanDocument } from "@/lib/evry/artifacts/trusted-plan-review";

import { createTaskEvryConversationContinuation } from "./conversation";
import { TASK_ACTION_CONTRACTS } from "./contracts";
import { TASK_PLAN_REGISTRY } from "./runtime";
import { TASK_REVIEW_REGISTRY } from "./review";
import { taskEffectPlanFixture } from "./test-fixtures";

const ACTOR = {
  userId: "10000000-0000-4000-8000-000000000001",
  plantId: "20000000-0000-4000-8000-000000000001",
  seat: "owner",
} as unknown as EvryPlantActor;
const CONVERSATION_ID = "30000000-0000-4000-8000-000000000001";
const USER_REQUEST_KEY = "40000000-0000-4000-8000-000000000001";
const PLAN_ID = "50000000-0000-4000-8000-000000000001";
const CREATED_AT = new Date("2026-08-29T12:00:00.000Z");
const EXPIRES_AT = new Date("2026-08-29T12:15:00.000Z");

function conversation(): EvryStoredConversation {
  return {
    id: CONVERSATION_ID,
    actorUserId: ACTOR.userId,
    plantId: ACTOR.plantId,
    title: "Create task",
    createdAt: CREATED_AT,
    lastActivityAt: CREATED_AT,
    activePlan: null,
    stateVersion: 1,
    state: {},
    messages: [],
  } as unknown as EvryStoredConversation;
}

function storedPlan(): StoredEvryActionPlan {
  const identity = TASK_ACTION_CONTRACTS.createTaskAction.operationId;
  const document = parseEvryActionPlanCandidate({
    candidate: {
      steps: [
        {
          id: identity,
          capabilityIdentity: identity,
          arguments: taskEffectPlanFixture("createTaskAction"),
          dependsOn: [],
        },
      ],
    },
    registry: TASK_PLAN_REGISTRY,
    eligibleCapabilities: [{ identity }],
  });
  const base = {
    actorUserId: ACTOR.userId,
    plantId: ACTOR.plantId,
    document,
  };
  return {
    id: PLAN_ID,
    ...base,
    requestKey: deriveEvryPlanRequestKey("tasks-createtask", [
      ACTOR.userId,
      ACTOR.plantId,
      CONVERSATION_ID,
      USER_REQUEST_KEY,
    ]),
    intentFingerprint: fingerprintEvryActionPlanIntent(base),
    fingerprint: fingerprintEvryActionPlan({ ...base, expiresAt: EXPIRES_AT }),
    createdAt: CREATED_AT,
    expiresAt: EXPIRES_AT,
    supersedesPlanId: null,
    status: "awaiting_confirmation",
    stateVersion: 0,
    stateChangedAt: CREATED_AT,
  };
}

test("Task response-loss replay recovers its stored plan before mutable resolution", async () => {
  const stored = storedPlan();
  let resolveCalls = 0;
  let proposalCalls = 0;
  const continuation = createTaskEvryConversationContinuation({
    async findPlanByRequestKey() {
      return stored;
    },
    async resolve() {
      resolveCalls += 1;
      throw new Error("mutable Task source must not be read on replay");
    },
    async propose() {
      proposalCalls += 1;
      throw new Error("a recovered plan must not be proposed again");
    },
  });

  const result = await continuation.continue({
    actor: ACTOR,
    conversation: conversation(),
    userRequestKey: USER_REQUEST_KEY,
    literalUserText: "create task: title=Original approved task",
    pageContext: null,
    requestPageContext: null,
    now: CREATED_AT,
  } as never);

  assert.ok(result);
  assert.equal(resolveCalls, 0);
  assert.equal(proposalCalls, 0);
  assert.match(
    JSON.stringify(result.artifacts),
    /Original approved task|Task 1/
  );
  assert.equal(result.activePlan?.mode, "set");
  assert.equal(result.activePlan?.plan.planId, PLAN_ID);
});

test("Task request-key recovery refuses a stored plan for another capability", async () => {
  const stored = storedPlan();
  const document = stored.document as {
    version: number;
    steps: readonly Record<string, unknown>[];
  };
  const continuation = createTaskEvryConversationContinuation({
    async findPlanByRequestKey() {
      return {
        ...stored,
        document: {
          ...document,
          steps: [
            {
              ...document.steps[0],
              capabilityIdentity:
                TASK_ACTION_CONTRACTS.deleteTaskAction.operationId,
            },
          ],
        },
      };
    },
    async resolve() {
      throw new Error("mutable Task source must not be read");
    },
    async propose() {
      throw new Error("proposal must not run");
    },
  });

  await assert.rejects(
    continuation.continue({
      actor: ACTOR,
      conversation: conversation(),
      userRequestKey: USER_REQUEST_KEY,
      literalUserText: "create task: title=Original approved task",
      pageContext: null,
      requestPageContext: null,
      now: CREATED_AT,
    } as never),
    /integrity validation|does not match/
  );
});

test("Plant insight context reaches ordinary Task resolution and review without supplying effect arguments", async () => {
  const stored = storedPlan();
  const plan = evryConversationPlanIdentitySchema.parse({
    planId: stored.id,
    fingerprint: stored.fingerprint,
  });
  const review = trustedReviewForEvryPlanDocument({
    plan,
    document: parseStoredEvryActionPlan({
      document: stored.document,
      registry: TASK_PLAN_REGISTRY,
    }),
    reviewRegistry: TASK_REVIEW_REGISTRY,
  });
  assert.ok(review);

  let resolvedInput:
    | Readonly<{
        selection: Readonly<Record<string, unknown>>;
        pageContext: Readonly<Record<string, unknown>> | null;
      }>
    | undefined;
  const continuation = createTaskEvryConversationContinuation({
    async findPlanByRequestKey() {
      return null;
    },
    async resolve(input) {
      resolvedInput = {
        selection: input.selection,
        pageContext: input.pageContext,
      };
      return {
        exportName: "createTaskAction",
        arguments: taskEffectPlanFixture("createTaskAction"),
      };
    },
    async propose(input) {
      assert.equal(input.resolved.exportName, "createTaskAction");
      return { plan, confirmation: review.confirmation };
    },
  });

  const result = await continuation.continue({
    actor: ACTOR,
    conversation: conversation(),
    userRequestKey: USER_REQUEST_KEY,
    literalUserText: "create task: title=Clarify volunteer onboarding",
    pageContext: {
      kind: "plant_insight",
      recordId: "60000000-0000-4000-8000-000000000001",
      label: "Observation: Volunteer onboarding is unclear",
    },
    requestPageContext: {
      kind: "plant_insight",
      recordId: "60000000-0000-4000-8000-000000000001",
    },
    now: CREATED_AT,
  } as never);

  assert.deepEqual(resolvedInput, {
    selection: {
      kind: "effect",
      exportName: "createTaskAction",
      values: { title: "Clarify volunteer onboarding" },
    },
    pageContext: {
      kind: "plant_insight",
      recordId: "60000000-0000-4000-8000-000000000001",
      label: "Observation: Volunteer onboarding is unclear",
    },
  });
  assert.equal(
    JSON.stringify(resolvedInput?.selection).includes("60000000"),
    false,
    "the source id must not become a Task effect argument"
  );
  assert.equal(result?.activePlan?.mode, "set");
  assert.equal(result?.artifacts[0]?.kind, "confirmation");
});
