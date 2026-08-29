import assert from "node:assert/strict";
import test from "node:test";

import { EVRY_COMMUNICATION_MAX_RECIPIENTS } from "@/lib/communication/evry-send";
import { storedTemplateContent } from "@/lib/communication/templates";
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

import { createCommunicationEvryConversationContinuation } from "./conversation";
import { COMMUNICATION_MESSAGE_SEND_IDENTITY } from "./messages";
import { communicationEvryRefusal } from "./refusal";
import {
  COMMUNICATION_EVRY_PLAN_REGISTRY,
  COMMUNICATION_EVRY_REVIEW_REGISTRY,
} from "./runtime";

const ACTOR = {
  userId: "10000000-0000-4000-8000-000000000001",
  plantId: "20000000-0000-4000-8000-000000000001",
  seat: "owner",
} as unknown as EvryPlantActor;
const CONVERSATION_ID = "30000000-0000-4000-8000-000000000001";
const USER_REQUEST_KEY = "40000000-0000-4000-8000-000000000001";
const PLAN_ID = "50000000-0000-4000-8000-000000000001";
const PERSON_ID = "60000000-0000-4000-8000-000000000001";
const CREATED_AT = new Date("2026-08-29T12:00:00.000Z");
const EXPIRES_AT = new Date("2026-08-29T12:15:00.000Z");

function conversation(): EvryStoredConversation {
  return {
    id: CONVERSATION_ID,
    actorUserId: ACTOR.userId,
    plantId: ACTOR.plantId,
    title: "Send email",
    createdAt: CREATED_AT,
    lastActivityAt: CREATED_AT,
    activePlan: null,
    stateVersion: 1,
    state: {},
    messages: [],
  } as unknown as EvryStoredConversation;
}

