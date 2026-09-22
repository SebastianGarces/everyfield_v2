import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { test } from "node:test";
import { neonConfig } from "@neondatabase/serverless";
import { z } from "zod";
import { questions } from "@/lib/evry/eve/evals/catalog";
import { observationSchema } from "@/lib/evry/eve/evals/contract";
import { gradeObservation } from "@/lib/evry/eve/evals/grade";
import { startFixtureStack } from "@/lib/evry/eve/evals/fixtures/stack";
import { createFixtureStore } from "@/lib/evry/eve/evals/fixtures/store";
import { createFixtureManifest } from "@/lib/evry/eve/evals/fixtures/manifest";
import {
  capturedReadArtifactSchema,
  type CapturedCall,
} from "@/lib/evry/eve/evals/fixtures/host-capture";
import {
  staffingPreparationFixtureIds,
  staffingPreparationQuestions,
  staffingPreparationId,
  seedStaffingPreparationFixture,
  staffingPreparationTruth,
  staffingPreparationExpectations,
  staffingPreparationReference,
  readPreparedStaffingFacts,
} from "@/lib/evry/eve/evals/fixtures/staffing-preparations";

type CaseId = (typeof staffingPreparationFixtureIds)[number];
type Variant = "correct" | "wrong-person" | "wrong-target";
/** Every preparation ID comes from actual authorized reads. The SQL oracle is separate. */
async function prepare(
  caseId: CaseId,
  variant: Variant,
  invoke: (name: string, input: unknown) => Promise<unknown>
) {
  const people = capturedReadArtifactSchema.parse(
    await invoke("people.query", {
      cohort: {
        all: {
          search:
            variant === "wrong-person"
              ? "Robin"
              : caseId === "roles-05"
                ? "Casey"
                : "Alex",
        },
      },
      result: { mode: "list", limit: 20 },
    })
  );
  assert.equal(people.items.length, 1);
  const personId = people.items[0]!.id;
  await invoke("teams.query", {
    request: {
      resource: "assignments",
      where: { all: [{ personIds: [personId], statuses: ["active"] }] },
      query: { mode: "list", limit: 20 },
    },
  });
  if (caseId === "training-05") {
    const programs = capturedReadArtifactSchema.parse(
      await invoke("training.query", {
        request: {
          resource: "programs",
          where: { all: [{ search: "hospitality" }] },
          query: { mode: "list", limit: 20 },
        },
      })
    );
    const program = programs.items.find(
      (p) =>
        p.label ===
        (variant === "wrong-target"
          ? "Advanced hospitality training"
          : "Hospitality training")
    );
    assert.ok(program);
    await invoke("actions.prepare", {
      request: {
        operation: "teams.training.complete",
        arguments: { personId, programId: program.id },
      },
    });
  } else {
    const teams = capturedReadArtifactSchema.parse(
      await invoke("teams.query", {
        request: {
          resource: "teams",
          where: {
            all: [
              {
                search: variant === "wrong-target" ? "Worship" : "Hospitality",
              },
            ],
          },
          query: { mode: "list", limit: 20 },
        },
      })
    );
    assert.equal(teams.items.length, 1);
    const teamId = teams.items[0]!.id;
    const roles = capturedReadArtifactSchema.parse(
      await invoke("teams.query", {
        request: {
          resource: "roles",
          where: { all: [{ teamIds: [teamId], vacant: true }] },
          query: { mode: "list", limit: 20 },
        },
      })
    );
    assert.equal(
      roles.items.length,
      1,
      "one actual open role, no invented default role or slot capacity"
    );
    await invoke("actions.prepare", {
      request: {
        operation: "teams.members.assign",
        arguments: { personId, teamId, roleId: roles.items[0]!.id },
      },
    });
  }
}

