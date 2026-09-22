import assert from "node:assert/strict";
import { test } from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";

import { EVRY_CONFIRMATION_FIXTURES } from "@/lib/evry/artifacts/fixtures";
import { buildEvryConfirmationArtifact } from "@/lib/evry/artifacts/review";
import { publicEvryArtifact } from "@/lib/evry/artifacts/public";
import { taskFixtureSnapshot } from "@/lib/evry/capabilities/tasks/test-fixtures";
import {
  hydrateStoredEvryConversationArtifact,
  parseEvryConversationArtifactDocument,
} from "@/lib/evry/conversations/artifacts";
import {
  customerContentPreviews,
  customerReviewTargets,
  customerTaskReview,
} from "./artifact-presentation";
import {
  EvryArtifactRenderer,
  renderableEvryArtifact,
} from "./artifact-renderer";

const taskId = "00000000-0000-4000-8000-000000000001";
const assigneeId = "00000000-0000-4000-8000-000000000002";
function renderableReview(
  artifact: ReturnType<typeof buildEvryConfirmationArtifact>
) {
  return renderableEvryArtifact(
    publicEvryArtifact(
      hydrateStoredEvryConversationArtifact(
        parseEvryConversationArtifactDocument(artifact)
      )
    )
  );
}
function target(
  title: string,
  changes: Record<string, { before: unknown; after: unknown }>
) {
  return {
    label: "Task 1",
    value: `Task ${taskId}: ${JSON.stringify({ title, changes })}`,
    sourceLink: { label: "Open task", href: `/tasks/${taskId}` },
  };
}
function evidence(writes: unknown[]) {
  const text = JSON.stringify({ taskWrites: writes });
  const parts = [];
  for (let offset = 0; offset < text.length; offset += 3800)
    parts.push({
      label: `Immutable Task plan evidence (${parts.length + 1})`,
      content: text.slice(offset, offset + 3800),
    });
  return parts;
}
function step() {
  const title = "Call the venue coordinator";
  const before = {
    ...taskFixtureSnapshot(taskId, "in_progress"),
    title,
    dueDate: "2026-09-17",
    description: "unchanged snapshot data",
  };
  return {
    stepId: "reschedule",
    title: "Reschedule tasks",
    effectKind: "bulk_change" as const,
    reversibility: "reversible" as const,
    resolvedTargets: [
      target(title, {
        dueDate: { before: "2026-09-17", after: "2026-09-25" },
        updatedAt: {
          before: "2026-09-17T00:00:00.000Z",
          after: "2026-09-20T16:00:00.000Z",
        },
      }),
    ],
    beforeAfter: [
      {
        label: `${title} — status`,
        before: "in_progress",
        after: "in_progress",
        count: 1,
      },
      {
        label: `${title} — due date`,
        before: "2026-09-17",
        after: "2026-09-25",
        count: 1,
      },
      {
        label: `${title} — assignee`,
        before: assigneeId,
        after: assigneeId,
        count: 1,
      },
    ],
    counts: [{ label: "Tasks changed", count: 1 }],
    exclusions: [{ reason: "Launch milestones remain unchanged", count: 1 }],
    dateTime: null,
    contentPreviews: evidence([
      { taskId, before, after: { ...before, dueDate: "2026-09-25" } },
    ]),
  };
}

test("task review projects the actual changed date and title without modifying its source", () => {
  const input = step();
  const original = JSON.stringify(input);
  const review = customerTaskReview(input);
  assert.ok(review);
  assert.equal(review.targets[0]?.value, "Call the venue coordinator");
  assert.equal(review.targets[0]?.sourceLink?.href, `/tasks/${taskId}`);
  assert.deepEqual(review.changes, [
    {
      label: "Call the venue coordinator: Due date",
      before: "Sep 17, 2026",
      after: "Sep 25, 2026",
      count: 1,
    },
  ]);
  assert.deepEqual(customerContentPreviews(input.contentPreviews), []);
  assert.equal(
    customerReviewTargets(input.resolvedTargets)[0]?.value,
    "Call the venue coordinator"
  );
  assert.equal(JSON.stringify(input), original);
});

