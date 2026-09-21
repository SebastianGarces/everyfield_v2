import assert from "node:assert/strict";
import { test } from "node:test";
import { resolve } from "node:path";
import { z } from "zod";
import { startFixtureStack } from "@/lib/evry/eve/evals/fixtures/stack";
import { createFixtureStore } from "@/lib/evry/eve/evals/fixtures/store";
import {
  createFixtureManifest,
  FIXTURE_NOW,
} from "@/lib/evry/eve/evals/fixtures/manifest";
import { runCompiledEveFixture } from "@/lib/evry/eve/evals/http/process";

test(
  "a replacement compiled server restores the exact pending review without repeating model, tool or domain work",
  { skip: process.env.EVRY_EVE_HTTP_PROOF !== "1", timeout: 180_000 },
  async () => {
    const stack = await startFixtureStack(
      process.env.EVRY_FIXTURE_MIGRATIONS_ROOT ?? process.cwd()
    );
    const store = createFixtureStore(stack.container);
    const manifest = createFixtureManifest("compiled-restart-review", 0);
    try {
      store.seed(manifest);
      const before = store.auditStart();
      const outcome = await runCompiledEveFixture(
        {
          compiledEntry: resolve(".output/server/index.mjs"),
          databaseUrl: stack.databaseUrl,
          proxyUrl: stack.proxyUrl,
          sessionToken: manifest.sessionToken,
          actor: { userId: manifest.ids.actor, plantId: manifest.ids.plant },
          turns: [
            "Prepare an orientation for the core team next Sunday at 10am at church. Two hours; use the saved invitation template.",
          ],
          now: FIXTURE_NOW.toISOString(),
          maxCostUsd: 1,
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
              {
                toolCalls: [
                  {
                    id: "load-preparation",
                    name: "load_tools",
                    input: {
                      names: ["actions.prepare"],
                      preparationOperations: ["recipe.meeting-invite"],
                    },
                  },
                ],
              },
              {
                toolCalls: [
                  {
                    id: "fixture-prepare",
                    name: "actions_prepare",
                    input: {
                      request: {
                        operation: "recipe.meeting-invite",
                        arguments: {
                          meetingType: "orientation",
                          title: "Core team orientation",
                          dateTime: { date: "2026-09-27", time: "10:00" },
                          durationMinutes: 120,
                          audience: "core_team",
                          locationId: manifest.ids["church-location"],
                          subject: "Join our orientation",
                          body: "Hi {{first_name}}, join us on {{meeting_date}} at {{meeting_location}}.",
                        },
                      },
                    },
                  },
                ],
              },
              {
                text: "Review the orientation and invitation below.\n\n[[evry-result:fixture-prepare]]\n\nNothing has been sent.",
              },
            ],
          },
        },
        AbortSignal.timeout(120_000)
      );
      assert.equal(outcome.runtimeProof?.modelCalls, 3);
      assert.equal(
        outcome.runtimeProof?.availableTools.includes("present_result"),
        false
      );
      assert.ok(outcome.restart);
      const { firstPid, replacementPid, ...restart } = outcome.restart;
      assert.ok(firstPid > 0);
      assert.ok(replacementPid > 0);
      assert.notEqual(firstPid, replacementPid);
      assert.deepEqual(restart, {
        matchingTranscript: true,
        sameSession: true,
        differentProcess: true,
        modelCalls: 0,
        generations: 0,
        invocations: 0,
        outboundMessages: 0,
        capturedCalls: 0,
      });
      const prepared = outcome.hostCapture.calls.find(
        (call) => call.name === "actions.prepare"
      );
      assert.ok(prepared, "the first process must prepare a real plan");
      const { artifacts } = z
        .object({
          artifacts: z
            .array(
              z.object({
                kind: z.literal("confirmation"),
                plan: z.object({
                  planId: z.string().uuid(),
                  fingerprint: z.string(),
                }),
              })
            )
            .length(1),
        })
        .parse(prepared.output);
      const plan = artifacts[0]!.plan;
      assert.deepEqual(
        store.query(
          `select p.id, p.fingerprint, s.status from evry_action_plans p join evry_action_plan_states s on s.plan_id=p.id and s.church_id=p.church_id where p.church_id='${manifest.ids.plant}' and p.actor_user_id='${manifest.ids.actor}'`
        ),
        [
          {
            id: plan.planId,
            fingerprint: plan.fingerprint,
            status: "awaiting_confirmation",
          },
        ]
      );
      const reviewParts = outcome.messages
        .flatMap((message) => message.parts)
        .filter(
          (part) =>
            part.type === "dynamic-tool" &&
            part.toolName === "actions_prepare" &&
            part.state === "output-available"
        );
      assert.equal(
        reviewParts.length,
        1,
        "the retained transcript includes the native preparation output"
      );
      assert.equal(store.writesSince(before, manifest).length, 0);
      assert.equal(outcome.hostCapture.outboundMessages, 0);
      assert.equal(outcome.costUsd, 0);
      assert.equal(
        outcome.judge,
        null,
        "scripted persistence is not model-quality evidence"
      );
    } finally {
      await stack.cleanup();
    }
  }
);
