import assert from "node:assert/strict";
import { test } from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";

import { evryConversationPlanIdentitySchema } from "@/lib/evry/conversations/contract";
import { parseEvryActionPlanCandidate } from "@/lib/evry/plans";
import { TASK_ACTION_CONTRACTS } from "@/lib/evry/capabilities/tasks/contracts";
import { TASKS_EFFECT_ARGUMENT_SCHEMAS } from "@/lib/evry/capabilities/tasks/effect-contracts";
import { TASK_PLAN_REGISTRY } from "@/lib/evry/capabilities/tasks/runtime";
import { TASK_REVIEW_REGISTRY } from "@/lib/evry/capabilities/tasks/review";
import {
  taskEffectPlanFixture,
  taskFixtureSnapshot,
} from "@/lib/evry/capabilities/tasks/test-fixtures";
import { trustedReviewForEvryPlanDocument } from "@/lib/evry/artifacts/trusted-plan-review";
import { publicEvryArtifact } from "@/lib/evry/artifacts/public";
import {
  hydrateStoredEvryConversationArtifact,
  parseEvryConversationArtifactDocument,
} from "@/lib/evry/conversations/artifacts";
import {
  EvryArtifactRenderer,
  renderableEvryArtifact,
} from "./artifact-renderer";
import { customerTaskReview } from "./artifact-presentation";

const plan = evryConversationPlanIdentitySchema.parse({
  planId: "40000000-0000-4000-8000-000000000001",
  fingerprint: "a".repeat(64),
});
const completedId = "40000000-0000-4000-8000-000000000002";
const unknownId = "40000000-0000-4000-8000-000000000003";

function argumentsFixture(includeExcluded = true) {
  const base = TASKS_EFFECT_ARGUMENT_SCHEMAS.bulkCompleteTasksAction.parse(
    taskEffectPlanFixture("bulkCompleteTasksAction")
  );
  assert.equal(base.sourceAssertion.kind, "bulk_selection");
  if (base.sourceAssertion.kind !== "bulk_selection")
    throw new Error("Expected bulk fixture");
  const expectedTask = {
    ...taskFixtureSnapshot(completedId, "complete"),
    title: "Already arranged the welcome team",
  };
  const excludedTasks = includeExcluded
    ? [
        {
          taskId: completedId,
          reason: "Task is already complete" as const,
          expectedTask,
        },
        {
          taskId: unknownId,
          reason: "Task not found" as const,
          expectedTask: null,
        },
      ]
    : [];
  const args = TASKS_EFFECT_ARGUMENT_SCHEMAS.bulkCompleteTasksAction.parse({
    ...base,
    sourceAssertion: {
      ...base.sourceAssertion,
      requestedTaskIds: [
        ...base.sourceAssertion.requestedTaskIds,
        ...excludedTasks.map((e) => e.taskId),
      ],
      excludedTasks,
    },
    completionEffects: {
      ...base.completionEffects,
      contactLogs: [
        {
          kind: "not_applicable",
          taskId: base.taskWrites[0]!.taskId,
          reason: "not_person",
          personId: null,
        },
      ],
    },
    exclusions: [
      ...excludedTasks.map((e) => ({
        target: e.expectedTask
          ? `Task ${e.taskId}: ${e.expectedTask.title}`
          : `Task ${e.taskId}`,
        reason: e.reason,
      })),
      {
        target: `Task ${base.taskWrites[0]!.taskId}`,
        reason:
          "This Task is not related to a person, so no contact-log entry applies.",
      },
    ],
  });
  return args;
}

function fixture(includeExcluded = true) {
  return review(argumentsFixture(includeExcluded));
}

