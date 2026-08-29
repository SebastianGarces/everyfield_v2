import assert from "node:assert/strict";
import { test } from "node:test";

import { INITIAL_MEETING_CONFIRMATION } from "@/lib/evry/artifacts/fixtures";
import type { EvryStoredConversation } from "@/lib/evry/conversations/repository";
import type { EvryPlantActor } from "@/lib/evry/eligibility/viewer";
import {
  deriveEvryPlanRequestKey,
  fingerprintEvryActionPlan,
  fingerprintEvryActionPlanIntent,
  parseEvryActionPlanCandidate,
} from "@/lib/evry/plans";
import type { StoredEvryActionPlan } from "@/lib/evry/plans/repository";

import { MEETINGS_ACTION_CONTRACTS } from "./catalog";
import { createMeetingsEvryConversationContinuation } from "./conversation";
import { MEETINGS_SELECTION_EXAMPLES } from "./selection";
import {
  MEETINGS_PLAN_REGISTRY,
  recoverMeetingsEvryEffectProposal,
  type MeetingsEvryEffectProposal,
} from "./runtime";

const actor = {
  userId: "20000000-0000-4000-8000-000000000001",
  plantId: "30000000-0000-4000-8000-000000000001",
  seat: "owner" as const,
} as unknown as EvryPlantActor;

const conversation = {
  id: "10000000-0000-4000-8000-000000000001",
  actorUserId: actor.userId,
  plantId: actor.plantId,
  stateVersion: 2,
  state: {},
  messages: [],
} as unknown as EvryStoredConversation;

const proposal: MeetingsEvryEffectProposal = {
  plan: INITIAL_MEETING_CONFIRMATION.plan,
  confirmation: INITIAL_MEETING_CONFIRMATION,
};

test("plan recovery uses the exact actor, plant, and request key", async () => {
  const requestKey = deriveEvryPlanRequestKey("meetings-recovery-proof", [
    actor.userId,
    actor.plantId,
  ]);
  const contract = MEETINGS_ACTION_CONTRACTS.addAttendeeNoteAction;
  const arguments_ = {
    meetingId: "50000000-0000-4000-8000-000000000001",
    personId: "60000000-0000-4000-8000-000000000001",
    meetingType: "vision_meeting" as const,
    note: "Keep the original source snapshot.",
    activityId: "70000000-0000-4000-8000-000000000001",
    expectedMeetingUpdatedAt: "2026-08-29T12:00:00.000Z",
    expectedPersonUpdatedAt: "2026-08-29T12:00:00.000Z",
  };
  const document = parseEvryActionPlanCandidate({
    candidate: {
      steps: [
        {
          id: contract.operationId,
          capabilityIdentity: contract.operationId,
          arguments: arguments_,
          dependsOn: [],
        },
      ],
    },
    registry: MEETINGS_PLAN_REGISTRY,
    eligibleCapabilities: [{ identity: contract.operationId }],
  });
  const expiresAt = new Date("2026-08-29T12:10:00.000Z");
  const stored: StoredEvryActionPlan = {
    id: "80000000-0000-4000-8000-000000000001",
    actorUserId: actor.userId,
    plantId: actor.plantId,
    requestKey,
    intentFingerprint: fingerprintEvryActionPlanIntent({
      actorUserId: actor.userId,
      plantId: actor.plantId,
      document,
    }),
    fingerprint: fingerprintEvryActionPlan({
      actorUserId: actor.userId,
      plantId: actor.plantId,
      expiresAt,
      document,
    }),
    document,
    createdAt: new Date("2026-08-29T12:00:00.000Z"),
    expiresAt,
    supersedesPlanId: null,
    status: "awaiting_confirmation",
    stateVersion: 0,
    stateChangedAt: new Date("2026-08-29T12:00:00.000Z"),
  };
  const lookups: unknown[] = [];

  const recovered = await recoverMeetingsEvryEffectProposal({
    actor,
    requestKey,
    async findPlan(scope) {
      lookups.push(scope);
      return stored;
    },
  });

  assert.deepEqual(lookups, [
    { actorUserId: actor.userId, plantId: actor.plantId, requestKey },
  ]);
  assert.equal(recovered?.plan.planId, stored.id);
  assert.equal(recovered?.plan.fingerprint, stored.fingerprint);
  const planPreview = recovered?.confirmation.steps[0]?.contentPreviews
    .filter(({ label }) => label.startsWith("Complete immutable plan"))
    .map(({ content }) => content)
    .join("");
  assert.deepEqual(JSON.parse(planPreview ?? "null"), arguments_);
});

test("a committed Meetings plan recovers before changed source work after response loss", async () => {
  let planCommitted = false;
  let resolveCalls = 0;
  let proposeCalls = 0;
  const recoveredScopes: unknown[] = [];
  const continuation = createMeetingsEvryConversationContinuation({
    async recoverProposal(input) {
      recoveredScopes.push({
        actor: input.actor,
        requestKey: input.requestKey,
      });
      return planCommitted ? proposal : null;
    },
    async resolveEffect() {
      resolveCalls += 1;
      if (planCommitted) {
        throw new Error("mutable source changed after the first response");
      }
      return {
        exportName: "addAttendeeNoteAction",
        arguments: {},
      } as never;
    },
    async proposeEffect() {
      proposeCalls += 1;
      planCommitted = true;
      return proposal;
    },
  });
  const input = {
    actor,
    conversation,
    userRequestKey: "40000000-0000-4000-8000-000000000001",
    literalUserText: MEETINGS_SELECTION_EXAMPLES.addAttendeeNoteAction,
    pageContext: {
      kind: "meeting" as const,
      recordId: "50000000-0000-4000-8000-000000000001",
      label: "Vision Meeting",
    },
    requestPageContext: null,
    now: new Date("2026-08-29T12:00:00.000Z"),
  };

  // The first call commits the plan, then its caller loses the result before
  // the assistant artifact is durable. The second call is the exact retry.
  const first = await continuation.continue(input);
  const replay = await continuation.continue(input);

  assert.deepEqual(replay, first);
  assert.equal(resolveCalls, 1);
  assert.equal(proposeCalls, 1);
  assert.equal(recoveredScopes.length, 2);
  assert.deepEqual(recoveredScopes[0], recoveredScopes[1]);
  assert.deepEqual(recoveredScopes[0], {
    actor,
    requestKey: deriveEvryPlanRequestKey("meetings-addattendeenote", [
      actor.userId,
      actor.plantId,
      conversation.id,
      input.userRequestKey,
    ]),
  });
});
