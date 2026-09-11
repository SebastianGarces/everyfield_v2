import assert from "node:assert/strict";
import test from "node:test";
import { EVRY_READ_WORKFLOWS } from "./read-workflows";
import { MEETING_INVITATION_MODEL_PREPARATION } from "./meeting-invitation-preparation";
import { PEOPLE_QUERY_READS } from "@/lib/evry/capabilities/queries/people";
import { OPERATIONS_QUERY_READS } from "@/lib/evry/capabilities/queries/operations";
import { CONTENT_QUERY_READS } from "@/lib/evry/capabilities/queries/content";
import {
  buildEvryReadArtifact,
  trustedEvryApplicationSourceLink,
} from "@/lib/evry/artifacts/core";

const id = "10000000-0000-4000-8000-000000000001";
const tools = [
  ...PEOPLE_QUERY_READS,
  ...OPERATIONS_QUERY_READS,
  ...CONTENT_QUERY_READS,
];
const fixture = buildEvryReadArtifact({
  title: "Fixture",
  filters: [],
  exclusions: [],
  sourceLinks: [],
  items: [
    {
      id,
      label: "Fixture",
      facts: [],
      sourceLink: trustedEvryApplicationSourceLink({
        label: "Open",
        href: "/people",
      }),
    },
  ],
});
const inputs: Record<string, unknown> = {
  "daily-work": { includeOverdue: true },
  "interview-review": { minimumMeetings: 2 },
  "meeting-followup": { meetingIds: [id] },
  "staffing-review": { teamIds: [id], skill: "music" },
  "launch-review": {},
  "delivery-recovery": { messageIds: [id] },
  "import-review": {
    attachmentReference: "fixture-reference",
    attachmentDigest: "a".repeat(64),
  },
};

test("all eight recipe entries are executable workflows or the existing compiled exact-plan recipe", async () => {
  assert.deepEqual(
    [
      ...EVRY_READ_WORKFLOWS.map((entry) => entry.id),
      MEETING_INVITATION_MODEL_PREPARATION.id.replace("recipe.", ""),
    ].sort(),
    [...Object.keys(inputs), "meeting-invite"].sort()
  );
  for (const recipe of EVRY_READ_WORKFLOWS) {
    const called: string[] = [];
    await recipe.run(async (toolId, argumentsValue) => {
      assert.ok(
        recipe.readIds.includes(toolId),
        `${recipe.id}: undeclared ${toolId}`
      );
      const tool = tools.find((entry) => entry.id === toolId);
      assert.ok(tool, toolId);
      const parsed = tool.inputSchema.safeParse(argumentsValue);
      assert.ok(
        parsed.success,
        `${recipe.id} → ${toolId}: ${parsed.error?.message}`
      );
      called.push(toolId);
      return fixture;
    }, inputs[recipe.id]);
    assert.ok(called.length > 0 && called.length <= 8, recipe.id);
    assert.ok(
      !called.includes("actions.prepare"),
      "Read workflows have no write path"
    );
  }
});

test("daily work separates overdue tasks and never folds them into today", async () => {
  const calls: unknown[] = [];
  await EVRY_READ_WORKFLOWS.find((entry) => entry.id === "daily-work")!.run(
    async (id, input) => {
      calls.push({ id, input });
      return fixture;
    },
    {}
  );
  assert.equal(calls.length, 2);
  assert.match(JSON.stringify(calls[0]), /"period":"today"/);
  assert.doesNotMatch(JSON.stringify(calls), /overdue/);
});

test("interview review keeps completed follow-up and absent follow-up as distinct filtered populations", async () => {
  const calls: unknown[] = [];
  await EVRY_READ_WORKFLOWS.find(
    (entry) => entry.id === "interview-review"
  )!.run(async (id, input) => {
    calls.push({ id, input });
    return fixture;
  }, {});
  assert.match(
    JSON.stringify(calls[0]),
    /"interview":"not_recorded".*"followUp":"recorded"/
  );
  assert.match(
    JSON.stringify(calls[1]),
    /"interview":"not_recorded".*"followUp":"not_recorded"/
  );
});