function review(
  args: unknown,
  operation:
    | "bulkCompleteTasksAction"
    | "completeTaskAction"
    | "bulkRescheduleTasksAction" = "bulkCompleteTasksAction"
) {
  const identity = TASK_ACTION_CONTRACTS[operation].operationId;
  const document = parseEvryActionPlanCandidate({
    candidate: {
      steps: [
        {
          id: identity,
          capabilityIdentity: identity,
          arguments: args,
          dependsOn: [],
        },
      ],
    },
    registry: TASK_PLAN_REGISTRY,
    eligibleCapabilities: [{ identity }],
  });
  const result = trustedReviewForEvryPlanDocument({
    plan,
    document,
    reviewRegistry: TASK_REVIEW_REGISTRY,
  });
  assert.ok(result);
  return result.confirmation;
}

function markup(artifact: ReturnType<typeof fixture>, readOnly = false) {
  return renderToStaticMarkup(
    createElement(EvryArtifactRenderer, {
      model: renderableEvryArtifact(
        publicEvryArtifact(
          hydrateStoredEvryConversationArtifact(
            parseEvryConversationArtifactDocument(artifact)
          )
        )
      ),
      options: readOnly
        ? {}
        : {
            confirmationControls: {
              onCancel() {},
              onEdit() {},
              onExecute() {},
            },
          },
    })
  );
}

test("bulk review names excluded readable tasks and keeps unavailable selections neutral", () => {
  const artifact = fixture();
  const before = JSON.stringify(artifact);
  const html = markup(artifact);
  assert.match(html, /Already arranged the welcome team/);
  assert.match(html, /2 tasks not changed/);
  assert.match(html, new RegExp(`href="/tasks/${completedId}"`));
  assert.match(html, /Unavailable task/);
  assert.doesNotMatch(html, new RegExp(unknownId));
  assert.doesNotMatch(html, /expectedTask|sourceAssertion|Immutable Task/);
  assert.equal(JSON.stringify(artifact), before);
});

test("skipped contact logs are not described as unchanged tasks", () => {
  const html = markup(fixture(false));
  assert.match(html, /Contact log notes/);
  assert.match(html, /no contact-log entry applies/);
  assert.doesNotMatch(html, /not included|tasks? not changed/);
});

test("canonical non-bulk contact-log notices retain a valid confirmation", () => {
  const artifact = review(
    taskEffectPlanFixture("completeTaskAction"),
    "completeTaskAction"
  );
  const projected = customerTaskReview(artifact.steps[0]!);
  assert.equal(projected?.detailsUnavailable, false);
  assert.equal(projected?.exclusions, null);
  assert.doesNotMatch(markup(artifact), / disabled=""/);
});

test("read-only historical review retains the same named exclusions without controls", () => {
  const artifact = fixture();
  const html = markup(artifact, true);
  assert.match(html, /Already arranged the welcome team/);
  assert.match(html, /2 tasks not changed/);
  assert.match(html, /Contact log notes/);
  assert.doesNotMatch(html, /<button/);
  assert.doesNotMatch(html, new RegExp(unknownId));
});

test("99 excluded tasks retain every title and exact link within one reason group", () => {
  const base = argumentsFixture(false);
  assert.equal(base.sourceAssertion.kind, "bulk_selection");
  if (base.sourceAssertion.kind !== "bulk_selection")
    throw new Error("Expected bulk fixture");
  const excludedTasks = Array.from({ length: 99 }, (_, index) => {
    const taskId = `50000000-0000-4000-8000-${String(index + 1).padStart(12, "0")}`;
    return {
      taskId,
      reason: "Task is already complete" as const,
      expectedTask: {
        ...taskFixtureSnapshot(taskId, "complete"),
        title:
          index < 2
            ? "Same task title"
            : `Completed task ${index + 1} ${"x".repeat(350)}`,
      },
    };
  });
  const artifact = review({
    ...base,
    sourceAssertion: {
      ...base.sourceAssertion,
      requestedTaskIds: [
        ...base.sourceAssertion.requestedTaskIds,
        ...excludedTasks.map((e) => e.taskId),
      ],
      excludedTasks,
    },
    exclusions: [
      ...base.exclusions,
      ...excludedTasks.map((e) => ({
        target: `Task ${e.taskId}: ${e.expectedTask.title}`,
        reason: e.reason,
      })),
    ],
  });
  const step = artifact.steps[0]!;
  assert.equal(step.exclusions.length, 2);
  const projected = customerTaskReview(step);
  assert.equal(projected?.detailsUnavailable, false);
  assert.equal(projected?.exclusions?.groups.length, 1);
  assert.equal(projected?.exclusions?.groups[0]?.tasks.length, 99);
  const html = markup(artifact);
  assert.match(html, /99 tasks not changed/);
  assert.equal(html.match(/Same task title/g)?.length, 2);
  for (const task of excludedTasks)
    assert.ok(html.includes(`href="/tasks/${task.taskId}"`));
});