test("the actual renderer shows task changes and preserves confirmation, exclusions and consequences", () => {
  const artifact = buildEvryConfirmationArtifact({
    kind: "confirmation",
    artifactVersion: 1,
    plan: EVRY_CONFIRMATION_FIXTURES.bulkStageChange.plan,
    title: "Move overdue tasks to Friday",
    actionLabel: "Reschedule tasks",
    steps: [step()],
    consequences: ["Only the reviewed due dates will change."],
  });
  const before = JSON.stringify(artifact);
  const markup = renderToStaticMarkup(
    createElement(EvryArtifactRenderer, {
      model: renderableReview(artifact),
      options: {
        confirmationControls: { onCancel() {}, onEdit() {}, onExecute() {} },
      },
    })
  );
  for (const text of [
    "Call the venue coordinator",
    "Sep 17, 2026",
    "Sep 25, 2026",
    "Launch milestones remain unchanged",
    "Only the reviewed due dates will change.",
    "Reschedule tasks",
    "Nothing has changed yet",
  ])
    assert.ok(markup.includes(text), text);
  for (const text of [
    "taskWrites",
    "updatedAt",
    "notificationId",
    "Immutable Task",
    "in_progress",
    "unchanged snapshot",
    assigneeId,
  ])
    assert.ok(!markup.includes(text), text);
  assert.equal(JSON.stringify(artifact), before);
  assert.doesNotMatch(
    markup.match(/<button[^>]*>Reschedule tasks<\/button>/)?.[0] ?? "",
    / disabled=""/
  );
});

test("real status and assignment changes remain visible without inventing an assignee name", () => {
  const input = step();
  input.resolvedTargets = [
    target("Prepare handout", {
      status: { before: "not_started", after: "in_progress" },
      assignedToId: { before: null, after: assigneeId },
      priority: { before: "low", after: "high" },
    }),
  ];
  input.beforeAfter = [];
  const before = {
    ...taskFixtureSnapshot(taskId),
    title: "Prepare handout",
    assignedToId: null,
    priority: "low",
  };
  input.contentPreviews = evidence([
    {
      taskId,
      before,
      after: {
        ...before,
        status: "in_progress",
        assignedToId: assigneeId,
        priority: "high",
      },
    },
  ]);
  assert.deepEqual(
    customerTaskReview(input)?.changes.map((c) => [c.before, c.after]),
    [
      ["Not Started", "In Progress"],
      ["Low", "High"],
      ["Unassigned", assigneeId],
    ]
  );
});

test("large changed content uses the matching full write and keeps additional consequences visible", () => {
  const input = step();
  const description = `Revised instructions ${"details ".repeat(700)}END OF CHANGE`;
  input.resolvedTargets = [
    {
      ...input.resolvedTargets[0]!,
      value: `Task ${taskId}: Call the venue coordinator. Full exact before/after content is displayed in Immutable Task plan evidence below.`,
    },
  ];
  const before = {
    ...taskFixtureSnapshot(taskId),
    title: "Call the venue coordinator",
    description: "Old instructions",
    dueDate: "2026-09-17",
    updatedAt: "2026-09-17T00:00:00.000Z",
  };
  const evidence = JSON.stringify({
    taskWrites: [
      {
        taskId,
        before,
        after: { ...before, description, dueDate: "2026-09-25" },
      },
    ],
  });
  input.contentPreviews = [0, 3800].map((offset, index) => ({
    label: `Immutable Task plan evidence (${index + 1})`,
    content: evidence.slice(offset, index === 0 ? 3800 : undefined),
  }));
  input.beforeAfter.push({
    label: "Contact log",
    before: "Absent",
    after: "Record completed call",
    count: 1,
  });
  const review = customerTaskReview(input);
  assert.ok(review);
  assert.equal(review.targets[0]?.value, before.title);
  assert.equal(
    review.changes.find((c) => c.label.endsWith(": description"))?.after,
    description
  );
  assert.equal(
    review.changes.find((c) => c.label === "Contact log")?.after,
    "Record completed call"
  );
  assert.equal(
    review.changes.filter((c) => c.label.endsWith(": Due date")).length,
    1
  );
  assert.deepEqual(customerContentPreviews(input.contentPreviews), []);
  const artifact = buildEvryConfirmationArtifact({
    kind: "confirmation",
    artifactVersion: 1,
    plan: EVRY_CONFIRMATION_FIXTURES.bulkStageChange.plan,
    title: "Update task instructions",
    actionLabel: "Update task",
    steps: [input],
    consequences: ["Only the reviewed task changes will be applied."],
  });
  const markup = renderToStaticMarkup(
    createElement(EvryArtifactRenderer, {
      model: renderableReview(artifact),
    })
  );
  assert.ok(
    markup.includes(description),
    "The actual long changed description must remain visible"
  );
});

