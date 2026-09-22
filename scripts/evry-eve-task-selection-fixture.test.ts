import assert from "node:assert/strict";
import { test } from "node:test";
import { randomUUID } from "node:crypto";
import { z } from "zod";
import { neonConfig } from "@neondatabase/serverless";
import { startFixtureStack } from "@/lib/evry/eve/evals/fixtures/stack";
import { createFixtureStore } from "@/lib/evry/eve/evals/fixtures/store";
import { createFixtureManifest } from "@/lib/evry/eve/evals/fixtures/manifest";
import {
  capturedReadArtifactSchema,
  type CapturedCall,
} from "@/lib/evry/eve/evals/fixtures/host-capture";
import { fixtureMessageSchema } from "@/lib/evry/eve/evals/http/transcript";
import { eveResultMarker } from "@/lib/evry/eve/presentation";
import {
  selectedEveResultReferences,
  projectEveMessage,
} from "@/components/evry/eve-message-projection";
import { questions } from "@/lib/evry/eve/evals/catalog";
import { observationSchema } from "@/lib/evry/eve/evals/contract";
import { gradeObservation } from "@/lib/evry/eve/evals/grade";
import { taskCleanupPlanReference } from "@/lib/evry/eve/evals/fixtures/task-cleanup";
import {
  bindTaskSelectionTurns,
  readPreparedTaskSelectionFacts,
  seedTaskSelectionFixture,
  taskSelectionExpectations,
  taskSelectionId,
  taskSelectionRequest,
  taskSelectionSetup,
  taskSelectionTruth,
} from "@/lib/evry/eve/evals/fixtures/task-selection";

type Variant =
  | "correct"
  | "unshown-selection"
  | "late-selection"
  | "wrong-five"
  | "missing-prerequisites"
  | "first-prerequisite-page"
  | "dependency-veto"
  | "unshown-review"
  | "stale-review";
const variants: readonly Variant[] = [
  "correct",
  "unshown-selection",
  "late-selection",
  "wrong-five",
  "missing-prerequisites",
  "first-prerequisite-page",
  "dependency-veto",
  "unshown-review",
  "stale-review",
];
const user = (id: string, text: string) =>
  fixtureMessageSchema.parse({
    id,
    role: "user",
    parts: [{ type: "text", text }],
  });
