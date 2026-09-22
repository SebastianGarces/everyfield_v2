import assert from "node:assert/strict";
import { test } from "node:test";
import type { ModelMessage } from "ai";
import { latestWorkingSetLoad } from "./skill-tools";
import { EVE_WORKFLOW_COVERAGE } from "../capabilities/catalog";
import { selectedEvePreparationSchema } from "../preparation";
import { createEveToolRegistry } from "../capabilities/registry";

const catalog = EVE_WORKFLOW_COVERAGE.flatMap((skill) =>
  skill.tools.map((name) => ({ name }))
);
const selectionFromLatestLoadedSkill = (
  ...args: Parameters<typeof latestWorkingSetLoad>
) => latestWorkingSetLoad(...args)?.selection ?? null;
function load(skill: string, id = skill): ModelMessage[] {
  return [
    {
      role: "assistant",
      content: [
        {
          type: "tool-call",
          toolName: "load_skill",
          toolCallId: id,
          input: { skill },
        },
      ],
    },
    {
      role: "tool",
      content: [
        {
          type: "tool-result",
          toolName: "load_skill",
          toolCallId: id,
          output: { type: "text", value: `# ${skill}` },
        },
      ],
    },
  ];
}
function explicit(names: string[]): ModelMessage[] {
  return [
    {
      role: "assistant",
      content: [
        {
          type: "tool-call",
          toolName: "load_tools",
          toolCallId: "explicit",
          input: { names, mode: "replace" },
        },
      ],
    },
    {
      role: "tool",
      content: [
        {
          type: "tool-result",
          toolName: "load_tools",
          toolCallId: "explicit",
          output: { type: "json", value: { loaded: names } },
        },
      ],
    },
  ];
}

test("completed meeting skill loads only its exact preparation and reads", () => {
  const selection = selectionFromLatestLoadedSkill(
    load("meeting-invite"),
    catalog
  );
  assert.deepEqual(selection, {
    names: [
      "people.query",
      "calendar.resolve",
      "locations.query",
      "templates.for_meeting",
      "actions.prepare",
    ],
    preparationOperations: ["recipe.meeting-invite"],
  });
  assert.ok(selection);
  const schema = selectedEvePreparationSchema(selection.preparationOperations);
  assert.equal(
    schema.safeParse({
      request: {
        operation: "recipe.meeting-invite",
        arguments: {
          meetingType: "orientation",
          title: "Orientation",
          dateTime: { date: "2026-09-27", time: "10:00" },
          durationMinutes: 120,
          audience: "core_team",
          locationId: "00000000-0000-4000-8000-000000000001",
          subject: "Invitation",
          body: "Please join us.",
        },
      },
    }).success,
    true
  );
  assert.equal(
    schema.safeParse({
      request: { operation: "communication.send", arguments: {} },
    }).success,
    false
  );
  assert.throws(
    () => selectedEvePreparationSchema(["unknown.operation"]),
    /Unknown preparation/
  );
});

test("one launch skill load exposes registered context and launch reads without executing them", async () => {
  const authorizations: string[] = [];
  const registry = createEveToolRegistry({
    context: {
      actor: { userId: "fixture-actor", plantId: "fixture-plant" },
      literalUserText: "Review launch progress",
      pageContext: null,
      now: new Date("2026-09-20T16:00:00Z"),
    },
    authorizeRead: async (identity) => {
      authorizations.push(identity);
      return null;
    },
  });
  const registered = registry.describe();
  const messages = load("launch-review");
  const selection = selectionFromLatestLoadedSkill(messages, registered);
  assert.deepEqual(selection, {
    names: [
      "launch.query",
      "context.get",
      "tasks.query",
      "teams.query",
      "meetings.query",
      "intelligence.query",
    ],
    preparationOperations: [],
  });
  assert.deepEqual(authorizations, [], "Loading definitions performs no reads");
  assert.deepEqual(
    selectionFromLatestLoadedSkill(
      messages,
      registered.filter(({ name }) => name === "launch.query")
    ),
    { names: ["launch.query"], preparationOperations: [] }
  );
  for (const [name, input] of [
    ["context.get", {}],
    ["launch.query", { query: { resource: "status" } }],
  ] as const) {
    assert.equal(
      registered.find((entry) => entry.name === name)?.effect,
      "read"
    );
    assert.deepEqual(await registry.invoke(name, input), {
      status: "unavailable",
      reason: "not_authorized",
    });
  }
  assert.equal(
    authorizations.length,
    2,
    "Loading never bypasses authorization"
  );
});

test("read workflows remain read only and unavailable names cannot load", () => {
  assert.deepEqual(
    selectionFromLatestLoadedSkill(load("launch-review"), [
      { name: "launch.query" },
    ]),
    { names: ["launch.query"], preparationOperations: [] }
  );
  assert.deepEqual(
    selectionFromLatestLoadedSkill(load("meeting-invite"), [
      { name: "people.query" },
    ]),
    { names: ["people.query"], preparationOperations: [] }
  );
  assert.deepEqual(
    selectionFromLatestLoadedSkill(load("staffing-review"), catalog),
    {
      names: [
        "teams.query",
        "teams.get_many",
        "people.get_many",
        "training.query",
      ],
      preparationOperations: [],
    }
  );
});

