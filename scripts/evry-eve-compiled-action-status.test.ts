import assert from "node:assert/strict";
import { resolve } from "node:path";
import { test } from "node:test";
import { neonConfig } from "@neondatabase/serverless";
import { z } from "zod";
import { startFixtureStack } from "@/lib/evry/eve/evals/fixtures/stack";
import { createFixtureStore } from "@/lib/evry/eve/evals/fixtures/store";
import {
  createFixtureManifest,
  FIXTURE_NOW,
} from "@/lib/evry/eve/evals/fixtures/manifest";
import { runCompiledEveFixture } from "@/lib/evry/eve/evals/http/process";
import {
  compiledFixtureRequest,
  type CompiledFixtureRequest,
  httpEvalOutcomeSchema,
} from "@/lib/evry/eve/evals/http/process-contract";

type Outcome = z.output<typeof httpEvalOutcomeSchema>;
type Responses = Extract<
  CompiledFixtureRequest["model"],
  { mode: "scripted" }
>["responses"];
const preparedPlan = z.object({
  activePlan: z.object({
    mode: z.literal("set"),
    plan: z.object({
      planId: z.uuid(),
      fingerprint: z.string().regex(/^[a-f0-9]{64}$/),
    }),
  }),
});
const statusResponses: Responses = [
  {
    toolCalls: [
      {
        id: "status-load",
        name: "load_tools",
        input: { mode: "replace", names: ["actions.status"] },
      },
    ],
  },
  { toolCalls: [{ id: "status-read", name: "actions_status", input: {} }] },
  { text: "The status above is from the saved action." },
];
function prepareResponses(taskIds: string[], suffix: string): Responses {
  return [
    {
      toolCalls: [
        {
          id: `load-${suffix}`,
          name: "load_tools",
          input: {
            mode: "replace",
            names: ["actions.prepare"],
            preparationOperations: ["tasks.bulk.complete"],
          },
        },
      ],
    },
    {
      toolCalls: [
        {
          id: `prepare-${suffix}`,
          name: "actions_prepare",
          input: {
            request: {
              operation: "tasks.bulk.complete",
              arguments: { taskIds },
            },
          },
        },
      ],
    },
    { text: "Review these task completions. Nothing has changed yet." },
  ];
}

test("restart-followup hooks cannot run on live or GET-only fixture requests", async () => {
  let called = false;
  const base = {
    compiledEntry: "/private/tmp/not-started/index.mjs",
    databaseUrl: "postgres://fixture:fixture@localhost:5499/eve_fixture",
    proxyUrl: "http://127.0.0.1:4109",
    sessionToken: "fixture-only",
    actor: { userId: "fixture-user", plantId: "fixture-plant" },
    turns: ["Status"],
    now: FIXTURE_NOW.toISOString(),
    maxCostUsd: 1,
    prices: {
      inputUsdPerMillion: 1,
      outputUsdPerMillion: 2,
      maxInputBytes: 500_000,
      maxOutputTokens: 1_000,
    },
  };
  for (const request of [
    { ...base, model: { mode: "live", spendingApproved: true } },
    {
      ...base,
      model: { mode: "scripted", responses: [{ text: "Hello" }] },
      verifyRestart: true,
    },
  ]) {
    await assert.rejects(
      runCompiledEveFixture(
        compiledFixtureRequest.parse(request),
        AbortSignal.timeout(1_000),
        {
          beforeRestart: async () => {
            called = true;
          },
        }
      ),
      /Before-restart hook requires/
    );
  }
  assert.equal(called, false);
});

