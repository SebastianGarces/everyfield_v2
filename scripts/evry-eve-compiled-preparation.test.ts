import assert from "node:assert/strict";
import { test } from "node:test";
import { resolve } from "node:path";
import { projectEveMessage } from "@/components/evry/eve-message-projection";
import { startFixtureStack } from "@/lib/evry/eve/evals/fixtures/stack";
import { createFixtureStore } from "@/lib/evry/eve/evals/fixtures/store";
import {
  createFixtureManifest,
  FIXTURE_NOW,
} from "@/lib/evry/eve/evals/fixtures/manifest";
import { runCompiledEveFixture } from "@/lib/evry/eve/evals/http/process";

test(
  "compiled native preparation produces one real review card and no unconfirmed effects",
  { skip: process.env.EVRY_EVE_HTTP_PROOF !== "1", timeout: 180_000 },
  async () => {
    const stack = await startFixtureStack(process.cwd());
    const store = createFixtureStore(stack.container);
    const manifest = createFixtureManifest("compiled-preparation", 0);
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
                toolCalls: [
                  {
                    id: "fixture-show-review",
                    name: "present_result",
                    input: { reference: "fixture-prepare" },
                  },
                ],
              },
              {
                text: "Review the orientation and invitation below. Nothing has been sent.",
              },
            ],
          },
        },
        AbortSignal.timeout(120_000)
      );
      const visible = outcome.messages.flatMap(projectEveMessage);
      const confirmations = visible.filter(
        (part) =>
          part.kind === "artifact" && part.artifact.kind === "confirmation"
      );
      assert.equal(
        confirmations.length,
        1,
        "direct preparation and presentation must not duplicate the review"
      );
      const confirmation = confirmations[0];
      assert.ok(
        confirmation.kind === "artifact" &&
          confirmation.artifact.kind === "confirmation"
      );
      const rows = store.query(
        `select p.id, p.fingerprint, s.status from evry_action_plans p join evry_action_plan_states s on s.plan_id=p.id and s.church_id=p.church_id where p.church_id='${manifest.ids.plant}' and p.actor_user_id='${manifest.ids.actor}'`
      );
      assert.deepEqual(rows, [
        {
          id: confirmation.artifact.plan.planId,
          fingerprint: confirmation.artifact.plan.fingerprint,
          status: "awaiting_confirmation",
        },
      ]);
      assert.equal(store.writesSince(before, manifest).length, 0);
      assert.equal(outcome.hostCapture.outboundMessages, 0);
      assert.equal(outcome.costUsd, 0);
      assert.ok(outcome.replay);
      assert.equal(outcome.replay.matchingTranscript, true);
      assert.equal(outcome.replay.stableActivity, true);
      assert.equal(outcome.replay.stableCapture, true);
      assert.equal(outcome.replay.snapshots, 2);
      assert.equal(
        outcome.judge,
        null,
        "scripted runtime proof is not a model-quality evaluation"
      );
    } finally {
      await stack.cleanup();
    }
  }
);