function withEvidence(artifact: ReturnType<typeof fixture>, evidence: unknown) {
  const text = JSON.stringify(evidence);
  const contentPreviews: Array<
    (typeof artifact.steps)[number]["contentPreviews"][number]
  > = [];
  for (let offset = 0; offset < text.length; offset += 3800) {
    contentPreviews.push({
      label: `Immutable Task plan evidence (${contentPreviews.length + 1})`,
      content: text.slice(offset, offset + 3800),
    });
  }
  return {
    ...artifact,
    steps: artifact.steps.map((step) => ({ ...step, contentPreviews })),
  };
}

test("malformed bulk exclusions never invent names or permit confirmation", () => {
  const base = argumentsFixture();
  assert.equal(base.sourceAssertion.kind, "bulk_selection");
  if (base.sourceAssertion.kind !== "bulk_selection")
    throw new Error("Expected bulk fixture");
  const excluded = base.sourceAssertion.excludedTasks;
  const first = excluded[0]!;
  assert.ok(first.expectedTask);
  const artifact = review(base);
  const controls: unknown[] = [
    { ...base, sourceAssertion: undefined },
    { ...base, operation: undefined },
    { ...base, operation: undefined, sourceAssertion: undefined },
    {
      ...base,
      sourceAssertion: {
        ...base.sourceAssertion,
        excludedTasks: [...excluded, first],
      },
    },
    {
      ...base,
      sourceAssertion: {
        ...base.sourceAssertion,
        excludedTasks: excluded.slice(1),
      },
    },
    {
      ...base,
      sourceAssertion: {
        ...base.sourceAssertion,
        excludedTasks: [
          { ...first, expectedTask: { ...first.expectedTask, id: unknownId } },
          ...excluded.slice(1),
        ],
      },
    },
    {
      ...base,
      sourceAssertion: {
        ...base.sourceAssertion,
        excludedTasks: [
          first,
          {
            ...excluded[1],
            expectedTask: {
              ...first.expectedTask,
              id: unknownId,
              title: "Foreign title must stay hidden",
            },
          },
        ],
      },
    },
  ];
  for (const evidence of controls) {
    const invalid = withEvidence(artifact, evidence);
    assert.equal(
      customerTaskReview(invalid.steps[0]!)?.detailsUnavailable,
      true
    );
    const html = markup(invalid);
    assert.match(html, /disabled=""/);
    assert.doesNotMatch(
      html,
      /Already arranged the welcome team|Foreign title must stay hidden/
    );
    assert.doesNotMatch(html, new RegExp(unknownId));
    assert.match(html, /Task details unavailable/);
  }
});

test("summary count or duplicate-reason drift refuses named projection", () => {
  const artifact = fixture();
  const step = artifact.steps[0]!;
  for (const exclusions of [
    step.exclusions.map((item, i) =>
      i === 0 ? { ...item, count: item.count + 1 } : item
    ),
    [...step.exclusions, step.exclusions[0]!],
    step.exclusions.slice(1),
  ]) {
    const invalid = { ...artifact, steps: [{ ...step, exclusions }] };
    assert.equal(
      customerTaskReview(invalid.steps[0]!)?.detailsUnavailable,
      true
    );
    assert.match(markup(invalid), /disabled=""/);
    assert.doesNotMatch(markup(invalid), /Already arranged the welcome team/);
  }
});