async function assistant(call: CapturedCall, turnId: string, show = true) {
  const { collectResult, publicResultArtifacts } =
    await import("@/lib/evry/eve/runtime/results");
  const records = collectResult(
    [],
    { reference: call.id, turnId, capability: call.name },
    z.json().parse(call.output)
  );
  return fixtureMessageSchema.parse({
    id: `${turnId}:assistant:${call.id}`,
    role: "assistant",
    metadata: { turnId, status: "complete" },
    parts: [
      {
        type: "dynamic-tool",
        toolName: call.name.replaceAll(".", "_"),
        toolCallId: call.id,
        state: "output-available",
        input: call.input,
        output: {
          data: call.output,
          presentation: {
            version: 1,
            turnId,
            results: records.map((r) => ({
              reference: r.reference,
              artifacts: publicResultArtifacts(r.artifacts),
            })),
          },
        },
      },
      {
        type: "text",
        text: show ? eveResultMarker(call.id) : "The query finished.",
      },
    ],
  });
}
/** Only actual returned IDs enter the follow-up preparation. SQL truth never enters this strategy. */
async function prepareSelection(
  invoke: (name: string, input: unknown) => Promise<CapturedCall>,
  onPresent: (id: string) => void,
  variant: Variant
) {
  const setup = await invoke("tasks.query", {
    where: { all: [{ search: "Welcome desk cleanup list" }] },
    query: { mode: "list", sort: "title", direction: "asc", limit: 5 },
  });
  const read = capturedReadArtifactSchema.parse(setup.output);
  assert.equal(read.items.length, 5);
  assert.equal(read.counts.matched, 5);
  const selection = await assistant(
    setup,
    "turn_0",
    variant !== "unshown-selection"
  );
  for (const id of selectedEveResultReferences(selection)) onPresent(id);
  const messages = [
    user("u0", taskSelectionSetup),
    selection,
    user("u1", taskSelectionRequest),
  ];
  if (variant === "late-selection")
    (messages.splice(1, 1), messages.push(selection));
  let ids = read.items.map((r) => r.id);
  const blocked = new Set<string>();
  if (variant !== "missing-prerequisites") {
    let remaining = [...ids],
      offset = 0;
    for (let page = 0; page < 10 && remaining.length; page++) {
      const call = await invoke("tasks.get_many", {
        ids: remaining,
        sections: ["details", "dependencies"],
        relatedLimit: 1,
        relatedOffset: offset,
      });
      const out = capturedReadArtifactSchema.parse(call.output);
      remaining = out.items
        .filter((row) => {
          const fields = row.facts ?? [];
          if (
            fields.some(
              (f) =>
                f.label === "Prerequisite" &&
                !f.value.includes(" · Complete · ")
            )
          )
            blocked.add(row.id);
          const total = Number(
            fields.find((f) => f.label === "Prerequisite total")?.value
          );
          assert.ok(Number.isFinite(total));
          return total > offset + 1;
        })
        .map((row) => row.id);
      if (variant === "first-prerequisite-page") break;
      offset++;
    }
  }
  if (variant === "dependency-veto") ids = ids.filter((id) => !blocked.has(id));
  if (variant === "wrong-five") {
    const other = await invoke("tasks.query", {
      where: { all: [{ search: "Unselected work" }] },
      query: { mode: "list", limit: 5 },
    });
    const rows = capturedReadArtifactSchema.parse(other.output).items;
    assert.equal(rows.length, 1);
    ids = [...ids.slice(0, 4), rows[0]!.id];
  }
  const prepared = await invoke("actions.prepare", {
    request: { operation: "tasks.bulk.complete", arguments: { taskIds: ids } },
  });
  const review = await assistant(prepared, "turn_1");
  if (variant !== "unshown-review") {
    messages.push(review);
    for (const id of selectedEveResultReferences(review)) onPresent(id);
  }
  if (variant === "stale-review")
    await invoke("actions.prepare", {
      request: {
        operation: "tasks.bulk.complete",
        arguments: { taskIds: [randomUUID()] },
      },
    });
  return { messages, prepared, ids };
}

