import assert from "node:assert/strict";
import { test } from "node:test";

type DurableStatus = "completed" | "failed" | "refused";
type DurableOutcome = Readonly<{
  stepId: string;
  status: DurableStatus;
  affectedCount: number;
}>;
type RetryableOutcome = Readonly<{
  stepId: string;
  status: "retryable";
}>;

type ReviewedInvitation = Readonly<{
  meetingId: string;
  guestPersonIds: readonly string[];
  recipientPersonIds: readonly string[];
}>;

// A — the generic executor durably records the typed output of a dependency.
// The next validator may consume only that exact predecessor output. The
// meeting ID and guest set remain pre-confirmed; only server-created version
// facts (updated_at and notification timestamps) travel through the output.
type CreateMeetingOutput = Readonly<{
  kind: "meeting-created";
  meetingId: string;
  expectedMeetingUpdatedAt: string;
  notificationVersion: string;
}>;

type DependencyOutputState = Readonly<{
  outcomes: readonly DurableOutcome[];
  outputs: ReadonlyMap<string, CreateMeetingOutput>;
}>;

function validateGuestsFromDependency(input: {
  reviewed: ReviewedInvitation;
  state: DependencyOutputState;
}) {
  const output = input.state.outputs.get("create-meeting");
  return output?.meetingId === input.reviewed.meetingId
    ? {
        meetingId: output.meetingId,
        expectedMeetingUpdatedAt: output.expectedMeetingUpdatedAt,
        notificationVersion: output.notificationVersion,
        personIds: input.reviewed.guestPersonIds,
      }
    : null;
}

// B — one first-class capability owns one atomic database effect. It can expose
// typed subresults, but today's executor still has one durable outcome per plan
// step, so a separate meeting and guest receipt requires a new nested-outcome
// contract rather than pretending the capability was two steps.
type CreateMeetingWithGuestsResult = Readonly<{
  status: "completed";
  affectedCount: number;
  subresults: readonly [
    Readonly<{ subject: "meeting"; affectedCount: 1 }>,
    Readonly<{ subject: "guests"; affectedCount: number }>,
  ];
}>;

function atomicCreateWithGuests(
  reviewed: ReviewedInvitation
): CreateMeetingWithGuestsResult {
  return {
    status: "completed",
    affectedCount: 1 + reviewed.guestPersonIds.length,
    subresults: [
      { subject: "meeting", affectedCount: 1 },
      { subject: "guests", affectedCount: reviewed.guestPersonIds.length },
    ],
  };
}

// C — a recipe-specific orchestrator owns a second durable substep ledger. It
// can resume after any substep, but duplicates the executor's claim, authority,
// audit, and receipt machinery and must keep both ledgers consistent forever.
type OrchestratorClaim = Readonly<{
  recipeId: string;
  substep: "create-meeting" | "add-guests" | "send-invitations";
  effectKey: string;
  status: "completed";
}>;

function nextOrchestratorSubstep(claims: readonly OrchestratorClaim[]) {
  const completed = new Set(claims.map(({ substep }) => substep));
  if (!completed.has("create-meeting")) return "create-meeting" as const;
  if (!completed.has("add-guests")) return "add-guests" as const;
  if (!completed.has("send-invitations")) return "send-invitations" as const;
  return null;
}

export const MEETING_INVITATION_ARCHITECTURE_COMPARISON = Object.freeze({
  dependencyOutput: Object.freeze({
    exactPlanTruthfulness:
      "Reviewed IDs stay immutable; only exact predecessor-produced versions flow forward.",
    targetValidation:
      "Extend the generic validator with a typed, effect-key-bound dependency output.",
    crashRetry:
      "Persist output atomically with the completed step; replay reuses it.",
    auditReceipt:
      "Existing three plan-step outcomes remain the single audit and receipt truth.",
    diffRisk:
      "Medium generic executor/repository change; no new business capability.",
    reuseFor788:
      "High: any recipe whose later write targets an entity created earlier can reuse it.",
  }),
  atomicCapability: Object.freeze({
    exactPlanTruthfulness:
      "Strongest database atomicity, with the meeting and guest set reviewed together.",
    targetValidation:
      "Add a new inventory capability, resolver, validator, review, and atomic SQL adapter.",
    crashRetry: "Simple single effect claim for meeting plus guests.",
    auditReceipt:
      "Needs nested durable outcomes to report meeting and guests separately; current executor reports one step.",
    diffRisk: "Large Meetings surface and inventory expansion.",
    reuseFor788:
      "Medium: reusable only where a matching compound capability is product-authentic.",
  }),
  recipeOrchestrator: Object.freeze({
    exactPlanTruthfulness:
      "Can be exact, but JIT facts and substep claims live outside the ordinary executor.",
    targetValidation:
      "Recipe-specific validators must duplicate capability freshness rules.",
    crashRetry:
      "Explicit per-substep claims resume safely if every claim and effect commit atomically.",
    auditReceipt:
      "Creates a second ledger that must reconcile with generic plan outcomes.",
    diffRisk: "Highest long-term authority and audit drift risk.",
    reuseFor788:
      "Low without turning the special orchestrator into a second executor.",
  }),
  recommendation: "dependencyOutput" as const,
});

