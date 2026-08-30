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
import {
  PRODUCTION_EVRY_EXECUTION_REGISTRY,
  PRODUCTION_EVRY_REVIEW_REGISTRY,
} from "@/lib/evry/capabilities/production";

import { createLaunchEvryConversationContinuation } from "./conversation";
import {
  LAUNCH_EFFECT_IDENTITIES,
  launchOutcomeArgumentsSchema,
  selectLaunchEvryEffect,
} from "./effects";
import {
  LAUNCH_EVRY_PLAN_REGISTRY,
  LAUNCH_EVRY_REVIEW_REGISTRY,
} from "./runtime";

const ACTOR = {
  userId: "10000000-0000-4000-8000-000000000001",
  plantId: "20000000-0000-4000-8000-000000000001",
  seat: "owner",
} as unknown as EvryPlantActor;
const CONVERSATION_ID = "30000000-0000-4000-8000-000000000001";
const USER_REQUEST_KEY = "40000000-0000-4000-8000-000000000001";
const PLAN_ID = "50000000-0000-4000-8000-000000000001";
const LAUNCH_ID = "60000000-0000-4000-8000-000000000001";
const CREATED_AT = new Date("2026-08-29T12:00:00.000Z");
const EXPIRES_AT = new Date("2026-08-29T12:15:00.000Z");

function conversation(): EvryStoredConversation {
  return {
    id: CONVERSATION_ID,
    actorUserId: ACTOR.userId,
    plantId: ACTOR.plantId,
    title: "Launch",
    createdAt: CREATED_AT,
    lastActivityAt: CREATED_AT,
    activePlan: null,
    stateVersion: 1,
    state: {},
    messages: [],
  } as unknown as EvryStoredConversation;
}

