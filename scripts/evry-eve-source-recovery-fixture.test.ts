import assert from "node:assert/strict";
import { test } from "node:test";
import { z } from "zod";
import { neonConfig } from "@neondatabase/serverless";
import { questions } from "@/lib/evry/eve/evals/catalog";
import { createFixtureManifest } from "@/lib/evry/eve/evals/fixtures/manifest";
import { startFixtureStack } from "@/lib/evry/eve/evals/fixtures/stack";
import { createFixtureStore } from "@/lib/evry/eve/evals/fixtures/store";
import {
  capturedReadArtifactSchema,
  type CapturedCall,
} from "@/lib/evry/eve/evals/fixtures/host-capture";
import {
  createCompositionBudget,
  runEvryComposition,
  type CompositionTrace,
} from "@/lib/evry/eve/composition/runner";
import {
  bindSourceRecoveryTurns,
  createSourceRecoveryFault,
  observedSourceRecoveryFacts,
  seedSourceRecoveryFixture,
  sourceRecoveryExpectations,
  sourceRecoveryTruth,
} from "@/lib/evry/eve/evals/fixtures/source-recovery";

const taskInput = {
  where: {
    all: [
      {
        assignment: { kind: "mine" },
        status: ["not_started", "in_progress", "blocked"],
      },
    ],
  },
  query: { mode: "list", limit: 50 },
};
const meetingInput = {
  where: {
    all: [
      {
        timing: "upcoming",
        statuses: ["planning", "ready", "in_progress", "completed"],
      },
    ],
  },
  query: { mode: "list", limit: 50 },
};
const settledShape = z.array(
  z.discriminatedUnion("status", [
    z.object({ status: z.literal("fulfilled"), value: z.unknown() }),
    z.object({ status: z.literal("rejected"), reason: z.string() }),
  ])
);