const REVIEWED: ReviewedInvitation = {
  meetingId: "10000000-0000-4000-8000-000000000001",
  guestPersonIds: [
    "20000000-0000-4000-8000-000000000001",
    "20000000-0000-4000-8000-000000000002",
  ],
  recipientPersonIds: [
    "20000000-0000-4000-8000-000000000001",
    "20000000-0000-4000-8000-000000000002",
  ],
};

test("A: dependency output preserves the reviewed target and supports send-only retry", () => {
  const state: DependencyOutputState = {
    outcomes: [
      { stepId: "create-meeting", status: "completed", affectedCount: 1 },
      { stepId: "add-guests", status: "completed", affectedCount: 2 },
    ],
    outputs: new Map([
      [
        "create-meeting",
        {
          kind: "meeting-created",
          meetingId: REVIEWED.meetingId,
          expectedMeetingUpdatedAt: "2026-08-05T14:00:00.000Z",
          notificationVersion: "create-meeting-effect-key",
        },
      ],
    ]),
  };
  assert.deepEqual(
    validateGuestsFromDependency({ reviewed: REVIEWED, state }),
    {
      meetingId: REVIEWED.meetingId,
      expectedMeetingUpdatedAt: "2026-08-05T14:00:00.000Z",
      notificationVersion: "create-meeting-effect-key",
      personIds: REVIEWED.guestPersonIds,
    }
  );
  const retry: RetryableOutcome = {
    stepId: "send-invitations",
    status: "retryable",
  };
  assert.equal(retry.stepId, "send-invitations");
  assert.deepEqual(
    state.outcomes.map(({ stepId }) => stepId),
    ["create-meeting", "add-guests"]
  );
});

test("A: a foreign or missing predecessor output cannot authorize the guest step", () => {
  const state: DependencyOutputState = {
    outcomes: [],
    outputs: new Map([
      [
        "create-meeting",
        {
          kind: "meeting-created",
          meetingId: "90000000-0000-4000-8000-000000000001",
          expectedMeetingUpdatedAt: "2026-08-05T14:00:00.000Z",
          notificationVersion: "foreign-effect-key",
        },
      ],
    ]),
  };
  assert.equal(
    validateGuestsFromDependency({ reviewed: REVIEWED, state }),
    null
  );
  assert.equal(
    validateGuestsFromDependency({
      reviewed: REVIEWED,
      state: { outcomes: [], outputs: new Map() },
    }),
    null
  );
});

test("B: atomic capability is truthful but collapses two required receipt steps today", () => {
  const result = atomicCreateWithGuests(REVIEWED);
  assert.deepEqual(result.subresults, [
    { subject: "meeting", affectedCount: 1 },
    { subject: "guests", affectedCount: 2 },
  ]);
  const currentPlanStepOutcomes = [
    { stepId: "create-meeting-with-guests", status: "completed" },
    { stepId: "send-invitations", status: "completed" },
  ];
  assert.equal(currentPlanStepOutcomes.length, 2);
  assert.equal(result.subresults.length, 2);
});

test("C: custom claims resume correctly but constitute a second executor ledger", () => {
  const afterCreate: OrchestratorClaim[] = [
    {
      recipeId: "meeting.invitation.reference",
      substep: "create-meeting",
      effectKey: "create-key",
      status: "completed",
    },
  ];
  assert.equal(nextOrchestratorSubstep(afterCreate), "add-guests");
  const afterGuests = [
    ...afterCreate,
    {
      recipeId: "meeting.invitation.reference",
      substep: "add-guests" as const,
      effectKey: "guest-key",
      status: "completed" as const,
    },
  ];
  assert.equal(nextOrchestratorSubstep(afterGuests), "send-invitations");
  assert.equal(
    MEETING_INVITATION_ARCHITECTURE_COMPARISON.recommendation,
    "dependencyOutput"
  );
});
