import assert from "node:assert/strict";
import { test } from "node:test";
import { resolve } from "node:path";
import { z } from "zod";
import { startFixtureStack } from "../fixtures/stack";
import { createFixtureStore } from "../fixtures/store";
import { createFixtureManifest, FIXTURE_NOW } from "../fixtures/manifest";
import { runCompiledEveFixture } from "./process";
import {
  EVE_CAPABILITY_CATALOG,
  EVE_WORKFLOW_COVERAGE,
} from "../../capabilities/catalog";

test(
  "compiled Eve HTTP runtime uses cookie auth, production task read and trusted presentation against isolated Postgres",
  { skip: process.env.EVRY_EVE_HTTP_PROOF !== "1", timeout: 180_000 },
  async () => {
    const stack = await startFixtureStack(
      process.env.EVRY_FIXTURE_MIGRATIONS_ROOT ?? process.cwd()
    );
    const store = createFixtureStore(stack.container);
    const manifest = createFixtureManifest("compiled-http-today", 0);
    try {
      store.seed(manifest);
      const outcome = await runCompiledEveFixture(
        {
          compiledEntry: resolve(".output/server/index.mjs"),
          databaseUrl: stack.databaseUrl,
          proxyUrl: stack.proxyUrl,
          sessionToken: manifest.sessionToken,
          actor: { userId: manifest.ids.actor, plantId: manifest.ids.plant },
          turns: [
            "My pending tasks due today, excluding overdue",
            "Only high priority",
          ],
          now: FIXTURE_NOW.toISOString(),
          maxCostUsd: 1,
          prices: {
            inputUsdPerMillion: 1,
            outputUsdPerMillion: 2,
            maxInputBytes: 500_000,
            maxOutputTokens: 1_000,
          },
          model: {
            mode: "scripted",
            responses: [
              {
                toolCalls: [
                  {
                    id: "fixture-tasks",
                    name: "tasks_query",
                    input: {
                      where: {
                        all: [
                          {
                            assignment: { kind: "mine" },
                            due: { kind: "relative", period: "today" },
                            status: ["not_started", "in_progress", "blocked"],
                          },
                        ],
                      },
                      query: { mode: "list" },
                    },
                  },
                ],
              },
              {
                toolCalls: [
                  {
                    id: "fixture-present",
                    name: "present_result",
                    input: { reference: "fixture-tasks" },
                  },
                ],
              },
              { text: "Here are your tasks due today." },
              {
                toolCalls: [
                  {
                    id: "fixture-high",
                    name: "tasks_query",
                    input: {
                      where: {
                        all: [
                          {
                            assignment: { kind: "mine" },
                            due: { kind: "relative", period: "today" },
                            status: ["not_started", "in_progress", "blocked"],
                            priority: ["high"],
                          },
                        ],
                      },
                      query: { mode: "list" },
                    },
                  },
                ],
              },
              {
                toolCalls: [
                  {
                    id: "fixture-high-present",
                    name: "present_result",
                    input: { reference: "fixture-high" },
                  },
                ],
              },
              { text: "Here is the high-priority task." },
            ],
          },
        },
        AbortSignal.timeout(120_000)
      );
      const call = outcome.hostCapture.calls.find(
        (entry) => entry.id === "fixture-tasks"
      );
      assert.ok(
        call,
        `The compiled runtime must call the production task capability: ${JSON.stringify(outcome.runtimeProof)}`
      );
      const result = z
        .object({
          kind: z.literal("read"),
          items: z.array(z.object({ id: z.string() })),
        })
        .parse(call.output);
      assert.deepEqual(
        result.items.map((item) => item.id).sort(),
        store.truth(manifest).taskIds
      );
      assert.deepEqual(outcome.hostCapture.presented, [
        "fixture-tasks",
        "fixture-high",
      ]);
      const high = z
        .object({
          kind: z.literal("read"),
          items: z.array(z.object({ id: z.string() })),
        })
        .parse(
          outcome.hostCapture.calls.find((entry) => entry.id === "fixture-high")
            ?.output
        );
      assert.deepEqual(
        high.items.map((item) => item.id).sort(),
        store.truth(manifest).highPriorityTaskIds
      );
      assert.deepEqual(outcome.runtimeProof?.turnInputs, [
        "My pending tasks due today, excluding overdue",
        "Only high priority",
      ]);
      const expectedTools = [
        ...EVE_CAPABILITY_CATALOG.map(([name]) => name.replaceAll(".", "_")),
        "context_get",
        "calendar_resolve",
        "locations_query",
        "locations_get",
        "templates_for_meeting",
      ];
      for (const name of expectedTools)
        assert.ok(
          outcome.runtimeProof?.availableTools.includes(name),
          `Missing compiled tool: ${name}`
        );
      assert.deepEqual(
        outcome.runtimeProof?.availableSkills.sort(),
        EVE_WORKFLOW_COVERAGE.map((skill) => skill.name).sort()
      );
      assert.ok(outcome.hostCapture.freshAuthorizations >= 1);
      assert.equal(outcome.hostCapture.refusedAuthorizations, 0);
      assert.equal(outcome.hostCapture.outboundMessages, 0);
      assert.equal(
        outcome.costUsd,
        0,
        "Scripted provider makes no paid model calls"
      );
      assert.equal(
        outcome.judge,
        null,
        "This is runtime proof, not model-quality evaluation"
      );
      assert.equal(
        outcome.answer,
        "Here are your tasks due today.\n\nHere is the high-priority task."
      );
    } finally {
      await stack.cleanup();
    }
  }
);

