import assert from "node:assert/strict";
import test from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";

import { evryDetailedConfirmationArtifactDocumentSchema } from "@/lib/evry/artifacts/review";
import { publicEvryArtifact } from "@/lib/evry/artifacts/public";
import { trustedReviewForEvryPlanDocument } from "@/lib/evry/artifacts/trusted-plan-review";
import {
  hydrateStoredEvryConversationArtifact,
  parseEvryConversationArtifactDocument,
} from "@/lib/evry/conversations/artifacts";
import { evryConversationPlanIdentitySchema } from "@/lib/evry/conversations/contract";
import { evryCapabilityRegistrationFor } from "@/lib/evry/eligibility/capabilities";
import {
  EVRY_CAPABILITY_EVAL_LAYERS,
  type EvryCapabilityEvalLayer,
} from "@/lib/evry/evals/contracts";
import { parseEvryActionPlanCandidate } from "@/lib/evry/plans";
import {
  EvryArtifactRenderer,
  renderableEvryArtifact,
} from "@/components/evry/artifacts/artifact-renderer";

import { TASK_ACTION_CONTRACTS } from "./contracts";
import { TASKS_EFFECT_ARGUMENT_SCHEMAS } from "./effect-contracts";
import inventory from "./inventory.generated.json";
import { TASK_READ_IDENTITIES, selectTaskEvryRead } from "./reads";
import { TASK_EXECUTION_REGISTRY, TASK_PLAN_REGISTRY } from "./runtime";
import { TASK_REVIEW_REGISTRY } from "./review";
import { selectTaskEvryEffect } from "./selection";
import {
  TASK_EFFECT_SELECTION_FIXTURES,
  TASK_FIXTURE_ID,
  taskEffectPlanFixture,
} from "./test-fixtures";

const PLAN = evryConversationPlanIdentitySchema.parse({
  planId: "40000000-0000-4000-8000-000000000001",
  fingerprint: "a".repeat(64),
});
const READ_SELECTIONS: Readonly<Record<string, string>> = Object.freeze({
  [TASK_READ_IDENTITIES.list]: "Show tasks",
  [TASK_READ_IDENTITIES.detail]: `Show task ${TASK_FIXTURE_ID}`,
  [TASK_READ_IDENTITIES.phasePrompt]: "Show the pending phase checklist prompt",
  [TASK_READ_IDENTITIES.planning]: `Show planning options for task ${TASK_FIXTURE_ID}`,
  [TASK_READ_IDENTITIES.templates]: "Show task checklist templates",
});

test("Task list selection preserves filters and the owning cursor for load more", () => {
  assert.deepEqual(
    selectTaskEvryRead(
      `Load more tasks matching launch follow-up after ${TASK_FIXTURE_ID}`
    ),
    {
      kind: "list",
      search: "launch follow-up",
      includeCompleted: true,
      cursor: TASK_FIXTURE_ID,
    }
  );
  assert.deepEqual(
    selectTaskEvryRead(`Load more tasks after ${TASK_FIXTURE_ID}`),
    {
      kind: "list",
      search: "",
      includeCompleted: false,
      cursor: TASK_FIXTURE_ID,
    }
  );
});
const EXPORT_BY_IDENTITY = new Map(
  Object.entries(TASK_ACTION_CONTRACTS).map(([exportName, contract]) => [
    contract.operationId,
    exportName,
  ])
);
const LIVE_EFFECT_LAYERS = new Set<EvryCapabilityEvalLayer>([
  "tenancy",
  "permission",
  "execution",
  "idempotency",
  "errors",
]);
const LIVE_READ_LAYERS = new Set<EvryCapabilityEvalLayer>([
  ...LIVE_EFFECT_LAYERS,
  "ui_artifact",
]);

