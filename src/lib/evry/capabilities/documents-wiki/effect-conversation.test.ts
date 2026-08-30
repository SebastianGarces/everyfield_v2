import assert from "node:assert/strict";
import { test } from "node:test";

import type { EvryCapabilityConversationSelectionInput } from "@/lib/evry/capabilities/conversation";
import {
  evryConversationIdSchema,
  evryConversationPlanIdentitySchema,
  initialEvryConversationState,
} from "@/lib/evry/conversations/contract";
import type { EvryStoredConversation } from "@/lib/evry/conversations/repository";
import type { EvryPlantActor } from "@/lib/evry/eligibility/viewer";
import {
  deriveEvryPlanRequestKey,
  fingerprintEvryActionPlan,
  fingerprintEvryActionPlanIntent,
  parseEvryActionPlanCandidate,
} from "@/lib/evry/plans";
import type { StoredEvryActionPlan } from "@/lib/evry/plans/repository";

import { createDocumentsWikiEffectConversationContinuation } from "./effect-conversation";
import {
  DOCUMENTS_WIKI_PLAN_REGISTRY,
  DOCUMENTS_WIKI_REVIEW_REGISTRY,
} from "./effects";
import { trustedReviewForEvryPlanDocument } from "@/lib/evry/artifacts/trusted-plan-review";

const ACTOR = {
  userId: "10000000-0000-4000-8000-000000000001",
  plantId: "20000000-0000-4000-8000-000000000001",
  seat: "owner",
} as unknown as EvryPlantActor;
const CONVERSATION_ID = "30000000-0000-4000-8000-000000000001";
const USER_REQUEST_KEY = "40000000-0000-4000-8000-000000000001";
const PLAN_ID = "50000000-0000-4000-8000-000000000001";
const CREATED_AT = new Date("2026-08-30T12:00:00.000Z");
const EXPIRES_AT = new Date("2026-08-30T12:15:00.000Z");

function conversation(): EvryStoredConversation {
  return {
    id: evryConversationIdSchema.parse(CONVERSATION_ID),
    actorUserId: ACTOR.userId,
    plantId: ACTOR.plantId,
    title: "Wiki bookmark",
    createdAt: CREATED_AT,
    lastActivityAt: CREATED_AT,
    activePlan: null,
    stateVersion: 0,
    state: initialEvryConversationState(),
    messages: [],
  };
}

function continuationInput(): EvryCapabilityConversationSelectionInput {
  return {
    actor: ACTOR,
    conversation: conversation(),
    userRequestKey: USER_REQUEST_KEY,
    literalUserText: "Bookmark wiki article: discovery/calling",
    pageContext: null,
    requestPageContext: null,
    now: CREATED_AT,
  };
}

function storedPlan(): StoredEvryActionPlan {
  const document = parseEvryActionPlanCandidate({
    candidate: {
      steps: [
        {
          id: "bookmark",
          capabilityIdentity: "wiki.bookmark.set",
          arguments: {
            slug: "discovery/calling",
            title: "Calling",
            sourceArticleId: "60000000-0000-4000-8000-000000000001",
            sourceUpdatedAt: "2026-08-30 11:59:59.123456",
            articleFingerprint: "a".repeat(64),
            expectedBookmarked: false,
            afterBookmarked: true,
          },
          dependsOn: [],
        },
      ],
    },
    registry: DOCUMENTS_WIKI_PLAN_REGISTRY,
    eligibleCapabilities: [{ identity: "wiki.bookmark.set" }],
  });
  const base = { actorUserId: ACTOR.userId, plantId: ACTOR.plantId, document };
  return {
    id: PLAN_ID,
    ...base,
    requestKey: deriveEvryPlanRequestKey("documents-wiki-bookmark", [
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

test("a durable Documents/wiki plan is recovered before mutable source resolution", async () => {
  const stored = storedPlan();
  const plan = evryConversationPlanIdentitySchema.parse({
    planId: stored.id,
    fingerprint: stored.fingerprint,
  });
  const review = trustedReviewForEvryPlanDocument({
    plan,
    document: stored.document as Parameters<
      typeof trustedReviewForEvryPlanDocument
    >[0]["document"],
    reviewRegistry: DOCUMENTS_WIKI_REVIEW_REGISTRY,
  });
  assert.ok(review);
  let committed: StoredEvryActionPlan | null = null;
  let sourceResolutions = 0;
  const continuation = createDocumentsWikiEffectConversationContinuation({
    async findPlanByRequestKey() {
      return committed;
    },
    async propose() {
      sourceResolutions += 1;
      committed = stored;
      return { plan, confirmation: review.confirmation };
    },
  });
  const input = continuationInput();
  const first = await continuation.continue(input);
  assert.equal(sourceResolutions, 1);
  const recovered = await continuation.continue(input);
  assert.equal(sourceResolutions, 1);
  assert.deepEqual(recovered, first);
});

test("request-key recovery refuses a different capability identity", async () => {
  const stored = storedPlan();
  const document = stored.document as {
    version: number;
    steps: readonly Record<string, unknown>[];
  };
  const continuation = createDocumentsWikiEffectConversationContinuation({
    async findPlanByRequestKey() {
      return {
        ...stored,
        document: {
          ...document,
          steps: [
            { ...document.steps[0], capabilityIdentity: "wiki.feedback.set" },
          ],
        },
      };
    },
    async propose() {
      throw new Error("mutable resolution must not run");
    },
  });
  await assert.rejects(
    continuation.continue(continuationInput()),
    /integrity validation|does not match/
  );
});
