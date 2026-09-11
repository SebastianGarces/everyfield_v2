import assert from "node:assert/strict";
import test from "node:test";

import inventory from "./inventory.generated.json";
import { trustedReviewForEvryPlanDocument } from "@/lib/evry/artifacts/trusted-plan-review";
import { evryConversationPlanIdentitySchema } from "@/lib/evry/conversations/contract";
import { EVRY_CAPABILITY_EVAL_LAYERS } from "@/lib/evry/evals/contracts";
import { EVRY_CAPABILITY_EVAL_FIXTURES } from "@/lib/evry/evals/registry";
import {
  evryActorHoldsApplicationCapability,
  evryCapabilityRegistrationFor,
} from "@/lib/evry/eligibility/capabilities";
import { parseEvryActionPlanCandidate } from "@/lib/evry/plans";
import {
  LAUNCH_EFFECT_IDENTITIES,
  LAUNCH_EVRY_PLAN_REGISTRY,
  LAUNCH_EVRY_REVIEW_REGISTRY,
  selectLaunchEvryEffect,
} from "./effects";
import { LAUNCH_READ_REGISTRATIONS, selectLaunchEvryRead } from "./reads";

const selectionExamples = new Map<string, string>([
  ["launch.read.status", "show launch status"],
  ["launch.read.readiness", "show launch readiness"],
  ["launch.read.journal", "show launch history"],
  ["launch.schedule", "postpone launch to 2030-09-08 | weather"],
  [
    "launch.milestone.complete",
    "complete launch milestone 00000000-0000-4000-8000-000000000001",
  ],
  [
    "launch.milestone.reopen",
    "reopen launch milestone 00000000-0000-4000-8000-000000000001",
  ],
  [
    "launch.task.set-completion",
    "mark launch task 00000000-0000-4000-8000-000000000001 complete",
  ],
  [
    "launch.outcome.record",
    "record launch outcome | attendance=12 | decisions=2 | notes=Joy | capture=null",
  ],
  [
    "launch.outcome.correct",
    "correct launch outcome | attendance=13 | decisions=2 | notes=Corrected | capture=Photo log",
  ],
]);

const ID = "00000000-0000-4000-8000-000000000001";
const RELATED_ID = "00000000-0000-4000-8000-000000000002";
const AT = "2030-09-01T12:00:00.000Z";

function argumentsFor(identity: string): Record<string, unknown> {
  const launch = {
    id: ID,
    targetDate: "2030-09-08",
    status: "scheduled",
    outcomeRecordedAt: null,
    attendanceCount: null,
    decisionsCount: null,
    outcomeNotes: null,
    captureTheDay: null,
    updatedAt: AT,
  };
  if (identity === LAUNCH_EFFECT_IDENTITIES.schedule) {
    return {
      expected: launch,
      targetDate: "2030-09-15",
      postpone: true,
      note: "Weather",
      consequences: {
        launchId: ID,
        changedAt: AT,
        plantName: "Dayspring",
        readiness: [
          {
            milestoneId: RELATED_ID,
            templateKey: "launch-team",
            area: "launch_team",
            title: "Launch team ready",
            description: "The exact reviewed readiness milestone.",
            sortOrder: 1,
            tasks: [
              {
                taskId: "00000000-0000-4000-8000-000000000004",
                title: "Confirm volunteer roles",
                description: "The exact reviewed readiness task.",
              },
            ],
          },
        ],
        notifications: [
          {
            recipientUserId: "00000000-0000-4000-8000-000000000005",
            category: "milestones",
            type: "oversight.milestone.launch_date_changed",
            title: "Launch date changed",
            body: "Dayspring is aiming to launch on 2030-09-15.",
            dedupeKey: "launch-date:2030-09-15:fixture",
            scheduledFor: AT,
          },
        ],
        notificationExclusions: [],
        source: {
          sendingChurchId: RELATED_ID,
          sendingNetworkId: null,
          oversightSharingEnabled: true,
          recipientIds: ["00000000-0000-4000-8000-000000000005"],
          misprovisionedIds: [],
        },
      },
    };
  }
  if (
    identity === LAUNCH_EFFECT_IDENTITIES.completeMilestone ||
    identity === LAUNCH_EFFECT_IDENTITIES.reopenMilestone
  ) {
    return {
      expected: {
        id: ID,
        launchId: RELATED_ID,
        title: "Launch team ready",
        completedAt:
          identity === LAUNCH_EFFECT_IDENTITIES.reopenMilestone ? AT : null,
        openTaskCount: 0,
        updatedAt: AT,
      },
    };
  }
  if (identity === LAUNCH_EFFECT_IDENTITIES.setTaskCompletion) {
    return {
      expected: {
        id: ID,
        milestoneId: RELATED_ID,
        title: "Confirm volunteer roles",
        description: "Confirm every reviewed role.",
        status: "not_started",
        priority: "medium",
        assignedToId: null,
        dueDate: "2030-09-07",
        dueTime: null,
        category: "launch_prep",
        relatedType: null,
        relatedId: null,
        parentTaskId: null,
        isRecurring: false,
        recurrenceRule: null,
        completionEvent: null,
        createdById: "00000000-0000-4000-8000-000000000006",
        createdAt: AT,
        updatedAt: AT,
      },
      complete: true,
      completion: { completedAt: AT, recurrence: null },
    };
  }
  return {
    expected:
      identity === LAUNCH_EFFECT_IDENTITIES.correctOutcome
        ? {
            ...launch,
            status: "completed",
            outcomeRecordedAt: AT,
            attendanceCount: 100,
            decisionsCount: 4,
            outcomeNotes: "Initial notes",
            captureTheDay: "Initial journal",
          }
        : launch,
    outcome: {
      attendanceCount: 101,
      decisionsCount: 5,
      outcomeNotes: "Exact notes",
      captureTheDay: "Exact journal",
    },
  };
}