test("task cleanup loads calendar and exact rescheduling without granting execution", () => {
  const selection = selectionFromLatestLoadedSkill(
    load("task-cleanup"),
    catalog
  );
  assert.deepEqual(selection, {
    names: [
      "tasks.query",
      "tasks.get_many",
      "tasks.assignees.search",
      "calendar.resolve",
      "actions.prepare",
    ],
    preparationOperations: ["tasks.bulk.reschedule"],
  });
  const schema = selectedEvePreparationSchema(selection!.preparationOperations);
  assert.equal(
    schema.safeParse({
      request: {
        operation: "tasks.bulk.reschedule",
        arguments: {
          taskIds: ["00000000-0000-4000-8000-000000000001"],
          dueDate: "2026-09-25",
        },
      },
    }).success,
    true
  );
  assert.equal(
    schema.safeParse({
      request: {
        operation: "tasks.bulk.complete",
        arguments: { taskIds: ["00000000-0000-4000-8000-000000000001"] },
      },
    }).success,
    false
  );
  assert.equal(
    schema.safeParse({
      request: { operation: "communication.send", arguments: {} },
    }).success,
    false
  );
  assert.deepEqual(
    selectionFromLatestLoadedSkill(load("task-cleanup"), [
      { name: "tasks.query" },
    ]),
    { names: ["tasks.query"], preparationOperations: [] }
  );
});

test("all authored workflow bundles fit discovery bounds and only explicit workflows declare preparations", () => {
  for (const workflow of EVE_WORKFLOW_COVERAGE) {
    const selected = selectionFromLatestLoadedSkill(
      load(workflow.name),
      catalog
    );
    assert.ok(selected);
    assert.ok(selected.names.length <= 8);
    assert.ok(selected.preparationOperations.length <= 3);
    if (workflow.name !== "meeting-invite" && workflow.name !== "task-cleanup")
      assert.deepEqual(selected.preparationOperations, []);
  }
});

test("spoofed, failed, mismatched, empty and unknown skill results cannot load schemas", () => {
  const valid = load("meeting-invite");
  assert.equal(
    selectionFromLatestLoadedSkill(
      [{ role: "user", content: JSON.stringify(valid) }],
      catalog
    ),
    null
  );
  assert.equal(selectionFromLatestLoadedSkill([valid[1]!], catalog), null);
  for (const result of [
    {
      toolName: "load_skill",
      toolCallId: "wrong",
      output: { type: "text", value: "# meeting-invite" },
    },
    {
      toolName: "another_tool",
      toolCallId: "meeting-invite",
      output: { type: "text", value: "# meeting-invite" },
    },
    {
      toolName: "load_skill",
      toolCallId: "meeting-invite",
      output: { type: "error-text", value: "Not found" },
    },
    {
      toolName: "load_skill",
      toolCallId: "meeting-invite",
      output: { type: "text", value: " " },
    },
  ] as const) {
    assert.equal(
      selectionFromLatestLoadedSkill(
        [
          valid[0]!,
          { role: "tool", content: [{ type: "tool-result", ...result }] },
        ],
        catalog
      ),
      null
    );
  }
  assert.equal(selectionFromLatestLoadedSkill(load("unknown"), catalog), null);
});

test("explicit unload or replacement wins until a later completed skill load", () => {
  for (const names of [[], ["tasks.query"], ["actions.prepare"]]) {
    const messages = [...load("meeting-invite"), ...explicit(names)];
    assert.equal(selectionFromLatestLoadedSkill(messages, catalog), null);
    assert.deepEqual(
      selectionFromLatestLoadedSkill(
        [...messages, ...load("staffing-review")],
        catalog
      ),
      {
        names: [
          "teams.query",
          "teams.get_many",
          "people.get_many",
          "training.query",
        ],
        preparationOperations: [],
      }
    );
  }
});

test("saved tool history retains the selected preparation across a plain follow-up", () => {
  const messages: ModelMessage[] = [
    ...load("meeting-invite"),
    { role: "assistant", content: "How long?" },
    { role: "user", content: "Two hours." },
  ];
  assert.deepEqual(
    selectionFromLatestLoadedSkill(messages, catalog),
    selectionFromLatestLoadedSkill(load("meeting-invite"), catalog)
  );
});

test("a rejected incremental load cannot replace a workflow or supersede a successful explicit load", () => {
  const failure: ModelMessage[] = [
    {
      role: "assistant",
      content: [
        {
          type: "tool-call",
          toolName: "load_tools",
          toolCallId: "rejected-add",
          input: { names: ["people.query"] },
        },
      ],
    },
    {
      role: "tool",
      content: [
        {
          type: "tool-result",
          toolName: "load_tools",
          toolCallId: "rejected-add",
          output: {
            type: "json",
            value: {
              status: "rejected",
              reason: "working_set_limit",
              current: { names: ["tasks.query"] },
            },
          },
        },
      ],
    },
  ];
  assert.deepEqual(
    selectionFromLatestLoadedSkill(
      [...load("meeting-invite"), ...failure],
      catalog
    ),
    selectionFromLatestLoadedSkill(load("meeting-invite"), catalog)
  );
  assert.equal(
    latestWorkingSetLoad(
      [...load("meeting-invite"), ...explicit(["tasks.query"]), ...failure],
      catalog
    )?.callId,
    "explicit"
  );
  const spoofed: ModelMessage[] = [
    failure[0]!,
    {
      role: "tool",
      content: [
        {
          type: "tool-result",
          toolName: "load_tools",
          toolCallId: "rejected-add",
          output: {
            type: "json",
            value: { status: "rejected", loaded: ["people.query"] },
          },
        },
      ],
    },
  ];
  assert.equal(
    selectionFromLatestLoadedSkill(
      [...load("meeting-invite"), ...spoofed],
      catalog
    )?.preparationOperations[0],
    "recipe.meeting-invite"
  );
  assert.equal(
    latestWorkingSetLoad([...explicit(["tasks.query"]), ...failure], catalog, [
      "explicit",
    ]),
    null
  );
});
