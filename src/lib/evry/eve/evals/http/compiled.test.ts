import assert from "node:assert/strict";
import { test } from "node:test";
import { resolve } from "node:path";
import { z } from "zod";
import { startFixtureStack } from "../fixtures/stack";
import { createFixtureStore } from "../fixtures/store";
import { createFixtureManifest, FIXTURE_NOW } from "../fixtures/manifest";
import { runCompiledEveFixture } from "./process";
import { EVE_WORKFLOW_COVERAGE } from "../../capabilities/catalog";

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
      const auditStart = store.auditStart();
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
          verifyReplay: true,
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
                    id: "load-daily-work",
                    name: "load_skill",
                    input: { skill: "daily-work" },
                  },
                ],
              },
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
                text: "Here are your tasks due today.\n\n[[evry-result:fixture-tasks]]",
              },
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
                text: "Here is the high-priority task.\n\n[[evry-result:fixture-high]]",
              },
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
      assert.ok(
        outcome.replay?.matchingTranscript,
        "A fresh official client restores the complete native transcript"
      );
      assert.ok(
        outcome.replay.stableActivity,
        "Reading saved events must not repeat model generations or tool executions"
      );
      assert.ok(
        outcome.replay.stableCapture,
        "Replaying the transcript must not change authorized results or send anything"
      );
      assert.equal(outcome.replay.snapshots, 2);
      assert.ok(outcome.replay.eventCount > 0);
      assert.equal(outcome.replay.generationsBefore, 5);
      assert.equal(outcome.replay.generationsAfter, 5);
      assert.equal(outcome.replay.invocationsBefore, 2);
      assert.equal(outcome.replay.invocationsAfter, 2);
      assert.deepEqual(
        store.writesSince(auditStart, manifest),
        [],
        "Read turns and fresh-client replay produce no domain writes"
      );
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
      const expectedTools = ["load_tools", "load_skill", "tasks_query"];
      for (const name of expectedTools)
        assert.ok(
          outcome.runtimeProof?.availableTools.includes(name),
          `Missing compiled tool: ${name}`
        );
      assert.equal(outcome.runtimeProof?.modelCalls, 5);
      assert.equal(
        outcome.runtimeProof?.availableTools.includes("present_result"),
        false,
        "Card placement is part of the final streamed answer, not a tool round trip"
      );
      assert.equal(
        outcome.runtimeProof?.availableTools.includes("actions_prepare"),
        false,
        "Unselected preparation schemas must not consume task-query context"
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
          turns: [request, "Yes, only high priority"],
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
                    id: "load-after-question",
                    name: "load_tools",
                    input: { names: ["tasks.query"] },
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
                text: "Here is your high-priority task due today.\n\n[[evry-result:fixture-after-question]]",
              },
            ],
          },
        },
        AbortSignal.timeout(120_000)
      );
      assert.equal(outcome.clarificationCount, 1);
      assert.equal(outcome.runtimeProof?.modelCalls, 4);
      assert.equal(
        outcome.runtimeProof?.availableTools.includes("present_result"),
        false
      );
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