test(
  "edges-13 real readers retain tasks across a scoped meeting dependency fault and safe retry",
  {
    skip: process.env.EVRY_EVE_SOURCE_RECOVERY_PROOF !== "1",
    timeout: 180_000,
  },
  async (t) => {
    const stack = await startFixtureStack(process.cwd());
    const previous = {
      database: process.env.DATABASE_URL,
      resend: process.env.RESEND_API_KEY,
      endpoint: neonConfig.fetchEndpoint,
      fetch: globalThis.fetch,
    };
    let external = 0;
    try {
      process.env.DATABASE_URL = stack.databaseUrl;
      process.env.RESEND_API_KEY = "re_isolated_no_send";
      neonConfig.fetchEndpoint = stack.proxyUrl;
      const proxyFetch: typeof fetch = async (input, init) => {
        const url = new URL(
          input instanceof Request ? input.url : String(input)
        );
        if (url.origin !== new URL(stack.proxyUrl).origin) {
          external++;
          throw new Error(
            "External requests forbidden in source recovery proof"
          );
        }
        return previous.fetch(input, init);
      };
      globalThis.fetch = proxyFetch;
      const [
        { createEveToolRegistry },
        { requireEvryPlantViewerForSession },
        { authorizeEvryReadCapabilityForSession },
        { withAuthenticatedSessionId },
      ] = await Promise.all([
        import("@/lib/evry/eve/capabilities/registry"),
        import("@/lib/evry/eligibility/viewer"),
        import("@/lib/evry/eligibility/capabilities"),
        import("@/lib/auth/session-scope"),
      ]);
      const store = createFixtureStore(stack.container),
        m = createFixtureManifest("edges-13", 450);
      store.seed(m);
      seedSourceRecoveryFixture(m, store);
      const truth = sourceRecoveryTruth(m, store),
        expected = sourceRecoveryExpectations(m, store);
      assert.ok(expected);
      assert.equal(truth.taskIds.length, 4);
      assert.equal(truth.meetingIds.length, 1);
      const scenario = questions.find((q) => q.id === m.caseId)!;
      assert.equal(
        bindSourceRecoveryTurns(scenario.turns)[1],
        scenario.turns[0]
      );
      const actor = await requireEvryPlantViewerForSession(m.sessionId);
      const before = store.auditStart();
      let freshAuthorizations = 0;
      const registry = createEveToolRegistry({
        context: {
          actor,
          now: new Date(m.now),
          literalUserText: bindSourceRecoveryTurns(scenario.turns)[0]!,
          pageContext: null,
        },
        async authorizeRead(name) {
          freshAuthorizations++;
          return authorizeEvryReadCapabilityForSession(name, m.sessionId);
        },
      });
      const calls: CapturedCall[] = [];
      const capturedRegistry = {
        describe: registry.describe,
        async invoke(
          name: string,
          input: unknown,
          invocation: { callId: string; signal?: AbortSignal }
        ) {
          const output = await registry.invoke(name, input, invocation);
          calls.push({ id: invocation.callId, name, input, output });
          return output;
        },
      };
      await withAuthenticatedSessionId(m.sessionId, async () => {
        await t.test(
          "healthy meeting reader actually returns nonempty independent SQL truth",
          async () => {
            const healthy = capturedReadArtifactSchema.parse(
              await registry.invoke("meetings.query", meetingInput, {
                callId: "healthy",
              })
            );
            assert.deepEqual(
              healthy.items.map((r) => r.id).sort(),
              truth.meetingIds
            );
          }
        );
        const fault = createSourceRecoveryFault({
          proxyUrl: stack.proxyUrl,
          plantId: m.ids.plant,
          fetch: proxyFetch,
        });
        globalThis.fetch = fault.fetch;
        await t.test(
          "actual sandbox allSettled retains successful reads and genuine sanitized rejection",
          async () => {
            const traces: CompositionTrace[] = [];
            const result = await runEvryComposition({
              registry: capturedRegistry,
              callId: "partial-source",
              budget: createCompositionBudget(),
              js: `const results = await Promise.allSettled([tools['tasks.query'](${JSON.stringify(taskInput)}), tools['meetings.query'](${JSON.stringify(meetingInput)})]); return results.map(r => r.status === 'fulfilled' ? r : {status:r.status,reason:r.reason.message});`,
              onCall: (event) => traces.push(event),
            });
            assert.equal(result.status, "completed");
            if (result.status !== "completed")
              assert.fail(JSON.stringify(result));
            const settled = settledShape.parse(result.output);
            assert.equal(settled[0]?.status, "fulfilled");
            assert.equal(settled[1]?.status, "rejected");
            assert.deepEqual(settled[1], {
              status: "rejected",
              reason: "Host tool failed.",
            });
            assert.ok(
              !JSON.stringify(result).includes("Isolated meeting dependency"),
              "Database exception text must not cross the composition boundary"
            );
            assert.equal(fault.receipts.length, 1);
            assert.equal(
              calls.filter((c) => c.name === "meetings.query").length,
              0,
              "A failed dependency must not be fabricated as an empty read"
            );
            assert.equal(
              traces.filter(
                (e) => e.name === "meetings.query" && e.status === "failed"
              ).length,
              1
            );
            assert.equal(
              traces.filter(
                (e) => e.name === "tasks.query" && e.status === "succeeded"
              ).length,
              1
            );
            assert.deepEqual(
              observedSourceRecoveryFacts(m, calls, fault.receipts).facts,
              expected.facts
            );
            assert.deepEqual(
              observedSourceRecoveryFacts(
                m,
                calls,
                fault.receipts
              ).evidence.sort(),
              [...expected.requiredEvidence].sort()
            );
          }
        );
        await t.test(
          "recovery original question needs no destructive action or loss of retained tasks",
          async () => {
            // This is retained host evidence, not a generated assistant answer. Live
            // wording/clarification quality requires its own metered model review.
            assert.deepEqual(
              observedSourceRecoveryFacts(m, calls, fault.receipts).facts
                .taskIds,
              truth.taskIds
            );
            assert.deepEqual(store.writesSince(before, m), []);
            const retry = capturedReadArtifactSchema.parse(
              await capturedRegistry.invoke("meetings.query", meetingInput, {
                callId: "safe-retry",
              })
            );
            assert.deepEqual(
              retry.items.map((r) => r.id).sort(),
              truth.meetingIds
            );
            assert.deepEqual(
              observedSourceRecoveryFacts(m, calls, fault.receipts).facts,
              expected.facts
            );
            assert.equal(fault.receipts.length, 1);
            assert.ok(fault.attempts >= 2);
          }
        );
        await t.test(
          "wrong plausible task cohorts fail independent exact IDs while source evidence stays real",
          async () => {
            for (const [name, input] of [
              [
                "all-owners",
                {
                  where: {
                    all: [
                      { status: ["not_started", "in_progress", "blocked"] },
                    ],
                  },
                  query: { mode: "list", limit: 50 },
                },
              ],
              [
                "includes-completed",
                {
                  where: { all: [{ assignment: { kind: "mine" } }] },
                  query: { mode: "list", limit: 50 },
                },
              ],
              ["partial", { ...taskInput, query: { mode: "list", limit: 1 } }],
            ] as const) {
              const wrong = await registry.invoke("tasks.query", input, {
                callId: name,
              });
              const observed = observedSourceRecoveryFacts(
                m,
                [{ id: name, name: "tasks.query", input, output: wrong }],
                fault.receipts
              );
              assert.notDeepEqual(observed.facts.taskIds, truth.taskIds, name);
            }
          }
        );
        fault.disable();
        globalThis.fetch = proxyFetch;
        assert.deepEqual(store.writesSince(before, m), []);
        assert.ok(freshAuthorizations >= 7);
        assert.equal(external, 0);
      });
      await t.test(
        "compiled two-turn runtime returns only genuine worker receipts and retained successful calls",
        { skip: !process.env.EVRY_EVE_COMPILED_ENTRY },
        async () => {
          const { runCompiledEveFixture } =
            await import("@/lib/evry/eve/evals/http/process");
          const compiled = createFixtureManifest("edges-13", 451);
          store.seed(compiled);
          seedSourceRecoveryFixture(compiled, store);
          const expectation = sourceRecoveryExpectations(compiled, store);
          assert.ok(expectation);
          const audit = store.auditStart();
          const outcome = await runCompiledEveFixture(
            {
              compiledEntry: process.env.EVRY_EVE_COMPILED_ENTRY!,
              databaseUrl: stack.databaseUrl,
              proxyUrl: stack.proxyUrl,
              sessionToken: compiled.sessionToken,
              actor: {
                userId: compiled.ids.actor,
                plantId: compiled.ids.plant,
              },
              turns: bindSourceRecoveryTurns(scenario.turns),
              sourceRecovery: "edges-13",
              now: compiled.now,
              maxCostUsd: 1,
              timeoutMs: 120_000,
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
                        id: "load-source-readers",
                        name: "load_tools",
                        input: { names: ["tasks.query", "meetings.query"] },
                      },
                    ],
                  },
                  {
                    toolCalls: [
                      {
                        id: "source-pair",
                        name: "code_mode",
                        input: {
                          js: `const results = await Promise.allSettled([tools['tasks.query'](${JSON.stringify(taskInput)}), tools['meetings.query'](${JSON.stringify(meetingInput)})]); return results.map(r => r.status === 'fulfilled' ? r : {status:r.status,reason:r.reason.message});`,
                        },
                      },
                    ],
                  },
                  // Neutral turn endings only. This test grades actual tool/DB
                  // evidence, never the quality of a canned assistant answer.
                  { text: "Scripted setup boundary." },
                  { text: "Scripted follow-up boundary." },
                ],
              },
            },
            AbortSignal.timeout(150_000)
          );
          assert.deepEqual(
            outcome.runtimeProof?.turnInputs,
            bindSourceRecoveryTurns(scenario.turns)
          );
          assert.deepEqual(outcome.runtimeProof?.failures, []);
          assert.equal(outcome.runtimeProof?.modelCalls, 4);
          assert.equal(outcome.sourceRecoveryFaults?.length, 1);
          assert.equal(
            outcome.sourceRecoveryFaults?.[0]?.plantId,
            compiled.ids.plant
          );
          const resultPart = outcome.messages
            .flatMap((message) => message.parts)
            .find(
              (part) =>
                part.type === "dynamic-tool" &&
                part.toolCallId === "source-pair"
            );
          assert.ok(
            resultPart?.type === "dynamic-tool" &&
              resultPart.state === "output-available"
          );
          const result = z
            .object({
              data: z.object({
                status: z.literal("completed"),
                calls: z.literal(2),
                output: settledShape,
              }),
            })
            .parse(resultPart.output);
          assert.equal(result.data.output[0]?.status, "fulfilled");
          assert.deepEqual(result.data.output[1], {
            status: "rejected",
            reason: "Host tool failed.",
          });
          assert.ok(
            !JSON.stringify(outcome.messages).includes(
              "Isolated meeting dependency"
            )
          );
          assert.equal(
            outcome.hostCapture.calls.filter(
              (call) => call.name === "meetings.query"
            ).length,
            0
          );
          assert.deepEqual(
            observedSourceRecoveryFacts(
              compiled,
              outcome.hostCapture.calls,
              outcome.sourceRecoveryFaults ?? []
            ).facts,
            expectation.facts
          );
          assert.ok(outcome.hostCapture.freshAuthorizations >= 2);
          assert.equal(outcome.hostCapture.refusedAuthorizations, 0);
          assert.equal(outcome.hostCapture.outboundMessages, 0);
          assert.deepEqual(store.writesSince(audit, compiled), []);
          assert.equal(outcome.judge, null);
        }
      );
    } finally {
      globalThis.fetch = previous.fetch;
      neonConfig.fetchEndpoint = previous.endpoint;
      if (previous.database === undefined) delete process.env.DATABASE_URL;
      else process.env.DATABASE_URL = previous.database;
      if (previous.resend === undefined) delete process.env.RESEND_API_KEY;
      else process.env.RESEND_API_KEY = previous.resend;
      await stack.cleanup();
    }
  }
);