test(
  "compiled Eve resumes an answered native question in the original task",
  { skip: process.env.EVRY_EVE_HTTP_PROOF !== "1", timeout: 180_000 },
  async () => {
    const stack = await startFixtureStack(
      process.env.EVRY_FIXTURE_MIGRATIONS_ROOT ?? process.cwd()
    );
    const store = createFixtureStore(stack.container);
    const manifest = createFixtureManifest("compiled-http-question", 0);
    try {
      store.seed(manifest);
      const request =
        "Show my pending tasks due today. Ask whether to use high priority.";
      const outcome = await runCompiledEveFixture(
        {
          compiledEntry: resolve(".output/server/index.mjs"),
          databaseUrl: stack.databaseUrl,
          proxyUrl: stack.proxyUrl,
          sessionToken: manifest.sessionToken,
          actor: { userId: manifest.ids.actor, plantId: manifest.ids.plant },
          turns: [request, { respond: "Yes, only high priority" }],
          now: FIXTURE_NOW.toISOString(),
          maxCostUsd: 1,
          prices: {
            inputUsdPerMillion: 1,
            outputUsdPerMillion: 2,
            maxInputBytes: 500_000,
            maxOutputTokens: 1_000,
          },
          model: {
            mode: "scripted",
            responses: [
              {
                toolCalls: [
                  {
                    id: "fixture-question",
                    name: "ask_question",
                    input: {
                      prompt: "Only high priority?",
                      allowFreeform: true,
                    },
                  },
                ],
              },
              {
                toolCalls: [
                  {
                    id: "fixture-after-question",
                    name: "tasks_query",
                    input: {
                      where: {
                        all: [
                          {
                            assignment: { kind: "mine" },
                            due: { kind: "relative", period: "today" },
                            priority: ["high"],
                            status: ["not_started", "in_progress", "blocked"],
                          },
                        ],
                      },
                      query: { mode: "list" },
                    },
                  },
                ],
              },
              {
                toolCalls: [
                  {
                    id: "fixture-after-question-present",
                    name: "present_result",
                    input: { reference: "fixture-after-question" },
                  },
                ],
              },
              { text: "Here is your high-priority task due today." },
            ],
          },
        },
        AbortSignal.timeout(120_000)
      );
      assert.equal(outcome.clarificationCount, 1);
      assert.deepEqual(outcome.runtimeProof?.questionAnswers, [
        "Yes, only high priority",
      ]);
      assert.ok(outcome.runtimeProof?.eventTypes.includes("input.resolved"));
      // Eve re-resolves turn capabilities when resuming a parked question.
      // The reply is an answered tool result, not a replacement user request.
      assert.deepEqual(outcome.runtimeProof?.turnInputs, [request, request]);
      const result = z
        .object({
          kind: z.literal("read"),
          items: z.array(z.object({ id: z.string() })),
        })
        .parse(
          outcome.hostCapture.calls.find(
            (call) => call.id === "fixture-after-question"
          )?.output
        );
      assert.deepEqual(
        result.items.map((item) => item.id).sort(),
        store.truth(manifest).highPriorityTaskIds
      );
      assert.deepEqual(outcome.hostCapture.presented, [
        "fixture-after-question",
      ]);
      const answered = outcome.messages
        .flatMap((message) => message.parts)
        .find(
          (part) =>
            part.type === "dynamic-tool" &&
            part.toolName === "ask_question" &&
            part.state === "approval-responded" &&
            part.toolMetadata?.eve?.inputResponse?.text ===
              "Yes, only high priority"
        );
      assert.ok(
        answered,
        "Native reducer marks the question answered, not still awaiting approval"
      );
      assert.equal(outcome.costUsd, 0);
      assert.equal(outcome.hostCapture.refusedAuthorizations, 0);
    } finally {
      await stack.cleanup();
    }
  }
);
