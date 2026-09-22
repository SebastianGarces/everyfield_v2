import assert from "node:assert/strict";
import { resolve } from "node:path";
import { test } from "node:test";
import { startFixtureStack } from "@/lib/evry/eve/evals/fixtures/stack";
import { createFixtureStore } from "@/lib/evry/eve/evals/fixtures/store";
import {
  createFixtureManifest,
  FIXTURE_NOW,
} from "@/lib/evry/eve/evals/fixtures/manifest";
import { runCompiledEveFixture } from "@/lib/evry/eve/evals/http/process";
import { compiledFixtureRequest } from "@/lib/evry/eve/evals/http/process-contract";

const reference = "native-history:read";
const firstTurn = "Show my pending tasks.";
const secondTurn = `Keep the saved task evidence. Literal reference ${reference}.`;

test("presentation checkpoint inspection is unavailable to live fixture requests", () => {
  const request = compiledFixtureRequest.safeParse({
    compiledEntry: "/private/tmp/unused/index.mjs",
    databaseUrl: "postgresql://fixture:fixture@127.0.0.1:5499/fixture",
    proxyUrl: "http://127.0.0.1:4109",
    sessionToken: "fixture-only",
    actor: { userId: "fixture-user", plantId: "fixture-plant" },
    turns: [firstTurn],
    now: FIXTURE_NOW.toISOString(),
    maxCostUsd: 1,
    prices: {
      inputUsdPerMillion: 1,
      outputUsdPerMillion: 2,
      maxInputBytes: 500_000,
      maxOutputTokens: 1_000,
    },
    model: { mode: "live", spendingApproved: true },
    verifyPresentationInventory: [reference],
  });
  assert.equal(request.success, false);
  if (request.success)
    assert.fail("Live request must refuse the scripted proof hook");
  assert.ok(
    request.error.issues.some(
      (issue) => issue.path[0] === "verifyPresentationInventory"
    )
  );
});