test(
  "staffing preparation uses real scoped reads and exact unconfirmed native plans",
  {
    skip: process.env.EVRY_EVE_STAFFING_PREPARATIONS_PROOF !== "1",
    timeout: 360_000,
  },
  async (t) => {
    const stack = await startFixtureStack(
      process.env.EVRY_FIXTURE_MIGRATIONS_ROOT ?? process.cwd()
    );
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
          throw new Error(
            "External calls prohibited in staffing preparation proof"
          );
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
      let serial = 0;
      for (const caseId of staffingPreparationFixtureIds)
        await t.test(caseId, async (t) => {
          const m = createFixtureManifest(caseId, 761);
          store.seed(m);
          seedStaffingPreparationFixture(m, store);
          const truth = staffingPreparationTruth(m, store)!,
            expected = staffingPreparationExpectations(m, store)!;
          assert.equal(
            truth.person.id,
            m.ids[caseId === "roles-05" ? "core-jordan" : "core-alex"]
          );
          assert.equal(truth.target.roleId, m.ids["open-role"]);
          assert.equal(
            truth.target.programId,
            staffingPreparationId(m, "program")
          );
          assert.equal(truth.today, "2026-09-20");
          assert.deepEqual(
            truth.memberships,
            caseId === "roles-05"
              ? []
              : [staffingPreparationId(m, "worship-membership")]
          );
          const actor = await requireEvryPlantViewerForSession(m.sessionId);
          const authorizeRead = (
            identity: Parameters<
              typeof authorizeEvryReadCapabilityForSession
            >[0]
          ) => authorizeEvryReadCapabilityForSession(identity, m.sessionId);
          const audit = store.auditStart();
          let correct: CapturedCall[] = [];
          for (const variant of [
            "correct",
            "wrong-person",
            "wrong-target",
          ] as const)
            await t.test(variant, async () => {
              const calls: CapturedCall[] = [];
              const registry = createEveToolRegistry({
                context: {
                  actor,
                  literalUserText: staffingPreparationQuestions[caseId],
                  pageContext: null,
                  now: new Date(m.now),
                },
                authorizeRead,
                preparation: createEvePreparation({
                  actor,
                  conversationId: randomUUID(),
                  userRequestKey: randomUUID(),
                  literalUserText: staffingPreparationQuestions[caseId],
                  pageContext: null,
                  now: new Date(m.now),
                  authorizeRead,
                }),
              });
              const invoke = async (name: string, input: unknown) => {
                const id = `staffing-${serial++}`;
                const output = await withAuthenticatedSessionId(
                  m.sessionId,
                  () => registry.invoke(name, input, { callId: id })
                );
                calls.push({ id, name, input, output });
                return output;
              };
              await prepare(caseId, variant, invoke);
              const presented = new Set([calls.at(-1)!.id]);
              assert.ok(
                staffingPreparationReference(calls, presented),
                "must obtain an actual review rather than count a schema refusal as a negative"
              );
              const actual = await readPreparedStaffingFacts({
                manifest: m,
                store,
                calls,
                presented,
              });
              if (variant === "correct") {
                assert.deepEqual(actual.facts, expected.facts);
                assert.deepEqual(actual.evidence, expected.requiredEvidence);
                correct = calls;
              } else assert.notDeepEqual(actual.facts, expected.facts);
              assert.deepEqual(store.writesSince(audit, m), []);
            });
          await t.test(
            "missing source, partial review, foreign owner and stale review never pass",
            async () => {
              assert.ok(correct.length);
              const presented = new Set([correct.at(-1)!.id]);
              const observe = (
                calls = correct,
                manifest = m,
                visible = presented
              ) =>
                readPreparedStaffingFacts({
                  manifest,
                  store,
                  calls,
                  presented: visible,
                });
              assert.deepEqual(
                (await observe(correct, m, new Set())).facts,
                {}
              );
              for (const manifest of [
                { ...m, ids: { ...m.ids, actor: m.ids["other-actor"] } },
                { ...m, ids: { ...m.ids, plant: m.ids["foreign-plant"] } },
                { ...m, now: "2099-01-01T00:00:00.000Z" },
              ])
                assert.deepEqual((await observe(correct, manifest)).facts, {});
              assert.equal(
                (
                  await observe(
                    correct.filter((c) => c.name !== "people.query")
                  )
                ).facts.targetWasRead,
                false
              );
              const partial = correct.map((call) => {
                if (call.name !== "actions.prepare") return call;
                const output = z
                  .object({
                    artifacts: z.array(
                      z
                        .object({
                          kind: z.string(),
                          steps: z
                            .array(
                              z
                                .object({
                                  contentPreviews: z.array(
                                    z
                                      .object({ label: z.string() })
                                      .passthrough()
                                  ),
                                })
                                .passthrough()
                            )
                            .optional(),
                        })
                        .passthrough()
                    ),
                  })
                  .passthrough()
                  .parse(call.output);
                for (const artifact of output.artifacts)
                  for (const step of artifact.steps ?? [])
                    step.contentPreviews = step.contentPreviews.filter(
                      (p) => !p.label.startsWith("Complete immutable plan")
                    );
                return { ...call, output };
              });
              assert.equal(
                (await observe(partial)).facts.exactReviewShown,
                false
              );
              const failed: CapturedCall = {
                id: "failed",
                name: "actions.prepare",
                input: {},
                output: {},
              };
              assert.deepEqual(
                (
                  await observe(
                    [...correct, failed],
                    m,
                    new Set([...presented, failed.id])
                  )
                ).facts,
                {}
              );
              const ref = staffingPreparationReference(correct, presented)!;
              const wrongFingerprint = correct.map((c) =>
                c.name === "actions.prepare"
                  ? {
                      ...c,
                      output: {
                        artifacts: [{ kind: "confirmation" }],
                        activePlan: {
                          mode: "set",
                          plan: { ...ref, fingerprint: "0".repeat(64) },
                        },
                      },
                    }
                  : c
              );
              assert.deepEqual((await observe(wrongFingerprint)).facts, {});
              store.sql(
                `update evry_action_plan_states set status='cancelled' where plan_id='${ref.planId}'`
              );
              assert.deepEqual((await observe()).facts, {});
            }
          );
          assert.deepEqual(store.writesSince(audit, m), []);
          await t.test(
            "freshly revoked permission refuses a new preparation without domain writes",
            async () => {
              const registry = createEveToolRegistry({
                context: {
                  actor,
                  literalUserText: staffingPreparationQuestions[caseId],
                  pageContext: null,
                  now: new Date(m.now),
                },
                authorizeRead,
                preparation: createEvePreparation({
                  actor,
                  conversationId: randomUUID(),
                  userRequestKey: randomUUID(),
                  literalUserText: staffingPreparationQuestions[caseId],
                  pageContext: null,
                  now: new Date(m.now),
                  authorizeRead,
                }),
              });
              const preparationInput = correct.at(-1)!.input;
              // Fixture setup intentionally writes the account and its shared version guard.
              // Audit the actual refused call after that setup, without excluding any tables.
              store.sql(
                `update users set seat='member' where id='${m.ids.actor}'`
              );
              const refusalAudit = store.auditStart();
              try {
                const output = await withAuthenticatedSessionId(
                  m.sessionId,
                  () =>
                    registry.invoke("actions.prepare", preparationInput, {
                      callId: "revoked",
                    })
                );
                assert.equal(
                  staffingPreparationReference(
                    [
                      {
                        id: "revoked",
                        name: "actions.prepare",
                        input: preparationInput,
                        output,
                      },
                    ],
                    new Set(["revoked"])
                  ),
                  null
                );
                assert.deepEqual(store.writesSince(refusalAudit, m), []);
              } finally {
                store.sql(
                  `update users set seat='owner' where id='${m.ids.actor}'`
                );
              }
            }
          );
          assert.equal(
            store.sql(
              `select count(*) from evry_plan_confirmations where church_id='${m.ids.plant}'`
            ),
            "0"
          );
          assert.equal(
            store.sql(
              `select count(*) from evry_execution_attempts where church_id='${m.ids.plant}'`
            ),
            "0"
          );
        });
      await t.test(
        "actual evaluation adapter grades all three original requests against saved plans",
        async (t) => {
          const { createProductionEveEvalAdapter } =
            await import("@/lib/evry/eve/evals/fixtures/adapter");
          let variant: Variant = "correct",
            showReview = true;
          const adapter = createProductionEveEvalAdapter({
            store,
            buildSha: "0".repeat(40),
            async runProduction({
              scenario,
              registry,
              onPresentResult,
              sessionId,
            }) {
              const caseId = staffingPreparationFixtureIds.find(
                (id) => id === scenario.id
              );
              assert.ok(caseId);
              assert.deepEqual(scenario.turns, [
                staffingPreparationQuestions[caseId],
              ]);
              const calls: CapturedCall[] = [];
              await prepare(caseId, variant, async (name, input) => {
                const id = `staffing-adapter-${serial++}`;
                const output = await registry.invoke(name, input, {
                  callId: id,
                });
                calls.push({ id, name, input, output });
                return output;
              });
              const review = calls.at(-1)!;
              assert.ok(
                staffingPreparationReference(calls, new Set([review.id])),
                "negative paths must still reach an actual persisted plan"
              );
              if (showReview) onPresentResult(review.id);
              return {
                eveSessionId: sessionId,
                answer:
                  "Scripted preparation proof; model quality not reviewed.",
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
          for (const caseId of staffingPreparationFixtureIds)
            await t.test(caseId, async () => {
              const scenario = questions.find((q) => q.id === caseId)!;
              const fixture = await adapter.prepare(scenario);
              assert.ok(
                fixture,
                "original question must be bound to its real preparation observer"
              );
              try {
                for (const mode of [
                  "correct",
                  "wrong-person",
                  "wrong-target",
                  "unshown",
                ] as const) {
                  variant = mode === "unshown" ? "correct" : mode;
                  showReview = mode !== "unshown";
                  const observation = observationSchema.parse(
                    await fixture.run({
                      scenario,
                      signal: AbortSignal.timeout(45_000),
                      maxCostUsd: 0.1,
                    })
                  );
                  const failures: readonly string[] = gradeObservation(
                    caseId,
                    fixture.expectations,
                    observation
                  ).failures;
                  assert.deepEqual(observation.effects, {
                    domainWrites: 0,
                    outboundMessages: 0,
                  });
                  assert.equal(observation.costUsd, 0);
                  assert.equal(observation.judge, null);
                  if (mode === "correct")
                    assert.deepEqual(
                      failures,
                      ["quality_not_reviewed"],
                      JSON.stringify(observation.facts)
                    );
                  else
                    assert.ok(
                      failures.some((failure) => failure.startsWith("fact:")),
                      `${caseId}/${mode}: ${JSON.stringify(failures)}`
                    );
                }
              } finally {
                await fixture.cleanup();
              }
            });
        }
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