test("rescheduling uses its canonical completed exclusion and retains the exact plan", () => {
  const base = TASKS_EFFECT_ARGUMENT_SCHEMAS.bulkRescheduleTasksAction.parse(
    taskEffectPlanFixture("bulkRescheduleTasksAction")
  );
  assert.equal(base.sourceAssertion.kind, "bulk_selection");
  if (base.sourceAssertion.kind !== "bulk_selection")
    throw new Error("Expected bulk fixture");
  const expectedTask = {
    ...taskFixtureSnapshot(completedId, "complete"),
    title: "Completed venue call",
  };
  const reason = "Task is complete — reopen it before rescheduling";
  const artifact = review(
    {
      ...base,
      sourceAssertion: {
        ...base.sourceAssertion,
        requestedTaskIds: [
          ...base.sourceAssertion.requestedTaskIds,
          completedId,
        ],
        excludedTasks: [{ taskId: completedId, reason, expectedTask }],
      },
      exclusions: [
        { target: `Task ${completedId}: ${expectedTask.title}`, reason },
      ],
    },
    "bulkRescheduleTasksAction"
  );
  const before = JSON.stringify(artifact);
  const html = markup(artifact);
  assert.match(html, /1 task not changed/);
  assert.match(html, /Completed venue call/);
  assert.match(html, /Complete; reopen before rescheduling/);
  assert.doesNotMatch(html, /Contact log notes/);
  assert.equal(JSON.stringify(artifact), before);
});

test("100 successful task changes do not become 100 excluded tasks when contact logs do not apply", () => {
  const base = argumentsFixture(false);
  const original = base.taskWrites[0]!;
  assert.ok(original.before);
  const writes = Array.from({ length: 100 }, (_, index) => {
    const taskId = `60000000-0000-4000-8000-${String(index + 1).padStart(12, "0")}`;
    return {
      taskId,
      before: {
        ...original.before!,
        id: taskId,
        title: `Task to finish ${index + 1}`,
      },
      after: {
        ...original.after,
        id: taskId,
        title: `Task to finish ${index + 1}`,
      },
    };
  });
  const artifact = review({
    ...base,
    subjectTasks: writes.map((w) => w.before),
    taskWrites: writes,
    notifications: {
      ...base.notifications,
      scopedTaskIds: writes.map((w) => w.taskId),
    },
    sourceAssertion: {
      kind: "bulk_selection",
      requestedTaskIds: writes.map((w) => w.taskId),
      actionableTaskIds: writes.map((w) => w.taskId),
      excludedTasks: [],
    },
    completionEffects: {
      ...base.completionEffects,
      contactLogs: writes.map((w) => ({
        kind: "not_applicable",
        taskId: w.taskId,
        reason: "not_person",
        personId: null,
      })),
    },
    exclusions: writes.map((w) => ({
      target: `Task ${w.taskId}`,
      reason:
        "This Task is not related to a person, so no contact-log entry applies.",
    })),
    disclosure: {
      ...base.disclosure,
      targets: writes.map((w) => `Task ${w.taskId}: ${w.after.title}`),
      counts: [{ label: "Tasks", count: 100 }],
      changes: writes.map(({ before, after }) => ({
        label: `${after.title} — status`,
        before: before.status,
        after: after.status,
      })),
    },
  });
  const projected = customerTaskReview(artifact.steps[0]!);
  assert.equal(projected?.detailsUnavailable, false);
  assert.equal(projected?.exclusions?.groups.length, 0);
  assert.equal(projected?.exclusions?.contactLogNotes[0]?.count, 100);
  const html = markup(artifact);
  assert.match(html, /Contact log notes/);
  assert.doesNotMatch(html, /not included|tasks? not changed/);
  assert.doesNotMatch(html, / disabled=""/);
  for (const write of writes) assert.ok(html.includes(write.after.title));
});
