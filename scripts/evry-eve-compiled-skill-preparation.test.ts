import assert from "node:assert/strict";
import { test } from "node:test";
import { resolve } from "node:path";
import { z } from "zod";
import { startFixtureStack } from "../src/lib/evry/eve/evals/fixtures/stack";
import { createFixtureStore } from "../src/lib/evry/eve/evals/fixtures/store";
import {
  createFixtureManifest,
  FIXTURE_NOW,
} from "../src/lib/evry/eve/evals/fixtures/manifest";
import { runCompiledEveFixture } from "../src/lib/evry/eve/evals/http/process";

function preparationOperations(
  schema: z.infer<ReturnType<typeof z.json>>
): string[] {
  if (!schema || typeof schema !== "object") return [];
  if (Array.isArray(schema)) return schema.flatMap(preparationOperations);
  const literal = z
    .object({
      properties: z.object({ operation: z.object({ const: z.string() }) }),
    })
    .safeParse(schema);
  return [
    ...(literal.success ? [literal.data.properties.operation.const] : []),
    ...Object.values(schema).flatMap(preparationOperations),
  ];
}

test(
  "compiled skill loading immediately exposes only its preparation, with explicit replacement and saved-session replay",
  {
    skip: process.env.EVRY_EVE_SKILL_PREPARATION_PROOF !== "1",
    timeout: 180_000,
  },
  async () => {
    const stack = await startFixtureStack(
      process.env.EVRY_FIXTURE_MIGRATIONS_ROOT ?? process.cwd()
    );
    const store = createFixtureStore(stack.container);
    const manifest = createFixtureManifest("compiled-skill-preparation", 0);
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
            "Prepare a two-hour core-team orientation for September 27, 2026 at 10am at the saved Church location. Do not send anything.",
            "Switch the working set to tasks.",
            "Return to meeting planning.",
            "Keep the review for me to inspect.",
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
              {
                toolCalls: [
                  {
                    id: "load-meeting",
                    name: "load_skill",
                    input: { skill: "meeting-invite" },
                  },
                ],
              },
              // A valid operation from the full registry must still fail this narrowed tool schema.
              {
                toolCalls: [
                  {
                    id: "unselected-operation",
                    name: "actions_prepare",
                    input: {
                      request: {
                        operation: "notifications.mark_all_read",
                        arguments: {},
                      },
                    },
                  },
                ],
              },
              {
                toolCalls: [
                  {
                    id: "prepare-directly",
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
                          subject: "Join us for {{meeting_title}}",
                          body: "Hi {{first_name}}, join us on {{meeting_date}} at {{meeting_location}}.",
                        },
                      },
                    },
                  },
                ],
              },
              { text: "The review is ready. Nothing has been sent." },
              {
                toolCalls: [
                  { id: "unload", name: "load_tools", input: { names: [] } },
                ],
              },
              {
                toolCalls: [
                  {
                    id: "replace",
                    name: "load_tools",
                    input: { names: ["tasks.query"] },
                  },
                ],
              },
              { text: "Task tools are available." },
              {
                toolCalls: [
                  {
                    id: "reload-meeting",
                    name: "load_skill",
                    input: { skill: "meeting-invite" },
                  },
                ],
              },
              { text: "The meeting review remains available." },
              { text: "Nothing has been sent." },
            ],
          },
        },
        AbortSignal.timeout(150_000)
      );
      const requests = outcome.runtimeProof?.modelRequests;
      assert.ok(requests);
      assert.equal(requests.length, 10);
      assert.equal(requests[0]?.tools.includes("actions_prepare"), false);
      for (const index of [1, 2, 3, 4, 8, 9]) {
        assert.ok(
          requests[index]?.tools.includes("actions_prepare"),
          `Missing preparation in model request ${index}`
        );
      }
      for (const index of [5, 6, 7])
        assert.equal(requests[index]?.tools.includes("actions_prepare"), false);
      assert.ok(requests[6]?.tools.includes("tasks_query"));
      assert.equal(requests[8]?.tools.includes("tasks_query"), false);
      const preparationSchema = requests[1]?.toolSchemas?.find(
        (tool) => tool.name === "actions_prepare"
      )?.inputSchema;
      assert.ok(
        preparationSchema,
        "Inspect the schema sent on the very next request after load_skill"
      );
      assert.deepEqual(preparationOperations(preparationSchema), [
        "recipe.meeting-invite",
      ]);
      // Eve omits invalid calls from runtime-action/UI projection. The provider's
      // next request must still receive the native schema-validation error.
      const invalidCall = requests[2]?.toolErrors?.find(
        (result) => result.id === "unselected-operation"
      );
      assert.ok(invalidCall, JSON.stringify(requests[2]?.toolErrors));
      assert.equal(invalidCall.name, "actions_prepare");
      assert.match(
        JSON.stringify(invalidCall.output),
        /notifications\.mark_all_read/
      );
      assert.match(
        JSON.stringify(invalidCall.output),
        /recipe\.meeting-invite/
      );
      assert.equal(
        outcome.hostCapture.calls.some(
          (call) => call.id === "unselected-operation"
        ),
        false,
        "Unselected operation must not reach the preparation registry"
      );
      const prepared = outcome.hostCapture.calls.find(
        (call) => call.id === "prepare-directly"
      );
      assert.ok(
        prepared,
        "The actual production preparation must be callable without load_tools"
      );
      assert.equal(prepared.name, "actions.prepare");
      assert.ok(
        z
          .object({ activePlan: z.object({ mode: z.literal("set") }) })
          .safeParse(prepared.output).success,
        JSON.stringify(prepared.output)
      );
      assert.deepEqual(
        outcome.hostCapture.calls.map((call) => call.name),
        ["actions.prepare"]
      );
      const preparedPlan = z
        .object({
          activePlan: z.object({
            plan: z.object({
              planId: z.uuid(),
              fingerprint: z.string().regex(/^[a-f0-9]{64}$/),
            }),
          }),
        })
        .parse(prepared.output).activePlan.plan;
      assert.deepEqual(
        store.query(
          `select p.church_id, p.actor_user_id, p.fingerprint, s.status from evry_action_plans p join evry_action_plan_states s on s.plan_id=p.id where p.id='${preparedPlan.planId}'`
        ),
        [
          {
            church_id: manifest.ids.plant,
            actor_user_id: manifest.ids.actor,
            fingerprint: preparedPlan.fingerprint,
            status: "awaiting_confirmation",
          },
        ]
      );
      assert.deepEqual(
        store.query(
          `select id from evry_plan_confirmations where plan_id='${preparedPlan.planId}'`
        ),
        []
      );
      assert.equal(outcome.hostCapture.refusedAuthorizations, 0);
      assert.equal(outcome.hostCapture.outboundMessages, 0);
      assert.deepEqual(
        store.writesSince(auditStart, manifest),
        [],
        "Review preparation must not create a meeting or send invitations"
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