function selectionFor(identity: string) {
  const read = READ_SELECTIONS[identity];
  if (read) return selectTaskEvryRead(read);
  const exportName = EXPORT_BY_IDENTITY.get(identity);
  assert.ok(exportName && exportName !== "loadMoreTasksAction");
  return selectTaskEvryEffect(
    TASK_EFFECT_SELECTION_FIXTURES[
      exportName as keyof typeof TASK_EFFECT_SELECTION_FIXTURES
    ]
  );
}

function effectDocument(identity: string) {
  const exportName = EXPORT_BY_IDENTITY.get(identity);
  assert.ok(exportName && exportName !== "loadMoreTasksAction");
  return parseEvryActionPlanCandidate({
    candidate: {
      steps: [
        {
          id: identity,
          capabilityIdentity: identity,
          arguments: taskEffectPlanFixture(
            exportName as keyof typeof TASK_EFFECT_SELECTION_FIXTURES
          ),
          dependsOn: [],
        },
      ],
    },
    registry: TASK_PLAN_REGISTRY,
    eligibleCapabilities: [{ identity }],
  });
}

async function exercise(identity: string, layer: EvryCapabilityEvalLayer) {
  const capability = inventory.capabilities.find(
    (candidate) => candidate.identity === identity
  );
  assert.ok(capability);
  const registration = evryCapabilityRegistrationFor(identity);
  assert.ok(registration);

  if (layer === "policy") {
    assert.equal(registration.parityCapability, "tasks");
    assert.equal(registration.operationKind, capability.operationKind);
    assert.equal(
      registration.applicationCapability,
      capability.applicationCapability
    );
    return;
  }
  if (layer === "selection") {
    const selected = selectionFor(identity);
    assert.ok(selected);
    assert.deepEqual(selected, selectionFor(identity));
    return;
  }
  if (capability.operationKind === "read") {
    assert.equal(LIVE_READ_LAYERS.has(layer), false);
    assert.ok(layer === "arguments" || layer === "confirmation");
    if (layer === "arguments") assert.ok(selectionFor(identity));
    if (layer === "confirmation") {
      assert.equal(TASK_EXECUTION_REGISTRY.registrationFor(identity), null);
    }
    return;
  }
  assert.equal(LIVE_EFFECT_LAYERS.has(layer), false);
  const exportName = EXPORT_BY_IDENTITY.get(identity);
  assert.ok(exportName && exportName !== "loadMoreTasksAction");
  const args = taskEffectPlanFixture(
    exportName as keyof typeof TASK_EFFECT_SELECTION_FIXTURES
  );
  if (layer === "arguments") {
    const schema =
      TASKS_EFFECT_ARGUMENT_SCHEMAS[
        exportName as keyof typeof TASKS_EFFECT_ARGUMENT_SCHEMAS
      ];
    assert.equal(schema.safeParse(args).success, true);
    assert.equal(
      schema.safeParse({ ...args, genericUrl: "/admin" }).success,
      false
    );
    return;
  }
  assert.ok(layer === "confirmation" || layer === "ui_artifact");
  const review = trustedReviewForEvryPlanDocument({
    plan: PLAN,
    document: effectDocument(identity),
    reviewRegistry: TASK_REVIEW_REGISTRY,
  });
  assert.ok(review);
  assert.equal(
    evryDetailedConfirmationArtifactDocumentSchema.safeParse(
      review.confirmation
    ).success,
    true
  );
}

for (const { identity, operationKind } of inventory.capabilities) {
  for (const layer of EVRY_CAPABILITY_EVAL_LAYERS) {
    const live = (
      operationKind === "read" ? LIVE_READ_LAYERS : LIVE_EFFECT_LAYERS
    ).has(layer);
    if (!live) test(`${identity}:${layer}`, () => exercise(identity, layer));
  }
}