test(
  "compiled read publication persists its inventory across replacement and scrubs only obsolete provider presentation cues",
  {
    skip: process.env.EVRY_EVE_HTTP_PROOF !== "1",
    timeout: 180_000,
  },
  async () => {
    const stack = await startFixtureStack(
      process.env.EVRY_FIXTURE_MIGRATIONS_ROOT ?? process.cwd()
    );
    const store = createFixtureStore(stack.container);
    const manifest = createFixtureManifest("compiled-presentation-history", 0);
    try {
      store.seed(manifest);
      const before = store.auditStart();
      const outcome = await runCompiledEveFixture(
        {
          compiledEntry: resolve(
            process.env.EVRY_EVE_COMPILED_ENTRY ?? ".output/server/index.mjs"
          ),
          databaseUrl: stack.databaseUrl,
          proxyUrl: stack.proxyUrl,
          sessionToken: manifest.sessionToken,
          actor: { userId: manifest.ids.actor, plantId: manifest.ids.plant },
          turns: [firstTurn],
          now: FIXTURE_NOW.toISOString(),
          maxCostUsd: 1,
          prices: {
            inputUsdPerMillion: 1,
            outputUsdPerMillion: 2,
            maxInputBytes: 500_000,
            maxOutputTokens: 1_000,
          },
          verifyPresentationInventory: [reference],
          model: {
            mode: "scripted",
            responses: [
              {
                toolCalls: [
                  {
                    id: "history-load",
                    name: "load_tools",
                    input: { names: ["tasks.query"] },
                  },
                ],
              },
              {
                toolCalls: [
                  {
                    id: reference,
                    name: "tasks_query",
                    input: {
                      where: {
                        all: [
                          {
                            assignment: { kind: "mine" },
                            status: ["not_started", "in_progress", "blocked"],
                          },
                        ],
                      },
                      query: { mode: "list", limit: 50 },
                    },
                  },
                ],
              },
              {
                assertPresentation: {
                  retired: [],
                  current: [reference],
                  preservedText: ["task-today"],
                  userText: firstTurn,
                },
                toolCalls: [
                  {
                    id: "history-alias",
                    name: "code_mode",
                    input: {
                      js: `return { alias: '${reference}', groups: { '${reference}': ['task-today'] } };`,
                    },
                  },
                ],
              },
              {
                assertPresentation: {
                  retired: [],
                  current: [reference],
                  preservedText: ["task-today"],
                  userText: firstTurn,
                },
                text: `Saved task evidence. [[evry-result:${encodeURIComponent(reference)}]]`,
              },
            ],
          },
          restartFollowup: {
            turn: secondTurn,
            responses: [
              {
                assertPresentation: {
                  retired: [reference],
                  current: [],
                  preservedText: ["task-today", "Saved task evidence."],
                  userText: secondTurn,
                },
                text: "The saved task evidence remains available.",
              },
            ],
          },
        },
        AbortSignal.timeout(150_000)
      );
      assert.ok(outcome.restartFollowup);
      const restart = outcome.restartFollowup;
      assert.equal(restart.sameSession, true);
      assert.equal(restart.differentProcess, true);
      assert.equal(restart.restoredTranscript, true);
      assert.notEqual(restart.firstPid, restart.replacementPid);
      for (const run of [outcome, restart.outcome]) {
        assert.equal(
          run.runtimeProof?.presentationInventory?.exactIssuedSet,
          true
        );
        assert.equal(run.runtimeProof?.presentationInventory?.issuedCount, 1);
        assert.ok(
          (run.runtimeProof?.presentationInventory?.matchingSnapshots ?? 0) > 0
        );
        assert.equal(run.costUsd, 0);
        assert.equal(run.hostCapture.outboundMessages, 0);
        assert.equal(run.judge, null);
      }
      assert.ok(
        (restart.outcome.runtimeProof?.presentationInventory
          ?.matchingSnapshots ?? 0) >
          (outcome.runtimeProof?.presentationInventory?.matchingSnapshots ?? 0),
        "The replacement process must persist its own checkpoint with the issued inventory; the first process's old checkpoint is insufficient"
      );
      assert.equal(outcome.runtimeProof?.modelCalls, 4);
      const afterLoad = outcome.runtimeProof?.modelRequests?.[1];
      assert.ok(afterLoad, "The model must continue after loading tools");
      assert.ok(
        afterLoad.tools.includes("tasks_query"),
        "The step after load_tools must actually expose the direct task tool"
      );
      const taskSchema = afterLoad.toolSchemas?.find(
        (tool) => tool.name === "tasks_query"
      );
      assert.ok(
        taskSchema?.inputSchema && typeof taskSchema.inputSchema === "object",
        "The direct task tool must reach the provider with its schema"
      );
      assert.ok(outcome.hostCapture.freshAuthorizations > 0);
      assert.equal(outcome.hostCapture.refusedAuthorizations, 0);
      assert.deepEqual(
        outcome.hostCapture.calls.map((call) => ({
          id: call.id,
          name: call.name,
        })),
        [{ id: reference, name: "tasks.query" }]
      );
      assert.deepEqual(outcome.hostCapture.presented, [reference]);
      assert.equal(restart.outcome.runtimeProof?.modelCalls, 1);
      assert.equal(restart.outcome.hostCapture.calls.length, 0);
      assert.deepEqual(
        restart.outcome.runtimeProof?.modelRequests?.[0]?.presentation,
        {
          retiredChecked: 1,
          currentChecked: 0,
          factsChecked: 2,
          userTextPreserved: true,
        }
      );
      // Old UI history is retained; the provider projection does not rewrite it.
      assert.ok(
        JSON.stringify(restart.outcome.messages).includes(
          encodeURIComponent(reference)
        )
      );
      assert.equal(store.writesSince(before, manifest).length, 0);
    } finally {
      await stack.cleanup();
    }
  }
);