test("non-task reviews and real message templates keep their existing presentation", () => {
  const previews = [
    {
      label: "Message",
      content: "Hello {{name}}",
      format: "plain_text" as const,
    },
  ];
  assert.equal(
    customerTaskReview({
      resolvedTargets: [
        { label: "Meeting", value: "Orientation", sourceLink: null },
      ],
      contentPreviews: previews,
      beforeAfter: [],
    }),
    null
  );
  assert.deepEqual(customerContentPreviews(previews), previews);
});

test("calendar dates stay calendar dates and deletion is disclosed explicitly", () => {
  const input = step();
  input.resolvedTargets = [
    target("Test", {
      dueDate: { before: null, after: "2026-03-08" },
      deletedAt: { before: null, after: "2026-09-20T16:00:00.000Z" },
    }),
  ];
  input.beforeAfter = [];
  const before = {
    ...taskFixtureSnapshot(taskId),
    title: "Test",
    dueDate: null,
  };
  input.contentPreviews = evidence([
    {
      taskId,
      before,
      after: {
        ...before,
        dueDate: "2026-03-08",
        deletedAt: "2026-09-20T16:00:00.000Z",
      },
    },
  ]);
  assert.deepEqual(
    customerTaskReview(input)?.changes.map((c) => [c.before, c.after]),
    [
      ["None", "Mar 8, 2026"],
      ["Active", "Deleted"],
    ]
  );
});