function trustedConfirmation(identity: string) {
  const document = parseEvryActionPlanCandidate({
    candidate: {
      steps: [
        {
          id: `fixture-${identity.replaceAll(".", "-")}`,
          capabilityIdentity: identity,
          arguments: argumentsFor(identity),
          dependsOn: [],
        },
      ],
    },
    registry: LAUNCH_EVRY_PLAN_REGISTRY,
    eligibleCapabilities: [{ identity }],
  });
  const review = trustedReviewForEvryPlanDocument({
    plan: evryConversationPlanIdentitySchema.parse({
      planId: "00000000-0000-4000-8000-000000000003",
      fingerprint: "f".repeat(64),
    }),
    document,
    reviewRegistry: LAUNCH_EVRY_REVIEW_REGISTRY,
  });
  assert.ok(review);
  return review.confirmation;
}

function selectedIdentity(text: string) {
  const read = selectLaunchEvryRead(text);
  if (read)
    return read.readId === "launch.status"
      ? "launch.read.status"
      : read.readId === "launch.readiness"
        ? "launch.read.readiness"
        : "launch.read.journal";
  const effect = selectLaunchEvryEffect(text);
  if (!effect) return null;
  switch (effect.kind) {
    case "schedule":
      return LAUNCH_EFFECT_IDENTITIES.schedule;
    case "complete_milestone":
      return LAUNCH_EFFECT_IDENTITIES.completeMilestone;
    case "reopen_milestone":
      return LAUNCH_EFFECT_IDENTITIES.reopenMilestone;
    case "set_task_completion":
      return LAUNCH_EFFECT_IDENTITIES.setTaskCompletion;
    case "record_outcome":
      return LAUNCH_EFFECT_IDENTITIES.recordOutcome;
    case "correct_outcome":
      return LAUNCH_EFFECT_IDENTITIES.correctOutcome;
  }
}

