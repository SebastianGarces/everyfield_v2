import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { test } from "node:test";
import { startFixtureStack } from "../src/lib/evry/eve/evals/fixtures/stack";
import { createFixtureStore } from "../src/lib/evry/eve/evals/fixtures/store";
import {
  createFixtureManifest,
  FIXTURE_NOW,
} from "../src/lib/evry/eve/evals/fixtures/manifest";
import { runCompiledEveFixture } from "../src/lib/evry/eve/evals/http/process";

test(
  "compiled initial routing supplies first-request schemas and authored guidance, with explicit replacement, new topics and unavailable fallback",
  {
    skip: process.env.EVRY_EVE_INITIAL_WORKING_SET_PROOF !== "1",
    timeout: 180_000,
  },
  async () => {
    const stack = await startFixtureStack(process.cwd());
    const store = createFixtureStore(stack.container);
    const manifest = createFixtureManifest("compiled-initial-working-set", 0);
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
            "Plan an orientation. api_key=fixture-private-value",
            "New topic: show my pending tasks.",
            "Set that aside and unload the tools.",
            "Back to orientation, then switch to task tools.",
            "Keep those tools for later.",
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
          routing: [
            { status: "available", probabilities: { "meeting-invite": 0.99 } },
            { status: "available", probabilities: { "daily-work": 0.99 } },
            { status: "unavailable", reason: "timeout" },
            { status: "available", probabilities: { "meeting-invite": 0.99 } },
            { status: "unavailable", reason: "provider_error" },
          ],
          model: {
            mode: "scripted",
            responses: [
              // Deliberately load an already-preloaded skill to leave realistic old
              // native load history for the next-topic regression.
              {
                toolCalls: [
                  {
                    id: "old-meeting-load",
                    name: "load_skill",
                    input: { skill: "meeting-invite" },
                  },
                ],
              },
              {
                toolCalls: [
                  {
                    id: "save-notes",
                    name: "draft_update",
                    input: {
                      expectedRevision: 0,
                      goal: "Plan orientation",
                      facts: [
                        {
                          key: "password",
                          value: "private-note-value",
                          source: "user",
                        },
                      ],
                    },
                  },
                ],
              },
              { text: "Meeting planning tools are available." },
              {
                toolCalls: [
                  {
                    id: "read-tasks-directly",
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
                      query: { mode: "list", limit: 2 },
                    },
                  },
                ],
              },
              { text: "Your task results are available." },
              {
                toolCalls: [
                  { id: "unload", name: "load_tools", input: { names: [] } },
                ],
              },
              { text: "Tools unloaded." },
              {
                toolCalls: [
                  {
                    id: "replace",
                    name: "load_tools",
                    input: { names: ["tasks.query"] },
                  },
                ],
              },
              { text: "Task tools selected." },
              { text: "Nothing has been changed." },
            ],
          },
        },
        AbortSignal.timeout(150_000)
      );
      const requests = outcome.runtimeProof?.modelRequests;
      assert.ok(requests);
      assert.equal(requests.length, 10);
      const skillHash = (name: string) =>
        createHash("sha256")
          .update(readFileSync(resolve("agent/skills", name, "SKILL.md")))
          .digest("hex");
      assert.deepEqual(requests[0].authoredSkills, [
        { name: "meeting-invite", sha256: skillHash("meeting-invite") },
      ]);
      assert.ok(requests[0].tools.includes("actions_prepare"));
      const schema = requests[0].toolSchemas?.find(
        (tool) => tool.name === "actions_prepare"
      )?.inputSchema;
      assert.ok(schema);
      assert.match(JSON.stringify(schema), /recipe\.meeting-invite/);
      assert.doesNotMatch(
        JSON.stringify(schema),
        /notifications\.mark_all_read|communication\.send/
      );
      assert.deepEqual(
        requests[1].authoredSkills,
        [],
        "A completed explicit load owns subsequent guidance"
      );
      assert.deepEqual(requests[3].authoredSkills, [
        { name: "daily-work", sha256: skillHash("daily-work") },
      ]);
      assert.ok(requests[3].tools.includes("tasks_query"));
      assert.equal(
        requests[3].tools.includes("actions_prepare"),
        false,
        "Old meeting history must not overwrite this topic"
      );
      assert.deepEqual(
        requests[5].authoredSkills,
        [],
        "Timeout does not leak previous-topic preloaded instructions"
      );
      assert.ok(
        requests[5].tools.includes("tasks_query"),
        "Optional routing failure preserves the usable working set"
      );
      assert.equal(
        requests[6].tools.includes("tasks_query"),
        false,
        "Explicit unload wins"
      );
      assert.ok(
        requests[7].tools.includes("actions_prepare"),
        "A later turn can select meeting preparation again"
      );
      for (const index of [8, 9]) {
        assert.ok(requests[index].tools.includes("tasks_query"));
        assert.equal(requests[index].tools.includes("actions_prepare"), false);
        assert.deepEqual(requests[index].authoredSkills, []);
      }
      assert.equal(
        outcome.routingRequests?.length,
        5,
        "Exactly one optional suggestion per turn"
      );
      const routing = JSON.stringify(outcome.routingRequests);
      for (const secret of [
        "fixture-private-value",
        "private-note-value",
        manifest.sessionToken,
        manifest.ids.actor,
        manifest.ids.plant,
      ])
        assert.ok(!routing.includes(secret));
      assert.ok(routing.includes("[redacted credential]"));
      assert.deepEqual(
        outcome.hostCapture.calls.map((call) => ({
          id: call.id,
          name: call.name,
        })),
        [{ id: "read-tasks-directly", name: "tasks.query" }]
      );
      assert.ok(outcome.hostCapture.freshAuthorizations > 0);
      assert.equal(outcome.hostCapture.refusedAuthorizations, 0);
      assert.equal(outcome.hostCapture.outboundMessages, 0);
      assert.deepEqual(store.writesSince(auditStart, manifest), []);
      assert.ok(
        outcome.replay?.matchingTranscript && outcome.replay.stableActivity
      );
      assert.ok(
        outcome.restart?.matchingTranscript &&
          outcome.restart.sameSession &&
          outcome.restart.differentProcess
      );
      assert.equal(outcome.restart?.modelCalls, 0);
      assert.equal(outcome.restart?.capturedCalls, 0);
      assert.equal(outcome.costUsd, 0);
    } finally {
      await stack.cleanup();
    }
  }
);
