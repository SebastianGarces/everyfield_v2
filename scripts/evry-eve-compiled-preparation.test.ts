import assert from "node:assert/strict";
import { test } from "node:test";
import { resolve } from "node:path";
import { z } from "zod";
import { projectEveMessage } from "@/components/evry/eve-message-projection";
import { startFixtureStack } from "@/lib/evry/eve/evals/fixtures/stack";
import { createFixtureStore } from "@/lib/evry/eve/evals/fixtures/store";
import {
  createFixtureManifest,
  FIXTURE_NOW,
} from "@/lib/evry/eve/evals/fixtures/manifest";
import { runCompiledEveFixture } from "@/lib/evry/eve/evals/http/process";

for (const audience of [
  "named",
  "explicit",
  "missing-recovery",
  "foreign-recovery",
] as const)
  test(
    `compiled two-turn orientation (${audience} audience) keeps preparation context bounded and produces one unexecuted review`,
    { skip: process.env.EVRY_EVE_HTTP_PROOF !== "1", timeout: 180_000 },
    async () => {
      const stack = await startFixtureStack(process.cwd());
      const store = createFixtureStore(stack.container);
      const manifest = createFixtureManifest("compiled-preparation", 0);
      try {
        store.seed(manifest);
        const before = store.auditStart();
        const recovery = audience.endsWith("recovery");
        const invalidGuestId =
          audience === "foreign-recovery"
            ? manifest.ids["person-foreign"]
            : "00000000-0000-4000-8000-000000000099";
        const outcome = await runCompiledEveFixture(
          {
            compiledEntry: resolve(".output/server/index.mjs"),
            databaseUrl: stack.databaseUrl,
            proxyUrl: stack.proxyUrl,
            sessionToken: manifest.sessionToken,
            actor: { userId: manifest.ids.actor, plantId: manifest.ids.plant },
            turns: [
              "Prepare an orientation for the core team next Sunday at 10am at church.",
              "Two hours; use the saved location and invitation template.",
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
                { text: "How long should the orientation last?" },
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
                ...(recovery
                  ? [
                      {
                        toolCalls: [
                          {
                            id: "bad-guests",
                            name: "actions_prepare",
                            input: {
                              request: {
                                operation: "recipe.meeting-invite",
                                arguments: {
                                  meetingType: "orientation",
                                  title: "Core team orientation",
                                  dateTime: {
                                    date: "2026-09-27",
                                    time: "10:00",
                                  },
                                  durationMinutes: 120,
                                  guestPersonIds: [
                                    manifest.ids["core-alex"],
                                    invalidGuestId,
                                  ],
                                  locationId: manifest.ids["church-location"],
                                  subject: "Join us for {{meeting_title}}",
                                  body: "Hi {{first_name}}, join us on {{meeting_date}} at {{meeting_location}}.",
                                },
                              },
                            },
                          },
                        ],
                      },
                    ]
                  : []),
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
                            ...(audience === "named"
                              ? { audience: "core_team" }
                              : {
                                  guestPersonIds: [
                                    manifest.ids["core-alex"],
                                    manifest.ids["core-jordan"],
                                  ],
                                }),
                            locationId: manifest.ids["church-location"],
                            subject:
                              audience === "named"
                                ? "Join our orientation"
                                : "Join us for {{meeting_title}}",
                            body: "Hi {{first_name}}, join us on {{meeting_date}} at {{meeting_location}}.",
                          },
                        },
                      },
                    },
                  ],
                },
                {
                  text: "Review the orientation and invitation below.\n\n[[evry-result:fixture-prepare]]\n\nNothing has been sent.\n\n[[evry-result:fixture-prepare]]",
                },
              ],
            },
          },
          AbortSignal.timeout(120_000)
        );
        const visible = outcome.messages.flatMap(projectEveMessage);
        const preparationPart = outcome.messages
          .flatMap((message) => message.parts)
          .find(
            (part) =>
              part.type === "dynamic-tool" &&
              part.toolCallId === "fixture-prepare"
          );
        assert.ok(
          preparationPart?.type === "dynamic-tool" &&
            preparationPart.state === "output-available"
        );
        const modelSummary = z
          .object({
            data: z.strictObject({
              status: z.literal("awaiting_confirmation"),
              message: z.string(),
              review: z.json(),
            }),
          })
          .parse(preparationPart.output);
        assert.doesNotMatch(
          JSON.stringify(modelSummary.data),
          /resultReference|activePlan|fingerprint|contentPreviews/
        );
        const capturedPreparation = z
          .object({
            activePlan: z.object({ mode: z.literal("set"), plan: z.json() }),
            artifacts: z
              .array(
                z.object({ kind: z.literal("confirmation"), plan: z.json() })
              )
              .min(1),
          })
          .parse(
            outcome.hostCapture.calls.find(({ id }) => id === "fixture-prepare")
              ?.output
          );
        assert.deepEqual(
          capturedPreparation.artifacts[0]?.plan,
          capturedPreparation.activePlan.plan,
          "The private oracle retains the original exact preparation, not the model summary"
        );
        assert.equal(
          visible.some((part) => part.kind === "session-limit"),
          false
        );
        const requests = outcome.runtimeProof?.modelRequests;
        assert.ok(requests);
        assert.equal(requests.length, recovery ? 5 : 4);
        assert.equal(outcome.runtimeProof?.modelCalls, recovery ? 5 : 4);
        if (recovery) {
          const refused = outcome.hostCapture.calls.find(
            ({ id }) => id === "bad-guests"
          );
          assert.deepEqual(refused?.output, {
            status: "needs_resolution",
            reason: "unresolved_guests",
            body: "Some selected guests could not be found in the current church records. Refresh the people lookup and reuse the exact returned IDs, or use the named audience the user requested. Do not guess IDs or omit anyone. No meeting was created and nothing was sent.",
            artifacts: [],
          });
        }
        assert.equal(
          outcome.runtimeProof?.availableTools.includes("present_result"),
          false
        );
        for (const request of requests)
          assert.ok(
            request.inputBytes < 60_000,
            `Orientation context grew to ${request.inputBytes} bytes`
          );
        assert.ok(
          requests.reduce((sum, request) => sum + request.inputBytes, 0) <
            300_000
        );
        const confirmations = visible.filter(
          (part) =>
            part.kind === "artifact" && part.artifact.kind === "confirmation"
        );
        assert.equal(
          confirmations.length,
          1,
          "automatic preparation plus repeated result markers must render one review"
        );
        const confirmation = confirmations[0];
        assert.ok(
          confirmation.kind === "artifact" &&
            confirmation.artifact.kind === "confirmation"
        );
        assert.ok("steps" in confirmation.artifact);
        assert.deepEqual(
          confirmation.artifact.plan,
          capturedPreparation.activePlan.plan
        );
        assert.deepEqual(
          confirmation.artifact.steps
            .find((step) => step.audience?.kind === "guests")
            ?.audience?.people.map((person) => person.sourceLink?.href)
            .sort(),
          [manifest.ids["core-alex"], manifest.ids["core-jordan"]]
            .map((id) => `/people/${id}`)
            .sort()
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