function scheduleStoredPlan(): StoredEvryActionPlan {
  const document = parseEvryActionPlanCandidate({
    candidate: {
      steps: [
        {
          id: "launch-schedule",
          capabilityIdentity: LAUNCH_EFFECT_IDENTITIES.schedule,
          arguments: {
            expected: null,
            targetDate: "2026-09-06",
            postpone: false,
            note: "Exact day",
          },
          dependsOn: [],
        },
      ],
    },
    registry: LAUNCH_EVRY_PLAN_REGISTRY,
    eligibleCapabilities: [{ identity: LAUNCH_EFFECT_IDENTITIES.schedule }],
  });
  const base = { actorUserId: ACTOR.userId, plantId: ACTOR.plantId, document };
  return {
    id: PLAN_ID,
    ...base,
    requestKey: deriveEvryPlanRequestKey("launch-schedule", [
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

test("every Launch effect is installed in the shared production runtime", () => {
  for (const identity of Object.values(LAUNCH_EFFECT_IDENTITIES)) {
    assert.ok(PRODUCTION_EVRY_EXECUTION_REGISTRY.registrationFor(identity));
  }
  assert.ok(
    PRODUCTION_EVRY_EXECUTION_REGISTRY.registrationFor(
      "communication.messages.send"
    ),
    "Launch composition dropped Communication"
  );
  assert.ok(PRODUCTION_EVRY_REVIEW_REGISTRY);
});

test("Launch response-loss replay recovers the durable plan before source resolution", async () => {
  const stored = scheduleStoredPlan();
  const document = stored.document as Parameters<
    typeof trustedReviewForEvryPlanDocument
  >[0]["document"];
  const plan = evryConversationPlanIdentitySchema.parse({
    planId: stored.id,
    fingerprint: stored.fingerprint,
  });
  const review = trustedReviewForEvryPlanDocument({
    plan,
    document,
    reviewRegistry: LAUNCH_EVRY_REVIEW_REGISTRY,
  });
  assert.ok(review);
  let committed: StoredEvryActionPlan | null = null;
  let resolutions = 0;
  let loseResponse = true;
  const continuation = composeEvryCapabilityConversationContinuations([
    createLaunchEvryConversationContinuation({
      async findPlanByRequestKey() {
        return committed;
      },
      async propose() {
        resolutions += 1;
        committed = stored;
        return { kind: "plan", plan, confirmation: review.confirmation };
      },
    }),
  ]);
  const input = {
    actor: ACTOR,
    conversation: conversation(),
    userRequestKey: USER_REQUEST_KEY,
    literalUserText: "schedule launch for 2026-09-06 | Exact day",
    pageContext: null,
    requestPageContext: null,
    now: CREATED_AT,
    store: {
      async append() {
        if (loseResponse) {
          loseResponse = false;
          throw new Error("response lost after Launch plan commit");
        }
        return conversation();
      },
    },
  } as never;
  await assert.rejects(continuation(input), /response lost/);
  assert.equal(resolutions, 1);
  await continuation(input);
  assert.equal(resolutions, 1, "retry reran mutable Launch resolution");
});

test("outcome correction review keeps conversation-reachable text losslessly", () => {
  const notes = '<&>"'.repeat(750);
  const capture = "Day & story <kept>".repeat(150);
  const expected = {
    id: LAUNCH_ID,
    targetDate: "2026-08-29",
    status: "completed" as const,
    outcomeRecordedAt: CREATED_AT.toISOString(),
    attendanceCount: 10,
    decisionsCount: 1,
    outcomeNotes: "Old notes",
    captureTheDay: "Old record",
    updatedAt: CREATED_AT.toISOString(),
  };
  const args = launchOutcomeArgumentsSchema.parse({
    expected,
    outcome: {
      attendanceCount: 11,
      decisionsCount: 2,
      outcomeNotes: notes,
      captureTheDay: capture,
    },
  });
  const document = parseEvryActionPlanCandidate({
    candidate: {
      steps: [
        {
          id: "correct",
          capabilityIdentity: LAUNCH_EFFECT_IDENTITIES.correctOutcome,
          arguments: args,
          dependsOn: [],
        },
      ],
    },
    registry: LAUNCH_EVRY_PLAN_REGISTRY,
    eligibleCapabilities: [
      { identity: LAUNCH_EFFECT_IDENTITIES.correctOutcome },
    ],
  });
  const review = trustedReviewForEvryPlanDocument({
    plan: evryConversationPlanIdentitySchema.parse({
      planId: PLAN_ID,
      fingerprint: "f".repeat(64),
    }),
    document,
    reviewRegistry: LAUNCH_EVRY_REVIEW_REGISTRY,
  });
  assert.ok(review);
  const previews = review.confirmation.steps[0]?.contentPreviews ?? [];
  assert.equal(previews.length, 4);
  assert.equal(previews[0]?.content, "<pre>Old notes</pre>");
  assert.equal(
    previews[2]?.content,
    `<pre>${notes.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;")}</pre>`
  );
  assert.match(previews[3]?.content ?? "", /Day &amp; story &lt;kept&gt;/);
});

test("literal outcome selection preserves escaped pipes and backslashes", () => {
  assert.deepEqual(
    selectLaunchEvryEffect(
      "record launch outcome|attendance=11|decisions=2|notes=Joy \\| gratitude|capture=C:\\\\launch"
    ),
    {
      kind: "record_outcome",
      outcome: {
        attendanceCount: 11,
        decisionsCount: 2,
        outcomeNotes: "Joy | gratitude",
        captureTheDay: "C:\\launch",
      },
    }
  );
});

test("literal Launch content preserves compatibility characters and boundary whitespace", () => {
  assert.deepEqual(
    selectLaunchEvryEffect(
      "record launch outcome|attendance=11|decisions=2|notes=  ①  |capture=Ｃafé "
    ),
    {
      kind: "record_outcome",
      outcome: {
        attendanceCount: 11,
        decisionsCount: 2,
        outcomeNotes: "  ①  ",
        captureTheDay: "Ｃafé ",
      },
    }
  );
  assert.deepEqual(
    selectLaunchEvryEffect("postpone launch to 2030-09-08 |  ①  "),
    {
      kind: "schedule",
      targetDate: "2030-09-08",
      postpone: true,
      note: "  ①  ",
    }
  );
});