test(
  "tasks-10 actual visible selection, per-task permissions, advisory prerequisites and pending exact review",
  { skip: process.env.EVRY_EVE_TASK_SELECTION_PROOF !== "1", timeout: 240_000 },
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
      process.env.RESEND_API_KEY = "re_isolated_no_delivery";
      neonConfig.fetchEndpoint = stack.proxyUrl;
      globalThis.fetch = async (input, init) => {
        const url = new URL(
          input instanceof Request ? input.url : String(input)
        );
        if (url.origin !== new URL(stack.proxyUrl).origin) {
          external++;
          throw new Error("External calls prohibited");
        }
        return previous.fetch(input, init);
      };
      const [
        { createEveToolRegistry },
        { createEvePreparation },
        { withAuthenticatedSessionId },
        { requireEvryPlantViewerForSession },
        { authorizeEvryReadCapabilityForSession },
      ] = await Promise.all([
        import("@/lib/evry/eve/capabilities/registry"),
        import("@/lib/evry/eve/preparation"),
        import("@/lib/auth/session-scope"),
        import("@/lib/evry/eligibility/viewer"),
        import("@/lib/evry/eligibility/capabilities"),
      ]);
      const store = createFixtureStore(stack.container);
      const m = createFixtureManifest("tasks-10", 701);
      store.seed(m);
      seedTaskSelectionFixture(m, store);
      const truth = taskSelectionTruth(m, store),
        expected = taskSelectionExpectations(m, store)!;
      assert.equal(truth.rows.length, 5);
      assert.equal(truth.actionable.length, 4);
      assert.equal(truth.excluded.length, 1);
      assert.equal(truth.dependencies.length, 2);
      const baseline = store.sql(
        `select jsonb_agg(to_jsonb(t) order by t.id)::text from tasks t where church_id in ('${m.ids.plant}','${m.ids["foreign-plant"]}')`
      );
      const audit = store.auditStart();
      const actor = await requireEvryPlantViewerForSession(m.sessionId);
      const authorizeRead = (
        identity: Parameters<typeof authorizeEvryReadCapabilityForSession>[0]
      ) => authorizeEvryReadCapabilityForSession(identity, m.sessionId);
      const registry = createEveToolRegistry({
        context: {
          actor,
          literalUserText: taskSelectionRequest,
          pageContext: null,
          now: new Date(m.now),
        },
        authorizeRead,
        preparation: createEvePreparation({
          actor,
          conversationId: randomUUID(),
          userRequestKey: randomUUID(),
          literalUserText: taskSelectionRequest,
          pageContext: null,
          now: new Date(m.now),
          authorizeRead,
        }),
      });
      let sequence = 0;
      for (const variant of variants)
        await t.test(variant, async () => {
          const calls: CapturedCall[] = [],
            presented = new Set<string>();
          const invoke = async (name: string, input: unknown) => {
            const id = `selection-${sequence++}`;
            const output = await withAuthenticatedSessionId(m.sessionId, () =>
              registry.invoke(name, input, { callId: id })
            );
            const call = { id, name, input, output };
            calls.push(call);
            return call;
          };
          const run = await prepareSelection(
            invoke,
            (id) => presented.add(id),
            variant
          );
          assert.ok(
            taskCleanupPlanReference(
              [run.prepared],
              new Set([run.prepared.id])
            ),
            `${variant} reached a real preparation`
          );
          const actual = await readPreparedTaskSelectionFacts({
            manifest: m,
            store,
            calls,
            presented,
            messages: run.messages,
          });
          if (variant === "correct") {
            assert.deepEqual(actual.facts, expected.facts);
            assert.deepEqual(actual.evidence, expected.requiredEvidence);
            assert.ok(
              projectEveMessage(run.messages.at(-1)!).some(
                (p) =>
                  p.kind === "artifact" && p.artifact.kind === "confirmation"
              )
            );
          } else
            assert.notDeepEqual(
              actual.facts,
              expected.facts,
              `${variant} must not pass`
            );
          assert.equal(
            store.sql(
              `select jsonb_agg(to_jsonb(t) order by t.id)::text from tasks t where church_id in ('${m.ids.plant}','${m.ids["foreign-plant"]}')`
            ),
            baseline
          );
          assert.equal(store.writesSince(audit, m).length, 0);
        });
      await t.test(
        "foreign requested ID cannot become an actionable completion",
        async () => {
          const input = {
            request: {
              operation: "tasks.bulk.complete",
              arguments: {
                taskIds: [truth.actionable[0]!.id, m.ids["task-foreign"]],
              },
            },
          };
          const id = `foreign-${sequence++}`;
          const output = await withAuthenticatedSessionId(m.sessionId, () =>
            registry.invoke("actions.prepare", input, { callId: id })
          );
          const ref = taskCleanupPlanReference(
            [{ id, name: "actions.prepare", input, output }],
            new Set([id])
          );
          assert.ok(ref);
          const stored = store.query(
            `select document from evry_action_plans where id='${ref.planId}'`
          )[0];
          const plan = z
            .object({
              steps: z.array(
                z.object({
                  arguments: z.object({
                    sourceAssertion: z.object({
                      actionableTaskIds: z.array(z.string()),
                      excludedTasks: z.array(
                        z.object({ taskId: z.string(), reason: z.string() })
                      ),
                    }),
                  }),
                })
              ),
            })
            .parse(stored?.document);
          assert.deepEqual(
            plan.steps[0]!.arguments.sourceAssertion.actionableTaskIds,
            [truth.actionable[0]!.id]
          );
          assert.ok(
            plan.steps[0]!.arguments.sourceAssertion.excludedTasks.some(
              (x) =>
                x.taskId === m.ids["task-foreign"] &&
                x.reason === "Task not found"
            )
          );
        }
      );
      await t.test(
        "owner may review all five, including the task with unfinished prerequisites",
        async () => {
          store.sql(`update users set seat='owner' where id='${m.ids.actor}'`);
          try {
            const fresh = await requireEvryPlantViewerForSession(m.sessionId);
            const ownRegistry = createEveToolRegistry({
              context: {
                actor: fresh,
                literalUserText: taskSelectionRequest,
                pageContext: null,
                now: new Date(m.now),
              },
              authorizeRead,
              preparation: createEvePreparation({
                actor: fresh,
                conversationId: randomUUID(),
                userRequestKey: randomUUID(),
                literalUserText: taskSelectionRequest,
                pageContext: null,
                now: new Date(m.now),
                authorizeRead,
              }),
            });
            const calls: CapturedCall[] = [],
              presented = new Set<string>();
            const run = await prepareSelection(
              async (name, input) => {
                const id = `owner-${sequence++}`;
                const output = await withAuthenticatedSessionId(
                  m.sessionId,
                  () => ownRegistry.invoke(name, input, { callId: id })
                );
                const c = { id, name, input, output };
                calls.push(c);
                return c;
              },
              (id) => presented.add(id),
              "correct"
            );
            const observed = await readPreparedTaskSelectionFacts({
              manifest: m,
              store,
              calls,
              presented,
              messages: run.messages,
            });
            assert.deepEqual(
              observed.facts,
              taskSelectionExpectations(m, store)!.facts
            );
            assert.equal(
              z.array(z.string()).parse(observed.facts.actionableTaskIds)
                .length,
              5
            );
            assert.ok(
              z
                .array(z.string())
                .parse(observed.facts.actionableTaskIds)
                .includes(taskSelectionId(m, "three"))
            );
          } finally {
            store.sql(
              `update users set seat='member' where id='${m.ids.actor}'`
            );
          }
        }
      );
      await t.test(
        "real adapter preserves setup and final wording; negatives fail without fabricated quality",
        async () => {
          const { createProductionEveEvalAdapter } =
            await import("@/lib/evry/eve/evals/fixtures/adapter");
          let variant: Variant = "correct";
          const adapter = createProductionEveEvalAdapter({
            store,
            buildSha: "0".repeat(40),
            async runProduction({ scenario, registry, onPresentResult }) {
              assert.deepEqual(
                scenario.turns,
                bindTaskSelectionTurns([taskSelectionRequest])
              );
              const run = await prepareSelection(
                async (name, input) => {
                  const id = `adapter-${sequence++}`;
                  return {
                    id,
                    name,
                    input,
                    output: await registry.invoke(name, input, { callId: id }),
                  };
                },
                onPresentResult,
                variant
              );
              return {
                messages: run.messages,
                answer: "Scripted selection proof; model quality not reviewed.",
                clarificationCount: 0,
                costUsd: 0,
                judge: null,
                latency: {
                  acknowledgementMs: 0,
                  firstTextMs: null,
                  totalMs: 0,
                },
              };
            },
          });
          const scenario = questions.find((q) => q.id === "tasks-10")!;
          const fixture = await adapter.prepare(scenario);
          assert.ok(
            fixture,
            "Root must wire the actual task-selection adapter"
          );
          try {
            for (const current of variants) {
              variant = current;
              const observation = observationSchema.parse(
                await fixture.run({
                  scenario,
                  signal: AbortSignal.timeout(30_000),
                  maxCostUsd: 0,
                })
              );
              const grade = gradeObservation(
                scenario.id,
                fixture.expectations,
                observation
              );
              if (current === "correct")
                assert.deepEqual(grade.failures, ["quality_not_reviewed"]);
              else
                assert.ok(
                  grade.failures.some((f) => f !== "quality_not_reviewed"),
                  `${current} cannot pass`
                );
              assert.deepEqual(observation.effects, {
                domainWrites: 0,
                outboundMessages: 0,
              });
            }
          } finally {
            await fixture.cleanup();
          }
        }
      );
      assert.equal(
        store.sql("select count(*) from evry_plan_confirmations"),
        "0"
      );
      assert.equal(
        store.sql("select count(*) from evry_execution_attempts"),
        "0"
      );
      assert.equal(external, 0);
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
