import assert from "node:assert/strict";
import test from "node:test";

import { trustedReviewForEvryPlanDocument } from "@/lib/evry/artifacts/trusted-plan-review";
import { composeEvryCapabilityConversationContinuations } from "@/lib/evry/capabilities/conversation";
import { evryConversationPlanIdentitySchema } from "@/lib/evry/conversations/contract";
import type { EvryStoredConversation } from "@/lib/evry/conversations/repository";
import type { EvryPlantActor } from "@/lib/evry/eligibility/viewer";
import {
  deriveEvryPlanRequestKey,
  fingerprintEvryActionPlan,
  fingerprintEvryActionPlanIntent,
  parseEvryActionPlanCandidate,
} from "@/lib/evry/plans";
import type { StoredEvryActionPlan } from "@/lib/evry/plans/repository";

import { createPlatformEvryConversationContinuation } from "./conversation";
import { SUBMIT_FEEDBACK_IDENTITY, feedbackArgumentsSchema } from "./effects";
import {
  PLATFORM_EVRY_PLAN_REGISTRY,
  PLATFORM_EVRY_REVIEW_REGISTRY,
} from "./runtime";

const actor = {
  userId: "10000000-0000-4000-8000-000000000001",
  plantId: "20000000-0000-4000-8000-000000000001",
  seat: "owner",
} as unknown as EvryPlantActor;
const conversationId = "30000000-0000-4000-8000-000000000001";
const userRequestKey = "40000000-0000-4000-8000-000000000001";
const createdAt = new Date("2030-01-01T12:00:00.000Z");
const expiresAt = new Date("2030-01-01T12:15:00.000Z");

function conversation(): EvryStoredConversation {
  return {
    id: conversationId,
    actorUserId: actor.userId,
    plantId: actor.plantId,
    title: "Feedback",
    createdAt,
    lastActivityAt: createdAt,
    activePlan: null,
    stateVersion: 1,
    state: {},
    messages: [],
  } as unknown as EvryStoredConversation;
}

function storedPlan(): StoredEvryActionPlan {
  const document = parseEvryActionPlanCandidate({
    candidate: {
      steps: [
        {
          id: "submit-feedback",
          capabilityIdentity: SUBMIT_FEEDBACK_IDENTITY,
          arguments: feedbackArgumentsSchema.parse({
            feedbackId: "50000000-0000-4000-8000-000000000001",
            category: "bug",
            description: "Literal committed feedback",
            pageUrl: "/notifications",
          }),
          dependsOn: [],
        },
      ],
    },
    registry: PLATFORM_EVRY_PLAN_REGISTRY,
    eligibleCapabilities: [{ identity: SUBMIT_FEEDBACK_IDENTITY }],
  });
  const base = {
    actorUserId: actor.userId,
    plantId: actor.plantId,
    document,
  };
  return {
    id: "60000000-0000-4000-8000-000000000001",
    ...base,
    requestKey: deriveEvryPlanRequestKey("platform-feedback", [
      actor.userId,
      actor.plantId,
      conversationId,
      userRequestKey,
    ]),
    intentFingerprint: fingerprintEvryActionPlanIntent(base),
    fingerprint: fingerprintEvryActionPlan({ ...base, expiresAt }),
    createdAt,
    expiresAt,
    supersedesPlanId: null,
    status: "awaiting_confirmation",
    stateVersion: 0,
    stateChangedAt: createdAt,
  };
}

test("a committed Platform plan is recovered after response loss without reproposal", async () => {
  const stored = storedPlan();
  const plan = evryConversationPlanIdentitySchema.parse({
    planId: stored.id,
    fingerprint: stored.fingerprint,
  });
  const document = stored.document as Parameters<
    typeof trustedReviewForEvryPlanDocument
  >[0]["document"];
  const review = trustedReviewForEvryPlanDocument({
    plan,
    document,
    reviewRegistry: PLATFORM_EVRY_REVIEW_REGISTRY,
  });
  assert.ok(review);
  let committed: StoredEvryActionPlan | null = null;
  let proposals = 0;
  let loseFirstResponse = true;
  const continuation = composeEvryCapabilityConversationContinuations([
    createPlatformEvryConversationContinuation({
      async findPlan() {
        return committed;
      },
      async propose(input) {
        proposals += 1;
        assert.equal(input.selection.kind, "feedback");
        committed = stored;
        return { plan, confirmation: review.confirmation };
      },
      async read() {
        throw new Error("effect replay must not run a read");
      },
    }),
  ]);
  const input = {
    actor,
    conversation: conversation(),
    userRequestKey,
    literalUserText:
      'submit feedback {"category":"bug","description":"Literal committed feedback","pageUrl":"/notifications"}',
    pageContext: null,
    requestPageContext: null,
    now: createdAt,
    store: {
      async append(request: { artifacts: unknown[] }) {
        if (loseFirstResponse) {
          loseFirstResponse = false;
          throw new Error("response lost after plan commit");
        }
        assert.match(
          JSON.stringify(request.artifacts),
          /Literal committed feedback/
        );
        return conversation();
      },
    },
  } as never;

  await assert.rejects(continuation(input), /response lost after plan commit/);
  assert.equal(proposals, 1);
  await continuation(input);
  assert.equal(proposals, 1);
});

test("a recovered request-key plan with another capability fails closed", async () => {
  const stored = storedPlan();
  const document = stored.document as {
    version: number;
    steps: readonly Record<string, unknown>[];
  };
  const continuation = createPlatformEvryConversationContinuation({
    async findPlan() {
      return {
        ...stored,
        document: {
          ...document,
          steps: [
            {
              ...document.steps[0],
              capabilityIdentity: "notifications.feed.mark-all-read",
            },
          ],
        },
      };
    },
    async propose() {
      throw new Error("proposal must not run");
    },
    async read() {
      throw new Error("read must not run");
    },
  });
  await assert.rejects(
    continuation.continue({
      actor,
      conversation: conversation(),
      userRequestKey,
      literalUserText:
        'submit feedback {"category":"bug","description":"Literal committed feedback"}',
      pageContext: null,
      requestPageContext: null,
      now: createdAt,
    } as never),
    /integrity validation/
  );
});

test("an incomplete platform effect returns a typed clarification without reading or planning", async () => {
  let boundaryCalls = 0;
  const continuation = createPlatformEvryConversationContinuation({
    async findPlan() {
      boundaryCalls += 1;
      return null;
    },
    async propose() {
      boundaryCalls += 1;
      return null;
    },
    async read() {
      boundaryCalls += 1;
      return null;
    },
  });

  const result = await continuation.continue({
    actor,
    conversation: conversation(),
    userRequestKey,
    literalUserText: "mark notification read",
    pageContext: null,
    requestPageContext: null,
    now: createdAt,
  });

  assert.equal(boundaryCalls, 0);
  assert.equal(result?.artifacts[0]?.kind, "clarification");
  assert.match(result?.body ?? "", /which notification/i);
});
