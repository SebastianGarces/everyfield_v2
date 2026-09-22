import assert from "node:assert/strict";
import { test } from "node:test";
import { questions, regressions } from "../catalog";
import {
  feedbackReviewMatches,
  foundationalQuestions,
  foundationalRequestIds,
  observedBlockedMilestones,
  observedFoundationalFacts,
} from "./foundational-requests";
import { createFixtureManifest } from "./manifest";
import type { CapturedCall } from "./host-capture";

const first = "11111111-1111-4111-8111-111111111111";
const second = "22222222-2222-4222-8222-222222222222";
const plan = { planId: first, fingerprint: "a".repeat(64) };
function page(ids: string[], offset = 0, matched = ids.length) {
  return {
    id: `page-${offset}`,
    name: "launch.query",
    input: { query: { resource: "milestones", limit: 1, offset } },
    output: {
      kind: "read",
      resultMode: "list",
      counts: { matched, returned: ids.length },
      items: ids.map((id) => ({
        id,
        label: id,
        facts: [
          { label: "Blocked by overdue prerequisite", value: "true" },
          { label: "Completed at", value: "Not recorded" },
        ],
      })),
    },
  } satisfies CapturedCall;
}
function review(description = "Task filtering is confusing.") {
  return {
    activePlan: { mode: "set", plan },
    artifacts: [
      {
        kind: "confirmation",
        plan,
        consequences: ["Sends feedback after confirmation."],
        steps: [
          {
            resolvedTargets: [{ label: "Category", value: "suggestion" }],
            contentPreviews: [
              { label: "Exact description", content: description },
              { label: "Source page", content: "(Not supplied)" },
            ],
          },
        ],
      },
    ],
  };
}
const args = {
  category: "suggestion",
  description: "Task filtering is confusing.",
  pageUrl: null,
};

test("foundational cases preserve all three original questions", () => {
  for (const id of foundationalRequestIds)
    assert.deepEqual(
      [...questions, ...regressions].find((q) => q.id === id)!.turns,
      [foundationalQuestions[id]]
    );
});
test("complete actual launch pages and later complete refreshes retain exact identities", () => {
  assert.deepEqual(
    observedBlockedMilestones([page([first], 0, 2), page([second], 1, 2)]),
    { blockedMilestoneIds: [first, second], launchEvidenceComplete: true }
  );
  assert.deepEqual(
    observedBlockedMilestones([page([second]), page([first])])
      .blockedMilestoneIds,
    [first]
  );
  const last = page([second], 1, 2);
  last.input = { query: { offset: 1, limit: 1, resource: "milestones" } };
  assert.equal(
    observedBlockedMilestones([page([first], 0, 2), last])
      .launchEvidenceComplete,
    true
  );
});
test("missing, duplicate, mismatched and failed continuation pages cannot pass", () => {
  const start = page([first], 0, 2);
  for (const calls of [
    [start],
    [start, page([first], 1, 2)],
    [
      start,
      {
        ...page([second], 1, 2),
        input: {
          query: { resource: "milestones", completion: "complete", offset: 1 },
        },
      },
    ],
    [start, { ...page([second], 1, 2), output: { error: "Unavailable" } }],
    [page([first]), { ...page([second]), output: null }],
  ])
    assert.equal(
      observedBlockedMilestones(calls).launchEvidenceComplete,
      false
    );
});
test("broader launch evidence excludes completed milestones and requires explicit blockage evidence", () => {
  const call = page([first, second]);
  const data = call.output;
  data.items[1]!.facts[1]!.value = "2026-09-10";
  assert.deepEqual(observedBlockedMilestones([call]), {
    blockedMilestoneIds: [first],
    launchEvidenceComplete: true,
  });
  data.items[0]!.facts.shift();
  assert.equal(observedBlockedMilestones([call]).launchEvidenceComplete, false);
});
test("feedback review must expose the exact saved description, metadata and plan", () => {
  assert.equal(feedbackReviewMatches(review(), args, plan), true);
  assert.equal(
    feedbackReviewMatches(review("Task filtering is fine."), args, plan),
    false
  );
  assert.equal(
    feedbackReviewMatches(review(), { ...args, category: "bug" }, plan),
    false
  );
  assert.equal(
    feedbackReviewMatches(review(), { ...args, pageUrl: "/tasks" }, plan),
    false
  );
  assert.equal(
    feedbackReviewMatches(review(), args, { ...plan, planId: second }),
    false
  );
  const missing = review();
  missing.artifacts[0]!.consequences = [];
  assert.equal(feedbackReviewMatches(missing, args, plan), false);
});
test("long feedback review preserves native ordered pages and refuses partial or reordered content", () => {
  const description = "x".repeat(4000) + "the ending";
  const output = review();
  output.artifacts[0]!.steps[0]!.contentPreviews = [
    { label: "Exact description page 1", content: description.slice(0, 4000) },
    { label: "Exact description page 2", content: description.slice(4000) },
    { label: "Source page", content: "(Not supplied)" },
  ];
  assert.equal(
    feedbackReviewMatches(output, { ...args, description }, plan),
    true
  );
  output.artifacts[0]!.steps[0]!.contentPreviews[1]!.label =
    "Exact description page 3";
  assert.equal(
    feedbackReviewMatches(output, { ...args, description }, plan),
    false
  );
  output.artifacts[0]!.steps[0]!.contentPreviews.splice(1, 1);
  assert.equal(
    feedbackReviewMatches(output, { ...args, description }, plan),
    false
  );
});
test("capability smoke requires actual visible assistant text but does not pretend to judge its meaning", async () => {
  const manifest = createFixtureManifest("regression-capabilities", 0);
  const store = {
    query(sql: string) {
      return sql.includes("count(*)")
        ? [{ count: 0 }]
        : [{ id: manifest.ids.actor }];
    },
  };
  for (const [messages, visible] of [
    [
      [
        {
          id: "user",
          role: "user",
          parts: [{ type: "text", text: "What can you do for me?" }],
        },
      ],
      false,
    ],
    [
      [
        {
          id: "assistant",
          role: "assistant",
          parts: [
            { type: "reasoning", text: "Private reasoning is not an answer." },
          ],
        },
      ],
      false,
    ],
    [
      [
        {
          id: "assistant",
          role: "assistant",
          parts: [{ type: "text", text: "I can help with people and tasks." }],
        },
      ],
      true,
    ],
  ] as const) {
    const result = await observedFoundationalFacts({
      manifest,
      store,
      calls: [],
      presented: new Set(),
      messages,
    });
    assert.ok("visibleModelAnswer" in result.facts);
    assert.equal(result.facts.visibleModelAnswer, visible);
  }
});