test("a 100-Task bulk confirmation discloses every exact before/after target", () => {
  const identity = TASK_ACTION_CONTRACTS.bulkCompleteTasksAction.operationId;
  const base = taskEffectPlanFixture("bulkCompleteTasksAction");
  const writes = Array.from({ length: 100 }, (_, index) => {
    const taskId = `00000000-0000-4000-8000-${String(index + 1).padStart(12, "0")}`;
    const original = base.taskWrites[0]!;
    return {
      ...original,
      taskId,
      before: {
        ...original.before!,
        id: taskId,
        title: `Bulk task ${index + 1}`,
      },
      after: { ...original.after, id: taskId, title: `Bulk task ${index + 1}` },
    };
  });
  const arguments_ = {
    ...base,
    subjectTasks: writes.map(({ before }) => before),
    taskWrites: writes,
    notifications: {
      ...base.notifications,
      scopedTaskIds: writes.map(({ taskId }) => taskId),
    },
    completionEffects: {
      ...base.completionEffects,
      contactLogs: writes.map(({ taskId }) => ({
        kind: "not_applicable" as const,
        taskId,
        reason: "not_person" as const,
        personId: null,
      })),
    },
    // This is the exact shape `resolved()` derives for non-person Task
    // completions. Keeping it here prevents a synthetic bulk fixture from
    // bypassing the shared artifact's exclusion boundary.
    exclusions: writes.map(({ taskId }) => ({
      target: `Task ${taskId}`,
      reason:
        "This Task is not related to a person, so no contact-log entry applies.",
    })),
    disclosure: {
      ...base.disclosure,
      targets: writes.map(
        ({ taskId, after }) => `Task ${taskId}: ${after.title}`
      ),
      counts: [{ label: "Tasks", count: writes.length }],
      changes: writes.flatMap(({ before, after }) => [
        {
          label: `${after.title} — status`,
          before: before.status,
          after: after.status,
        },
      ]),
    },
  };
  const document = parseEvryActionPlanCandidate({
    candidate: {
      steps: [
        {
          id: identity,
          capabilityIdentity: identity,
          arguments: arguments_,
          dependsOn: [],
        },
      ],
    },
    registry: TASK_PLAN_REGISTRY,
    eligibleCapabilities: [{ identity }],
  });
  const review = trustedReviewForEvryPlanDocument({
    plan: PLAN,
    document,
    reviewRegistry: TASK_REVIEW_REGISTRY,
  });
  assert.ok(review);
  assert.deepEqual(review.confirmation.steps[0]?.exclusions, [
    {
      reason:
        "This Task is not related to a person, so no contact-log entry applies.",
      count: 100,
    },
  ]);
  const targets = review.confirmation.steps[0]?.resolvedTargets ?? [];
  assert.equal(targets.length, 100);
  for (const [index, target] of targets.entries()) {
    assert.match(target.value, new RegExp(`Bulk task ${index + 1}`));
    assert.match(target.value, /"status"/);
    assert.match(target.value, /"not_started"/);
    assert.match(target.value, /"complete"/);
  }
});

test("a source-derived handoff above the bulk UI cap remains fully reviewable", () => {
  const identity = TASK_ACTION_CONTRACTS.handOffFollowUpsAction.operationId;
  const base = taskEffectPlanFixture("handOffFollowUpsAction");
  const writes = Array.from({ length: 101 }, (_, index) => {
    const taskId = `10000000-0000-4000-8000-${String(index + 1).padStart(12, "0")}`;
    const original = base.taskWrites[0]!;
    return {
      ...original,
      taskId,
      before: {
        ...original.before!,
        id: taskId,
        title: `Follow-up ${index + 1}`,
      },
      after: {
        ...original.after,
        id: taskId,
        title: `Follow-up ${index + 1}`,
        assignedToId: "00000000-0000-4000-8000-000000000004",
      },
    };
  });
  const arguments_ = {
    ...base,
    taskWrites: writes,
    notifications: {
      ...base.notifications,
      scopedTaskIds: writes.map(({ taskId }) => taskId),
    },
    sourceAssertion: {
      ...base.sourceAssertion,
      taskIds: writes.map(({ taskId }) => taskId),
    },
    disclosure: {
      ...base.disclosure,
      targets: writes.map(
        ({ taskId, after }) => `Task ${taskId}: ${after.title}`
      ),
      counts: [{ label: "Tasks", count: writes.length }],
      changes: writes.map(({ before, after }) => ({
        label: `${after.title} — assignee`,
        before: before.assignedToId ?? "Unassigned",
        after: after.assignedToId ?? "Unassigned",
      })),
    },
  };
  const document = parseEvryActionPlanCandidate({
    candidate: {
      steps: [
        {
          id: identity,
          capabilityIdentity: identity,
          arguments: arguments_,
          dependsOn: [],
        },
      ],
    },
    registry: TASK_PLAN_REGISTRY,
    eligibleCapabilities: [{ identity }],
  });
  const review = trustedReviewForEvryPlanDocument({
    plan: PLAN,
    document,
    reviewRegistry: TASK_REVIEW_REGISTRY,
  });
  assert.ok(review);
  const targets = review.confirmation.steps[0]?.resolvedTargets ?? [];
  assert.equal(targets.length, 101);
  assert.match(targets[100]!.value, /Follow-up 101/);
  assert.match(targets[100]!.value, /assignedToId/);
});