function storedPlan(): StoredEvryActionPlan {
  const content = storedTemplateContent("<p>Original approved draft</p>");
  const recipientIds = Array.from(
    { length: EVRY_COMMUNICATION_MAX_RECIPIENTS },
    (_, index) =>
      `60000000-0000-4000-8000-${String(index + 1).padStart(12, "0")}`
  );
  const document = parseEvryActionPlanCandidate({
    candidate: {
      steps: [
        {
          id: "send-message",
          capabilityIdentity: COMMUNICATION_MESSAGE_SEND_IDENTITY,
          arguments: {
            communicationId: "70000000-0000-4000-8000-000000000001",
            recipientSource: { kind: "people", recipientIds },
            audience: {
              subject: "Original subject",
              body: content.body,
              bodyHtml: content.bodyHtml,
              channel: "email",
              templateId: null,
              meetingId: null,
              messageClass: "relationship_message",
              recipients: recipientIds.map((personId, index) => ({
                personId,
                label: `Original recipient ${index + 1}`,
                email: `original-${index + 1}@example.test`,
                subject: "Original subject",
                bodyHtml: content.bodyHtml,
                bodyText: content.body,
              })),
              exclusions: [],
            },
          },
          dependsOn: [],
        },
      ],
    },
    registry: COMMUNICATION_EVRY_PLAN_REGISTRY,
    eligibleCapabilities: [{ identity: COMMUNICATION_MESSAGE_SEND_IDENTITY }],
  });
  const base = {
    actorUserId: ACTOR.userId,
    plantId: ACTOR.plantId,
    document,
  };
  return {
    id: PLAN_ID,
    ...base,
    requestKey: deriveEvryPlanRequestKey("communication-send", [
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

test("a committed Communication plan is recovered before changed or deleted source work", async () => {
  const stored = storedPlan();
  const document = stored.document as Parameters<
    typeof trustedReviewForEvryPlanDocument
  >[0]["document"];
  const review = trustedReviewForEvryPlanDocument({
    plan: evryConversationPlanIdentitySchema.parse({
      planId: stored.id,
      fingerprint: stored.fingerprint,
    }),
    document,
    reviewRegistry: COMMUNICATION_EVRY_REVIEW_REGISTRY,
  });
  assert.ok(review);
  assert.equal(
    review.confirmation.steps[0]?.resolvedTargets.length,
    EVRY_COMMUNICATION_MAX_RECIPIENTS
  );

  let committed: StoredEvryActionPlan | null = null;
  let sourceReads = 0;
  let loseFirstResponse = true;
  const continuation = composeEvryCapabilityConversationContinuations([
    createCommunicationEvryConversationContinuation({
      async findPlanByRequestKey() {
        return committed;
      },
      async proposeMessage() {
        sourceReads += 1;
        committed = stored;
        return {
          kind: "plan",
          plan: evryConversationPlanIdentitySchema.parse({
            planId: stored.id,
            fingerprint: stored.fingerprint,
          }),
          confirmation: review.confirmation,
        };
      },
      async proposeTemplate() {
        throw new Error("template source must not run");
      },
    }),
  ]);
  const input = {
    actor: ACTOR,
    conversation: conversation(),
    userRequestKey: USER_REQUEST_KEY,
    literalUserText: `Send email to people ${PERSON_ID}: Original subject | Original approved draft`,
    pageContext: null,
    requestPageContext: null,
    now: CREATED_AT,
    store: {
      async append(request: { body: string; artifacts: unknown[] }) {
        if (loseFirstResponse) {
          loseFirstResponse = false;
          throw new Error("response lost after plan commit");
        }
        assert.match(
          JSON.stringify(request.artifacts),
          new RegExp(`Original recipient ${EVRY_COMMUNICATION_MAX_RECIPIENTS}`)
        );
        return conversation();
      },
    },
  } as never;

  await assert.rejects(continuation(input), /response lost after plan commit/);
  assert.equal(sourceReads, 1);

  // The mutable recipient/template source is now unavailable. Replay must use
  // the exact durable plan rather than call the proposal path again.
  await continuation(input);
  assert.equal(sourceReads, 1);
});

test("a request-key plan with a different capability identity fails closed", async () => {
  const stored = storedPlan();
  const continuation = composeEvryCapabilityConversationContinuations([
    createCommunicationEvryConversationContinuation({
      async findPlanByRequestKey() {
        const storedDocument = stored.document as {
          version: number;
          steps: readonly Record<string, unknown>[];
        };
        return {
          ...stored,
          document: {
            ...storedDocument,
            steps: [
              {
                ...storedDocument.steps[0],
                capabilityIdentity: "communication.templates.delete",
              },
            ],
          },
        };
      },
      async proposeMessage() {
        throw new Error("proposal must not run");
      },
      async proposeTemplate() {
        throw new Error("proposal must not run");
      },
    }),
  ]);

  await assert.rejects(
    continuation({
      actor: ACTOR,
      conversation: conversation(),
      userRequestKey: USER_REQUEST_KEY,
      literalUserText: `Send email to people ${PERSON_ID}: Subject | Body`,
      pageContext: null,
      requestPageContext: null,
      now: CREATED_AT,
      store: { append: async () => conversation() },
    } as never),
    /integrity validation/
  );
});

test("a matched unavailable Communication request appends a durable neutral result", async () => {
  const refusal = communicationEvryRefusal({
    title: "No eligible email recipients",
    body: "Evry did not prepare a send because every selected recipient was excluded.",
    exclusions: [{ reason: "No email address", count: 1 }],
  });
  const appends: { body: string; artifacts: unknown[] }[] = [];
  const continuation = composeEvryCapabilityConversationContinuations([
    createCommunicationEvryConversationContinuation({
      async findPlanByRequestKey() {
        return null;
      },
      async proposeMessage() {
        return refusal;
      },
      async proposeTemplate() {
        throw new Error("template source must not run");
      },
    }),
  ]);

  await continuation({
    actor: ACTOR,
    conversation: conversation(),
    userRequestKey: USER_REQUEST_KEY,
    literalUserText: `Send email to people ${PERSON_ID}: Subject | Body`,
    pageContext: null,
    requestPageContext: null,
    now: CREATED_AT,
    store: {
      async append(request: { body: string; artifacts: unknown[] }) {
        appends.push(request);
        return conversation();
      },
    },
  } as never);

  const appended = appends[0];
  assert.ok(appended);
  assert.equal(appended?.body, refusal.body);
  assert.match(JSON.stringify(appended?.artifacts), /No email address/);
  assert.match(JSON.stringify(appended), /"activePlan":\{"mode":"preserve"\}/);
});
