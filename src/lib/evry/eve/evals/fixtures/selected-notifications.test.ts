import assert from "node:assert/strict";
import { test } from "node:test";
import { questions } from "../catalog";
import { fixtureMessageSchema } from "../http/transcript";
import {
  bindSelectedNotificationTurns,
  selectedNotificationRequest,
  selectedNotificationSetup,
  visibleSelectedNotificationIds,
  selectedNotificationReviewMatches,
} from "./selected-notifications";
const ids = [1, 2, 3].map((n) => `11111111-1111-4111-8111-11111111111${n}`);
const output = {
  kind: "read",
  resultMode: "list",
  title: "Unread notifications",
  counts: { matched: 5, returned: 3, excluded: 0 },
  filters: [],
  exclusions: [],
  sourceLinks: [],
  items: ids.map((id, i) => ({
    id,
    label: `Notice ${i}`,
    facts: [],
    sourceLink: { label: "Notifications", href: "/notifications" },
  })),
};
const call = {
  id: "selected",
  name: "notifications.query",
  input: { unreadOnly: true, limit: 3 },
  output,
};
const transcript = () => [
  fixtureMessageSchema.parse({
    id: "u0",
    role: "user",
    parts: [{ type: "text", text: selectedNotificationSetup }],
  }),
  fixtureMessageSchema.parse({
    id: "a0",
    role: "assistant",
    metadata: { turnId: "turn_0", status: "complete" },
    parts: [
      {
        type: "dynamic-tool",
        toolName: "notifications_query",
        toolCallId: call.id,
        state: "output-available",
        input: call.input,
        output: {
          data: output,
          presentation: {
            version: 1,
            turnId: "turn_0",
            results: [{ reference: call.id, artifacts: [output] }],
          },
        },
      },
      { type: "text", text: "[[evry-result:selected]]" },
    ],
  }),
  fixtureMessageSchema.parse({
    id: "u1",
    role: "user",
    parts: [{ type: "text", text: selectedNotificationRequest }],
  }),
];
test("notification original is unchanged after actual setup without opaque IDs", () => {
  const turns = questions.find((q) => q.id === "notifications-03")!.turns;
  assert.deepEqual(turns, [selectedNotificationRequest]);
  assert.deepEqual(bindSelectedNotificationTurns(turns), [
    selectedNotificationSetup,
    selectedNotificationRequest,
  ]);
  assert.throws(() => bindSelectedNotificationTurns(["Mark everything read"]));
});
test("three visible projected records can be a bounded prefix, not the whole feed", () => {
  assert.deepEqual(
    visibleSelectedNotificationIds(transcript(), [call], new Set([call.id])),
    ids
  );
});
test("actual server-selected rows from a broader query preserve their source evidence", async () => {
  const { collectResult } = await import("@/lib/evry/eve/runtime/results");
  const { selectEveResultRows } =
    await import("@/lib/evry/eve/runtime/result-selection");
  const { z } = await import("zod");
  const broader = {
    ...output,
    items: [
      ...output.items,
      { ...output.items[0]!, id: "22222222-2222-4222-8222-222222222222" },
    ],
    counts: { matched: 5, returned: 4, excluded: 0 },
  };
  const records = collectResult(
    [],
    {
      reference: "source",
      turnId: "turn_0",
      capability: "notifications.query",
    },
    z.json().parse(broader)
  );
  const selected = selectEveResultRows(records, "turn_0", {
    selections: [{ resultReference: "source", itemIds: ids }],
  });
  assert.ok("items" in selected);
  const derived = {
    ...call,
    name: "results.select",
    input: { selections: [{ resultReference: "source", itemIds: ids }] },
    output: selected,
  };
  const source = { ...call, id: "source", output: broader };
  const messages = transcript();
  messages[1] = fixtureMessageSchema.parse({
    ...messages[1],
    parts: [
      {
        type: "dynamic-tool",
        toolName: "results_select",
        toolCallId: call.id,
        state: "output-available",
        input: derived.input,
        output: {
          data: selected,
          presentation: {
            version: 1,
            turnId: "turn_0",
            results: [{ reference: call.id, artifacts: [selected] }],
          },
        },
      },
      { type: "text", text: "[[evry-result:selected]]" },
    ],
  });
  assert.deepEqual(
    visibleSelectedNotificationIds(
      messages,
      [source, derived],
      new Set([call.id])
    ),
    ids
  );
  assert.deepEqual(
    visibleSelectedNotificationIds(messages, [derived], new Set([call.id])),
    []
  );
  assert.deepEqual(
    visibleSelectedNotificationIds(
      messages,
      [derived, source],
      new Set([call.id])
    ),
    []
  );
  assert.deepEqual(
    visibleSelectedNotificationIds(
      messages,
      [
        { ...source, output: { ...broader, items: broader.items.slice(1) } },
        derived,
      ],
      new Set([call.id])
    ),
    []
  );
  assert.deepEqual(
    visibleSelectedNotificationIds(
      messages,
      [
        {
          ...source,
          output: {
            ...broader,
            items: broader.items.map((r) => ({ ...r, label: "Wrong content" })),
          },
        },
        derived,
      ],
      new Set([call.id])
    ),
    []
  );
});
test("missing, hidden, late or mismatched presentation cannot establish selection", () => {
  const messages = transcript();
  assert.deepEqual(
    visibleSelectedNotificationIds(messages, [call], new Set()),
    []
  );
  assert.deepEqual(
    visibleSelectedNotificationIds(
      [messages[0], messages[2], messages[1]],
      [call],
      new Set([call.id])
    ),
    []
  );
  assert.deepEqual(
    visibleSelectedNotificationIds(undefined, [call], new Set([call.id])),
    []
  );
  assert.deepEqual(
    visibleSelectedNotificationIds(
      messages,
      [{ ...call, output: { ...output, items: output.items.slice(0, 2) } }],
      new Set([call.id])
    ),
    []
  );
  const hidden = transcript();
  hidden[1] = fixtureMessageSchema.parse({
    ...hidden[1],
    parts: hidden[1]!.parts.filter((p) => p.type !== "text"),
  });
  assert.deepEqual(
    visibleSelectedNotificationIds(hidden, [call], new Set([call.id])),
    []
  );
});
const plan = { planId: ids[0]!, fingerprint: "a".repeat(64) };
const rows = ids.map((id, i) => ({
  stepId: `step-${i}`,
  notification: {
    id,
    title: `Notice ${i}`,
    body: `Message ${i}`,
    category: "tasks",
    type: "fixture.selection",
    status: "delivered",
    entityType: null,
    entityId: null,
    scheduledFor: "2026-09-19T12:00:00.000000Z",
    createdAt: "2026-09-20T15:00:00.000000Z",
    updatedAt: "2026-09-20T16:00:00.000000Z",
  },
}));
const review = () => ({
  artifacts: [
    {
      kind: "confirmation",
      plan,
      consequences: ["Marks only the selected notifications read."],
      steps: rows.map((r) => ({
        stepId: r.stepId,
        resolvedTargets: [
          {
            label: "Notification",
            value: `${r.notification.title} · ${r.notification.id}`,
          },
        ],
        counts: [{ label: "Notifications to mark read", count: 1 }],
        contentPreviews: [
          {
            label: "Exact immutable payload",
            content: JSON.stringify([r.notification]),
          },
        ],
      })),
    },
  ],
});
test("review exposes every exact named snapshot and immutable plan identity", () => {
  assert.equal(selectedNotificationReviewMatches(review(), plan, rows), true);
  assert.equal(
    selectedNotificationReviewMatches(
      review(),
      { ...plan, planId: ids[1]! },
      rows
    ),
    false
  );
  const partial = review();
  partial.artifacts[0]!.steps.pop();
  assert.equal(selectedNotificationReviewMatches(partial, plan, rows), false);
});
test("wrong targets, counts, duplicate steps, content and missing consequences fail", () => {
  for (const edit of [
    (r: ReturnType<typeof review>) => {
      r.artifacts[0]!.steps[0]!.resolvedTargets[0]!.value =
        "Another notification";
    },
    (r: ReturnType<typeof review>) => {
      r.artifacts[0]!.steps[0]!.counts[0]!.count = 2;
    },
    (r: ReturnType<typeof review>) => {
      r.artifacts[0]!.steps[1]!.stepId = "step-0";
    },
    (r: ReturnType<typeof review>) => {
      r.artifacts[0]!.steps[0]!.contentPreviews[0]!.content = "[]";
    },
    (r: ReturnType<typeof review>) => {
      r.artifacts[0]!.consequences = [];
    },
  ]) {
    const r = review();
    edit(r);
    assert.equal(selectedNotificationReviewMatches(r, plan, rows), false);
  }
});