test("large compound Task evidence remains byte-exact through persistence, public projection, and rendering", () => {
  const identity = TASK_ACTION_CONTRACTS.bulkRescheduleTasksAction.operationId;
  const base = taskEffectPlanFixture("bulkRescheduleTasksAction");
  const midpoint = "TASK_DESCRIPTION_MIDPOINT_SENTINEL";
  const description = `${"a".repeat(3_500)}${midpoint}${"z".repeat(3_500)}`;
  const writes = Array.from({ length: 8 }, (_, index) => {
    const taskId = `20000000-0000-4000-8000-${String(index + 1).padStart(12, "0")}`;
    const original = base.taskWrites[0]!;
    return {
      ...original,
      taskId,
      before: {
        ...original.before!,
        id: taskId,
        title: `Large compound task ${index + 1}`,
        description: `${description}-${index}`,
      },
      after: {
        ...original.after,
        id: taskId,
        title: `Large compound task ${index + 1}`,
        description: `${description}-${index}`,
      },
    };
  });
  const arguments_ = {
    ...base,
    taskWrites: writes,
    notifications: {
      ...base.notifications,
      scopedTaskIds: writes.map(({ taskId }) => taskId),
    },
    disclosure: {
      ...base.disclosure,
      targets: writes.map(
        ({ taskId, after }) => `Task ${taskId}: ${after.title}`
      ),
      counts: [{ label: "Tasks", count: writes.length }],
      changes: writes.map(({ before, after }) => ({
        label: `${after.title} — due date`,
        before: before.dueDate ?? "No date",
        after: after.dueDate ?? "No date",
      })),
    },
  };
  const document = parseEvryActionPlanCandidate({
    candidate: {
      steps: [
        {
          id: identity,
          capabilityIdentity: identity,
          arguments: arguments_,
          dependsOn: [],
        },
      ],
    },
    registry: TASK_PLAN_REGISTRY,
    eligibleCapabilities: [{ identity }],
  });
  const review = trustedReviewForEvryPlanDocument({
    plan: PLAN,
    document,
    reviewRegistry: TASK_REVIEW_REGISTRY,
  });
  assert.ok(review);
  const stored = parseEvryConversationArtifactDocument(
    JSON.parse(JSON.stringify(review.confirmation))
  );
  const publicArtifact = publicEvryArtifact(
    hydrateStoredEvryConversationArtifact(stored)
  );
  assert.equal(publicArtifact.kind, "confirmation");
  assert.ok("artifactVersion" in publicArtifact);
  const evidence = publicArtifact.steps[0]!.contentPreviews.map(
    ({ content }) => content
  ).join("");
  assert.equal(
    JSON.parse(evidence).taskWrites[7].before.description,
    `${description}-7`
  );
  const markup = renderToStaticMarkup(
    createElement(EvryArtifactRenderer, {
      model: renderableEvryArtifact(publicArtifact),
    })
  );
  assert.match(markup, new RegExp(midpoint));
});
