import assert from "node:assert/strict";
import { resolve } from "node:path";
import { test } from "node:test";
import { z } from "zod";
import { startFixtureStack } from "../src/lib/evry/eve/evals/fixtures/stack";
import { createFixtureStore } from "../src/lib/evry/eve/evals/fixtures/store";
import {
  createFixtureManifest,
  FIXTURE_NOW,
} from "../src/lib/evry/eve/evals/fixtures/manifest";
import { runCompiledEveFixture } from "../src/lib/evry/eve/evals/http/process";
import { eveRuntimeToolSchema } from "../src/lib/evry/eve/runtime/tool-schemas";

const daily = ["tasks.query", "meetings.query", "notifications.query"];
const additional = [
  "context.get",
  "launch.query",
  "teams.query",
  "training.query",
  "people.query",
];
const weekly = [...daily, ...additional]
  .map((name) => name.replaceAll(".", "_"))
  .sort();
const tool = (
  id: string,
  name: string,
  input: z.infer<ReturnType<typeof z.json>>
) => ({
  toolCalls: [{ id, name, input }],
});

test(
  "compiled incremental loading retains bounded weekly schemas, rejects overflow atomically and preserves explicit replacement and replay",
  {
    skip: process.env.EVRY_EVE_TOOL_LOADING_PROOF !== "1",
    timeout: 180_000,
  },
  async () => {
    const stack = await startFixtureStack(
      process.env.EVRY_FIXTURE_MIGRATIONS_ROOT ?? process.cwd()
    );
    const store = createFixtureStore(stack.container);
    const manifest = createFixtureManifest("compiled-tool-loading", 0);
    try {
      store.seed(manifest);
      const auditStart = store.auditStart();
      const outcome = await runCompiledEveFixture(
        {
          compiledEntry: resolve(
            process.env.EVRY_COMPILED_ENTRY ?? ".output/server/index.mjs"
          ),
          databaseUrl: stack.databaseUrl,
          proxyUrl: stack.proxyUrl,
          sessionToken: manifest.sessionToken,
          actor: { userId: manifest.ids.actor, plantId: manifest.ids.plant },
          turns: [
            "Review this week's operations without making changes.",
            "Switch to task cleanup tools, then clear them and select wiki search.",
            "Keep that selection; do not make any changes.",
            "Review interview candidates, then show their recorded attendance details without changing anything.",
          ],
          now: FIXTURE_NOW.toISOString(),
          maxCostUsd: 1,
          verifyReplay: true,
          verifyRestart: true,
          prices: {
            inputUsdPerMillion: 1,
            outputUsdPerMillion: 2,
            maxInputBytes: 500_000,
            maxOutputTokens: 1_000,
          },
          model: {
            mode: "scripted",
            responses: [
              tool("daily", "load_skill", { skill: "daily-work" }),
              tool("add-weekly", "load_tools", { names: additional }),
              tool("same-subset", "load_tools", { names: daily }),
              tool("ninth-tool", "load_tools", { names: ["wiki.search"] }),
              tool("weekly-reads", "code_mode", {
                js: "return await Promise.all([tools['context.get']({}), tools['launch.query']({query:{resource:'status'}})]);",
              }),
              tool("replace-with-preparation", "load_tools", {
                mode: "replace",
                names: ["actions.prepare"],
                preparationOperations: ["recipe.meeting-invite"],
              }),
              tool("add-task-read", "load_tools", { names: ["tasks.query"] }),
              { text: "The reads are complete. Nothing has been changed." },
              tool("cleanup", "load_skill", { skill: "task-cleanup" }),
              tool("unload", "load_tools", { names: [] }),
              tool("replace-with-wiki", "load_tools", {
                mode: "replace",
                names: ["wiki.search"],
              }),
              { text: "Wiki search is selected. Nothing has been changed." },
              { text: "The same selection remains available." },
              tool("interview-skill", "load_skill", {
                skill: "interview-review",
              }),
              tool("candidate-read", "people_query", {
                cohort: {
                  all: {
                    interview: "not_recorded",
                    attendance: { minimumMeetings: 2 },
                  },
                },
                result: { mode: "list", limit: 50 },
              }),
              tool("add-attendance", "load_tools", {
                names: ["attendance.query"],
              }),
              tool("interview-details", "code_mode", {
                js: "return await Promise.all([tools['people.history.query']({resource:{kind:'follow_up',state:'completed'},result:{mode:'list',limit:50}}), tools['attendance.query']({statuses:['attended'],result:{mode:'list',limit:50}})]);",
              }),
              {
                text: "The candidate and attendance reads are complete. Nothing has been changed.",
              },
            ],
          },
        },
        AbortSignal.timeout(150_000)
      );
      const requests = outcome.runtimeProof?.modelRequests;
      assert.ok(requests);
      assert.equal(requests.length, 18);
      const baseline = new Set(requests[0].tools);
      const capabilities = (index: number) =>
        requests[index].tools.filter((name) => !baseline.has(name)).sort();
      assert.deepEqual(
        capabilities(1),
        daily.map((name) => name.replaceAll(".", "_")).sort()
      );
      for (const index of [2, 3, 4, 5])
        assert.deepEqual(
          capabilities(index),
          weekly,
          `Provider request ${index} lost a selected schema`
        );
      const expandedPeopleSchema = JSON.stringify(
        z.toJSONSchema(eveRuntimeToolSchema("people.query"), {
          target: "draft-7",
          io: "input",
        })
      );
      for (const index of [2, 3, 4, 5]) {
        const providerSchema = requests[index].toolSchemas?.find(
          (entry) => entry.name === "people_query"
        )?.inputSchema;
        const serialized = JSON.stringify(providerSchema);
        assert.ok(serialized, "The compiled provider must receive the schema");
        assert.match(serialized, /#\/(definitions|\$defs)\//);
        assert.ok(
          serialized.length < expandedPeopleSchema.length * 0.6,
          "Compiled and replayed tools must retain compact library definitions"
        );
      }
      // Check actual schema content, not just the provider names.
      for (const [name, required] of [
        ["launch_query", "query"],
        ["teams_query", "request"],
        ["training_query", "request"],
      ]) {
        const schema = requests[4].toolSchemas?.find(
          (entry) => entry.name === name
        )?.inputSchema;
        const parsed = z
          .object({
            properties: z.record(z.string(), z.unknown()),
            required: z.array(z.string()),
          })
          .parse(schema);
        assert.ok(Object.hasOwn(parsed.properties, required));
        assert.ok(parsed.required.includes(required));
      }
      assert.deepEqual(capabilities(6), ["actions_prepare"]);
      for (const index of [7, 8]) {
        assert.deepEqual(capabilities(index), [
          "actions_prepare",
          "tasks_query",
        ]);
        const schema = requests[index].toolSchemas?.find(
          (entry) => entry.name === "actions_prepare"
        )?.inputSchema;
        assert.match(JSON.stringify(schema), /recipe\.meeting-invite/);
        assert.doesNotMatch(
          JSON.stringify(schema),
          /tasks\.bulk\.complete|communication\.send/
        );
      }
      assert.deepEqual(capabilities(9), [
        "actions_prepare",
        "calendar_resolve",
        "tasks_assignees_search",
        "tasks_get_many",
        "tasks_query",
      ]);
      assert.deepEqual(capabilities(10), []);
      for (const index of [11, 12])
        assert.deepEqual(capabilities(index), ["wiki_search"]);
      for (const index of [14, 15])
        assert.deepEqual(capabilities(index), [
          "people_history_query",
          "people_query",
        ]);
      for (const index of [16, 17])
        assert.deepEqual(capabilities(index), [
          "attendance_query",
          "people_history_query",
          "people_query",
        ]);
      for (const [index, name, required] of [
        [14, "people_query", "result"],
        [14, "people_history_query", "resource"],
        [16, "attendance_query", "result"],
      ] as const) {
        const schema = z
          .object({
            properties: z.record(z.string(), z.unknown()),
            required: z.array(z.string()),
          })
          .parse(
            requests[index].toolSchemas?.find((entry) => entry.name === name)
              ?.inputSchema
          );
        assert.ok(Object.hasOwn(schema.properties, required));
        assert.ok(schema.required.includes(required));
      }
      for (const request of requests)
        assert.ok(
          request.tools.filter((name) => !baseline.has(name)).length <= 8
        );
      const parts = outcome.messages.flatMap((message) => message.parts);
      const rejection = parts.find(
        (part) =>
          part.type === "dynamic-tool" && part.toolCallId === "ninth-tool"
      );
      assert.ok(rejection && "output" in rejection);
      const refused = z
        .object({
          status: z.literal("rejected"),
          reason: z.literal("working_set_limit"),
          current: z.object({ names: z.array(z.string()) }),
        })
        .parse(rejection.output);
      assert.deepEqual(
        [...refused.current.names].sort(),
        [...daily, ...additional].sort()
      );
      assert.deepEqual(
        outcome.hostCapture.calls.map((call) => call.name).sort(),
        [
          "attendance.query",
          "context.get",
          "launch.query",
          "people.history.query",
          "people.query",
        ]
      );
      assert.equal(
        outcome.hostCapture.freshAuthorizations,
        5,
        "Loading does not authorize; each real read reauthorizes"
      );
      assert.equal(outcome.hostCapture.refusedAuthorizations, 0);
      assert.equal(outcome.hostCapture.outboundMessages, 0);
      assert.deepEqual(store.writesSince(auditStart, manifest), []);
      assert.deepEqual(
        store.query(
          `select id from evry_action_plans where church_id='${manifest.ids.plant}'`
        ),
        []
      );
      assert.ok(outcome.replay?.matchingTranscript);
      assert.ok(outcome.replay?.stableActivity);
      assert.ok(outcome.restart?.matchingTranscript);
      assert.ok(outcome.restart?.sameSession);
      assert.ok(outcome.restart?.differentProcess);
      assert.equal(outcome.restart?.modelCalls, 0);
      assert.equal(outcome.restart?.capturedCalls, 0);
      assert.equal(outcome.costUsd, 0);
      assert.equal(outcome.judge, null);
    } finally {
      await stack.cleanup();
    }
  }
);