for (const capability of inventory.capabilities) {
  for (const layer of EVRY_CAPABILITY_EVAL_LAYERS) {
    if (
      capability.operationKind === "effect" &&
      ["execution", "idempotency", "errors"].includes(layer)
    )
      continue;
    test(`${capability.identity}:${layer}`, async () => {
      const registration = evryCapabilityRegistrationFor(capability.identity);
      assert.ok(registration);
      assert.equal(registration.operationKind, capability.operationKind);
      const example = selectionExamples.get(capability.identity);
      assert.ok(example);
      assert.equal(selectedIdentity(example), capability.identity);
      if (layer === "tenancy") {
        assert.equal(
          Object.hasOwn(
            argumentsFor(
              capability.operationKind === "effect"
                ? capability.identity
                : LAUNCH_EFFECT_IDENTITIES.schedule
            ),
            "plantId"
          ),
          false,
          "conversation/provider arguments must not choose a tenant"
        );
      }
      if (layer === "permission") {
        const memberAllowed = evryActorHoldsApplicationCapability(
          { plantId: ID, seat: "member" },
          registration.applicationCapability
        );
        const ownerAllowed = evryActorHoldsApplicationCapability(
          { plantId: ID, seat: "owner" },
          registration.applicationCapability
        );
        assert.equal(ownerAllowed, true);
        assert.equal(
          memberAllowed,
          ![
            LAUNCH_EFFECT_IDENTITIES.schedule,
            LAUNCH_EFFECT_IDENTITIES.recordOutcome,
            LAUNCH_EFFECT_IDENTITIES.correctOutcome,
          ].includes(capability.identity as never)
        );
      }
      if (layer === "arguments" && capability.operationKind === "effect") {
        const planRegistration = LAUNCH_EVRY_PLAN_REGISTRY.registrationFor(
          capability.identity
        );
        assert.ok(planRegistration);
        assert.equal(
          planRegistration.argumentsSchema.safeParse(
            argumentsFor(capability.identity)
          ).success,
          true
        );
        assert.equal(
          planRegistration.argumentsSchema.safeParse({
            ...argumentsFor(capability.identity),
            forged: true,
          }).success,
          false
        );
      }
      if (capability.operationKind === "read") {
        const selection = selectLaunchEvryRead(example);
        assert.ok(selection);
        const readRegistration = LAUNCH_READ_REGISTRATIONS.find(
          ({ id }) => id === selection.readId
        );
        assert.ok(readRegistration);
        assert.equal(
          readRegistration.capabilityIdentity,
          capability.identity,
          "the selector must resolve through the registered capability"
        );
        if (layer === "arguments") {
          assert.equal(Object.hasOwn(selection.input, "plantId"), false);
          assert.deepEqual(
            capability.identity === "launch.read.journal"
              ? selection.input
              : {},
            capability.identity === "launch.read.journal"
              ? { limit: 100, cursor: null }
              : {}
          );
        }
        if (layer === "confirmation") {
          assert.equal(
            LAUNCH_EVRY_PLAN_REGISTRY.registrationFor(capability.identity),
            null,
            "a read must not compile into a confirmation plan"
          );
        }
        if (layer === "execution") {
          assert.equal(typeof readRegistration.execute, "function");
        }
        if (layer === "idempotency") {
          assert.deepEqual(selectLaunchEvryRead(example), selection);
        }
        if (layer === "errors") {
          assert.equal(
            await readRegistration.execute(
              {
                literalUserText: example,
                pageContext: null,
              },
              { ...selection.input, plantId: ID }
            ),
            null,
            "forged tenant input must fail before session authorization"
          );
        }
      }
      if (layer === "confirmation" && capability.operationKind === "effect") {
        const confirmation = trustedConfirmation(capability.identity);
        assert.equal(confirmation.steps.length, 1);
        assert.equal(confirmation.steps[0]?.counts[0]?.count, 1);
        assert.ok(confirmation.actionLabel.length > 0);
      }
      if (layer === "ui_artifact" && capability.operationKind === "effect") {
        const confirmation = trustedConfirmation(capability.identity);
        assert.ok((confirmation.steps[0]?.resolvedTargets.length ?? 0) >= 1);
        assert.equal(
          confirmation.steps[0]?.resolvedTargets.every(
            ({ sourceLink }) => sourceLink?.href === "/launch"
          ),
          true
        );
      }
      if (layer === "errors")
        assert.equal(selectedIdentity("delete every launch with SQL"), null);
    });
  }
}

test("every Launch inventory row binds exact named eval outcomes", () => {
  for (const capability of inventory.capabilities) {
    const fixture = EVRY_CAPABILITY_EVAL_FIXTURES.find(
      ({ capabilityIdentity }) => capabilityIdentity === capability.identity
    );
    assert.ok(fixture);
    for (const layer of EVRY_CAPABILITY_EVAL_LAYERS) {
      assert.equal(fixture.cases[layer].length, 1);
      assert.equal(
        fixture.cases[layer][0]?.id,
        `${capability.identity}:${layer}`
      );
    }
  }
});