test(
  "replacement compiled status reads the current saved pending or completed action, never an earlier or foreign review",
  {
    skip: process.env.EVRY_EVE_HTTP_PROOF !== "1",
    timeout: 420_000,
  },
  async (t) => {
    const stack = await startFixtureStack(
      process.env.EVRY_FIXTURE_MIGRATIONS_ROOT ?? process.cwd()
    );
    const store = createFixtureStore(stack.container);
    const priorDatabase = process.env.DATABASE_URL;
    const priorResend = process.env.RESEND_API_KEY;
    const priorEndpoint = neonConfig.fetchEndpoint;
    const priorFetch = globalThis.fetch;
    let externalRequests = 0;
    try {
      // Only the exact production Next confirmation handler runs in this process.
      // Eve generation and saved-state restoration run in separate compiled children.
      process.env.DATABASE_URL = stack.databaseUrl;
      process.env.RESEND_API_KEY = "re_isolated_no_send";
      neonConfig.fetchEndpoint = stack.proxyUrl;
      globalThis.fetch = async (input, init) => {
        const url = new URL(
          typeof input === "string"
            ? input
            : input instanceof URL
              ? input.href
              : input.url
        );
        if (url.origin !== new URL(stack.proxyUrl).origin) {
          externalRequests++;
          throw new Error("External request forbidden in restart status proof");
        }
        return priorFetch(input, init);
      };
      const { withAuthenticatedSessionId } =
        await import("@/lib/auth/session-scope");
      const routes = await import("@/app/api/evry/eve/plans/[planId]/route");
      const lifecycleTables = [
        "evry_action_plans",
        "evry_action_plan_states",
        "evry_plan_confirmations",
        "evry_product_audit_events",
        "evry_execution_attempts",
        "evry_execution_effect_claims",
        "evry_execution_outcomes",
      ];
      const lifecycleSnapshot = () =>
        store.query(
          lifecycleTables
            .map(
              (table) =>
                `select '${table}' as name,md5(coalesce(string_agg(to_jsonb(t)::text,'|' order by to_jsonb(t)::text),'')) as digest from ${table} t`
            )
            .join(" union all ")
        );
      const requestFor = (
        manifest: ReturnType<typeof createFixtureManifest>,
        turns: string[],
        responses: Responses
      ): CompiledFixtureRequest => ({
        compiledEntry: resolve(
          process.env.EVRY_COMPILED_ENTRY ?? ".output/server/index.mjs"
        ),
        databaseUrl: stack.databaseUrl,
        proxyUrl: stack.proxyUrl,
        sessionToken: manifest.sessionToken,
        actor: { userId: manifest.ids.actor, plantId: manifest.ids.plant },
        turns,
        now: FIXTURE_NOW.toISOString(),
        maxCostUsd: 1,
        prices: {
          inputUsdPerMillion: 1,
          outputUsdPerMillion: 2,
          maxInputBytes: 500_000,
          maxOutputTokens: 1_000,
        },
        model: { mode: "scripted", responses },
      });
      const foreign = createFixtureManifest("restart-status-foreign", 0);
      store.seed(foreign);
      const foreignAudit = store.auditStart();
      const foreignOutcome = await runCompiledEveFixture(
        requestFor(
          foreign,
          ["Prepare this task completion."],
          prepareResponses([foreign.ids["task-today"]], "foreign")
        ),
        AbortSignal.timeout(120_000)
      );
      const foreignCall = foreignOutcome.hostCapture.calls.find(
        (call) => call.name === "actions.prepare"
      );
      const foreignPlan = preparedPlan.parse(foreignCall?.output).activePlan
        .plan;
      assert.deepEqual(store.writesSince(foreignAudit, foreign), []);
      assert.equal(foreignOutcome.hostCapture.outboundMessages, 0);

      let lastManifest: ReturnType<typeof createFixtureManifest> | undefined;
      for (const confirm of [false, true])
        await t.test(
          confirm
            ? "actual confirmation remains completed after restart"
            : "pending review survives restart",
          async () => {
            const manifest = createFixtureManifest(
              `restart-status-${confirm ? "completed" : "pending"}`,
              0
            );
            lastManifest = manifest;
            store.seed(manifest);
            const auditStart = store.auditStart();
            let boundaryAudit: ReturnType<typeof store.auditStart> | undefined;
            let boundaryLifecycle:
              | ReturnType<typeof lifecycleSnapshot>
              | undefined;
            let currentPlan:
              | z.infer<typeof preparedPlan>["activePlan"]["plan"]
              | undefined;
            let earlierPlan: typeof currentPlan;
            const outcome = await runCompiledEveFixture(
              {
                ...requestFor(
                  manifest,
                  [
                    "Prepare completing my first task.",
                    "Replace that review with both selected tasks.",
                  ],
                  [
                    ...prepareResponses(
                      [manifest.ids["task-overdue"]],
                      "earlier"
                    ),
                    ...prepareResponses(
                      [
                        manifest.ids["task-today"],
                        manifest.ids["task-tomorrow"],
                      ],
                      "current"
                    ),
                  ]
                ),
                restartFollowup: {
                  turn: "What is the status of that action?",
                  responses: statusResponses,
                },
              },
              AbortSignal.timeout(180_000),
              {
                beforeRestart: async (first) => {
                  const calls = first.hostCapture.calls.filter(
                    (call) => call.name === "actions.prepare"
                  );
                  assert.equal(calls.length, 2);
                  earlierPlan = preparedPlan.parse(calls[0]!.output).activePlan
                    .plan;
                  currentPlan = preparedPlan.parse(calls[1]!.output).activePlan
                    .plan;
                  assert.notEqual(currentPlan.planId, earlierPlan.planId);
                  assert.deepEqual(
                    store.writesSince(auditStart, manifest),
                    [],
                    "preparation cannot execute tasks"
                  );
                  if (confirm) {
                    const exact = currentPlan;
                    const response = await withAuthenticatedSessionId(
                      manifest.sessionId,
                      () =>
                        routes.POST(
                          new Request(
                            `http://status-fixture.test/api/evry/eve/plans/${exact.planId}`,
                            {
                              method: "POST",
                              headers: {
                                origin: "http://status-fixture.test",
                                cookie: `session=${manifest.sessionToken}`,
                                "content-type": "application/json",
                              },
                              body: JSON.stringify({
                                action: "confirm",
                                fingerprint: exact.fingerprint,
                              }),
                            }
                          ),
                          { params: Promise.resolve({ planId: exact.planId }) }
                        )
                    );
                    assert.equal(
                      response.status,
                      200,
                      JSON.stringify(await response.clone().json())
                    );
                    z.object({
                      plan: z.object({ status: z.literal("completed") }),
                      artifact: z.object({ kind: z.literal("result") }),
                    }).parse(await response.json());
                    assert.ok(
                      store.writesSince(auditStart, manifest).length > 0,
                      "the production route must actually execute the confirmed tasks"
                    );
                  }
                  boundaryAudit = store.auditStart();
                  boundaryLifecycle = lifecycleSnapshot();
                },
              }
            );
            assert.ok(
              currentPlan &&
                earlierPlan &&
                boundaryAudit !== undefined &&
                boundaryLifecycle
            );
            const status = assertRestart(outcome);
            const available = z
              .object({
                status: z.literal("available"),
                lifecycle: z.literal(
                  confirm ? "completed" : "awaiting_confirmation"
                ),
                evidence: z.literal(confirm ? "result" : "confirmation"),
                scope: z.literal("current_conversation_review"),
              })
              .parse(status);
            assert.equal(available.status, "available");
            if (confirm) {
              const completed = z
                .object({
                  steps: z
                    .array(
                      z.object({
                        status: z.literal("completed"),
                        recordedAffectedCount: z.number(),
                      })
                    )
                    .min(1),
                })
                .parse(status);
              assert.equal(
                completed.steps.reduce(
                  (sum, step) => sum + step.recordedAffectedCount,
                  0
                ),
                2
              );
            } else {
              const pending = z
                .object({
                  plannedSteps: z
                    .array(
                      z.object({
                        counts: z.array(z.object({ count: z.number() })),
                      })
                    )
                    .min(1),
                })
                .parse(status);
              assert.ok(
                pending.plannedSteps.some((step) =>
                  step.counts.some(({ count }) => count === 2)
                ),
                "two planned tasks distinguish current review from earlier one-task review"
              );
            }
            assert.deepEqual(
              store
                .query(
                  `select plan_id,status from evry_action_plan_states where plan_id in ('${earlierPlan.planId}','${currentPlan.planId}') order by plan_id`
                )
                .map(({ status }) => status)
                .sort(),
              [
                "cancelled",
                confirm ? "completed" : "awaiting_confirmation",
              ].sort()
            );
            assert.deepEqual(
              store.query(
                `select id,status from tasks where id in ('${manifest.ids["task-overdue"]}','${manifest.ids["task-today"]}','${manifest.ids["task-tomorrow"]}') order by id`
              ),
              [
                { id: manifest.ids["task-overdue"], status: "not_started" },
                {
                  id: manifest.ids["task-today"],
                  status: confirm ? "complete" : "not_started",
                },
                {
                  id: manifest.ids["task-tomorrow"],
                  status: confirm ? "complete" : "not_started",
                },
              ].sort((a, b) => a.id.localeCompare(b.id))
            );
            assert.deepEqual(
              store.writesSince(boundaryAudit, manifest),
              [],
              "restored status must not execute or recover work"
            );
            assert.deepEqual(
              lifecycleSnapshot(),
              boundaryLifecycle,
              "status is read-only across lifecycle and execution journals"
            );
            for (const privateId of [
              foreignPlan.planId,
              currentPlan.planId,
              earlierPlan.planId,
            ])
              assert.equal(JSON.stringify(status).includes(privateId), false);
            assert.equal(
              store.query(
                `select count(*)::int as count from evry_eve_sessions where church_id='${manifest.ids.plant}'`
              )[0]?.count,
              1,
              "replacement attaches without creating another conversation"
            );
          }
        );
      assert.ok(lastManifest);
      await t.test(
        "a saved conversation without a current review never falls back to existing own or foreign plans",
        async () => {
          const manifest = lastManifest!;
          const before = store.auditStart();
          const lifecycle = lifecycleSnapshot();
          const empty = await runCompiledEveFixture(
            {
              ...requestFor(manifest, ["Hello"], [{ text: "Hello." }]),
              restartFollowup: {
                turn: "What is the status of that action?",
                responses: statusResponses,
              },
            },
            AbortSignal.timeout(120_000)
          );
          assert.deepEqual(assertRestart(empty), { status: "unavailable" });
          assert.deepEqual(store.writesSince(before, manifest), []);
          assert.deepEqual(lifecycleSnapshot(), lifecycle);
          assert.equal(
            store.query(
              `select count(*)::int as count from evry_eve_sessions where church_id='${manifest.ids.plant}'`
            )[0]?.count,
            2
          );
        }
      );
      assert.equal(externalRequests, 0);
    } finally {
      globalThis.fetch = priorFetch;
      neonConfig.fetchEndpoint = priorEndpoint;
      if (priorDatabase === undefined) delete process.env.DATABASE_URL;
      else process.env.DATABASE_URL = priorDatabase;
      if (priorResend === undefined) delete process.env.RESEND_API_KEY;
      else process.env.RESEND_API_KEY = priorResend;
      await stack.cleanup();
    }
  }
);