test("duplicate task titles retain each exact change and partial evidence is explicitly unavailable", (t) => {
  const input = step();
  const secondId = "00000000-0000-4000-8000-000000000003";
  const second = target("Call the venue coordinator", {
    dueDate: { before: "2026-09-19", after: "2026-09-26" },
  });
  input.resolvedTargets.push({
    ...second,
    label: "Task 2",
    value: second.value.replace(taskId, secondId),
    sourceLink: { label: "Open task", href: `/tasks/${secondId}` },
  });
  const firstBefore = {
    ...taskFixtureSnapshot(taskId, "in_progress"),
    title: "Call the venue coordinator",
    dueDate: "2026-09-17",
  };
  const secondBefore = {
    ...taskFixtureSnapshot(secondId),
    title: firstBefore.title,
    dueDate: "2026-09-19",
  };
  input.contentPreviews = evidence([
    {
      taskId,
      before: firstBefore,
      after: { ...firstBefore, dueDate: "2026-09-25" },
    },
    {
      taskId: secondId,
      before: secondBefore,
      after: { ...secondBefore, dueDate: "2026-09-26" },
    },
  ]);
  assert.deepEqual(
    customerTaskReview(input)?.targets.map((t) => t.sourceLink?.href),
    [`/tasks/${taskId}`, `/tasks/${secondId}`]
  );
  assert.equal(customerTaskReview(input)?.changes.length, 2);
  assert.deepEqual(
    customerTaskReview(input)?.changes.map((c) => c.after),
    ["Sep 25, 2026", "Sep 26, 2026"]
  );
  const errors = t.mock.method(console, "error", () => {});
  const completeArtifact = buildEvryConfirmationArtifact({
    kind: "confirmation",
    artifactVersion: 1,
    plan: EVRY_CONFIRMATION_FIXTURES.bulkStageChange.plan,
    title: "Move tasks",
    actionLabel: "Reschedule tasks",
    steps: [input],
    consequences: ["Only reviewed dates change."],
  });
  const completeMarkup = renderToStaticMarkup(
    createElement(EvryArtifactRenderer, {
      model: renderableReview(completeArtifact),
    })
  );
  assert.match(completeMarkup, /Sep 25, 2026/);
  assert.match(completeMarkup, /Sep 26, 2026/);
  assert.equal(errors.mock.calls.length, 0);
  input.resolvedTargets[1]!.value = `Task ${secondId}: Call the venue coordinator. Full exact before/after content is displayed in Immutable Task plan evidence below.`;
  input.contentPreviews = [
    { label: "Immutable Task plan evidence (1)", content: '{"taskWrites":[' },
  ];
  const review = customerTaskReview(input);
  assert.ok(review?.detailsUnavailable);
  assert.ok(
    review.changes.some((c) => c.label === input.beforeAfter[1]!.label),
    "Do not hide ambiguous same-title disclosure"
  );
  const previews = customerContentPreviews(
    input.contentPreviews,
    review.detailsUnavailable
  );
  assert.match(previews[0]!.content, /Request a new review before confirming/);
  assert.ok(!previews[0]!.content.includes("taskWrites"));
  const artifact = buildEvryConfirmationArtifact({
    kind: "confirmation",
    artifactVersion: 1,
    plan: EVRY_CONFIRMATION_FIXTURES.bulkStageChange.plan,
    title: "Move tasks",
    actionLabel: "Reschedule tasks",
    steps: [input],
    consequences: ["Only reviewed dates change."],
  });
  const markup = renderToStaticMarkup(
    createElement(EvryArtifactRenderer, {
      model: renderableReview(artifact),
      options: {
        confirmationControls: { onCancel() {}, onEdit() {}, onExecute() {} },
      },
    })
  );
  assert.match(
    markup.match(/<button[^>]*>Reschedule tasks<\/button>/)?.[0] ?? "",
    / disabled=""/
  );
  assert.match(markup, /Request a new review before confirming/);
});

test("partial snapshots, duplicate writes and mismatched task links cannot produce a confirmable projection", () => {
  for (const malformed of [
    [
      {
        taskId,
        before: { id: taskId, title: "Call the venue coordinator" },
        after: { id: taskId, title: "Call the venue coordinator" },
      },
    ],
    [
      {
        taskId,
        before: taskFixtureSnapshot(taskId),
        after: taskFixtureSnapshot(taskId),
      },
      {
        taskId,
        before: taskFixtureSnapshot(taskId),
        after: taskFixtureSnapshot(taskId),
      },
    ],
  ]) {
    const input = step();
    input.contentPreviews = evidence(malformed);
    assert.equal(customerTaskReview(input)?.detailsUnavailable, true);
    assert.ok(
      customerTaskReview(input)?.changes.some((c) => c.after === "2026-09-25"),
      "Retain unaccounted legacy change"
    );
  }
  const input = step();
  input.resolvedTargets[0]!.sourceLink.href = `/tasks/${assigneeId}`;
  assert.equal(customerTaskReview(input)?.detailsUnavailable, true);
});

test("compact partial changes cannot conceal the authoritative due-date change", () => {
  const input = step();
  input.resolvedTargets = [
    target("Call the venue coordinator", {
      priority: { before: "low", after: "high" },
    }),
  ];
  assert.deepEqual(
    customerTaskReview(input)?.changes.map((c) => c.after),
    ["Sep 25, 2026"]
  );
  input.contentPreviews = [];
  assert.equal(customerTaskReview(input)?.detailsUnavailable, true);
});