function assertRestart(outcome: Outcome) {
  const restart = outcome.restartFollowup;
  assert.ok(restart);
  assert.equal(restart.sameSession, true);
  assert.equal(restart.differentProcess, true);
  assert.notEqual(restart.firstPid, restart.replacementPid);
  assert.equal(restart.restoredTranscript, true);
  const restored = restart.outcome.followupRestore;
  assert.ok(restored);
  assert.deepEqual(restored.messages, outcome.messages);
  assert.deepEqual(
    {
      generations: restored.generations,
      invocations: restored.invocations,
      capturedCalls: restored.capturedCalls,
    },
    { generations: 0, invocations: 0, capturedCalls: 0 }
  );
  assert.equal(restart.outcome.runtimeProof?.modelCalls, 3);
  assert.deepEqual(
    restart.outcome.hostCapture.calls.map((call) => call.name),
    ["actions.status"]
  );
  assert.equal(restart.outcome.hostCapture.freshAuthorizations, 1);
  assert.equal(restart.outcome.hostCapture.refusedAuthorizations, 0);
  assert.equal(restart.outcome.hostCapture.outboundMessages, 0);
  assert.equal(outcome.hostCapture.outboundMessages, 0);
  assert.equal(
    restart.outcome.judge,
    null,
    "scripted persistence is not model-quality evidence"
  );
  const output = restart.outcome.hostCapture.calls[0]!.output;
  assert.doesNotMatch(
    JSON.stringify(output),
    /fingerprint|planId|actorUserId|recipients|contentPreviews|resolvedTargets|sourceLinks/
  );
  return output;
}
