import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { test } from "node:test";
import { neonConfig } from "@neondatabase/serverless";
import { z } from "zod";
import { questions } from "@/lib/evry/eve/evals/catalog";
import { observationSchema } from "@/lib/evry/eve/evals/contract";
import { gradeObservation } from "@/lib/evry/eve/evals/grade";
import { createFixtureManifest } from "@/lib/evry/eve/evals/fixtures/manifest";
import { createFixtureStore } from "@/lib/evry/eve/evals/fixtures/store";
import { startFixtureStack } from "@/lib/evry/eve/evals/fixtures/stack";
import {
  capturedReadArtifactSchema,
  type CapturedCall,
} from "@/lib/evry/eve/evals/fixtures/host-capture";
import {
  seedOrientationDocumentFixture,
  orientationDocumentTruth,
  orientationDocumentExpectations,
  observedOrientationDocumentFacts,
  orientationDocumentPlanReference,
  orientationDocumentId,
} from "@/lib/evry/eve/evals/fixtures/orientation-document";

/** No manifest IDs, expected SQL, or authored agenda are used to construct the request. */
async function prepareFromReads(
  invoke: (name: string, args: unknown) => Promise<unknown>,
  variant: "correct" | "partial" | "vision" = "correct"
) {
  const found = capturedReadArtifactSchema.parse(
    await invoke("meetings.query", {
      where: {
        all: [
          {
            types: ["orientation"],
            timing: "upcoming",
            statuses: ["planning", "ready", "in_progress", "completed"],
          },
        ],
      },
      query: { mode: "list", sort: "date", direction: "asc", limit: 1 },
    })
  );
  assert.equal(found.items.length, 1);
  const meeting = found.items[0]!;
  const lines: string[] = [];
  let details: typeof meeting | undefined;
  for (let offset = 0; offset < 100; offset += 10) {
    const result = capturedReadArtifactSchema.parse(
      await invoke("meetings.get_many", {
        ids: [meeting.id],
        sections: ["details", "agenda"],
        relatedLimit: 10,
        relatedOffset: offset,
      })
    );
    assert.equal(result.items.length, 1);
    const item = result.items[0]!;
    details ??= item;
    const facts = item.facts ?? [];
    const total = Number(
      facts.find((fact) => fact.label === "Agenda total")?.value
    );
    assert.ok(Number.isSafeInteger(total));
    lines.push(
      ...facts
        .filter((fact) => fact.label === "Agenda item")
        .map((fact) => fact.value)
    );
    if (variant === "partial" || lines.length === total) break;
    assert.ok(
      lines.length < total && offset + 10 < 100,
      "Agenda paging must converge"
    );
  }
  assert.ok(details);
  const value = (label: string) => {
    const found = details.facts?.find((fact) => fact.label === label)?.value;
    assert.ok(found, `Real meeting read omitted ${label}`);
    return found;
  };
  const provided = {
    meeting_title: details.label,
    meeting_date: value("When"),
    meeting_location: `${value("Location")}, ${value("Address")}`,
    meeting_duration: `${value("Duration in minutes")} minutes`,
    meeting_agenda: lines.join("\n"),
  };
  const request = {
    request: {
      operation: "documents.generate",
      arguments: {
        templateId:
          variant === "vision" ? "vision-meeting-agenda" : "orientation-agenda",
        format: "pdf",
        provided,
      },
    },
  };
  const output = await invoke("actions.prepare", request);
  return { output, request, meetingId: meeting.id };
}

test(
  "orientation document uses saved meeting evidence, exact review and isolated native file effects",
  {
    skip: process.env.EVRY_EVE_ORIENTATION_DOCUMENT_PROOF !== "1",
    timeout: 240_000,
  },
  async (t) => {
    const stack = await startFixtureStack(process.cwd());
    const previous = {
      database: process.env.DATABASE_URL,
      resend: process.env.RESEND_API_KEY,
      live: process.env.LIVE_DB_TESTS,
      endpoint: neonConfig.fetchEndpoint,
      fetch: globalThis.fetch,
    };
    let outbound = 0;
    const outboundOrigins: string[] = [];
    try {
      process.env.DATABASE_URL = stack.databaseUrl;
      process.env.RESEND_API_KEY = "re_isolated_no_send";
      process.env.LIVE_DB_TESTS = "1";
      neonConfig.fetchEndpoint = stack.proxyUrl;
      globalThis.fetch = async (input, init) => {
        const url = new URL(
          input instanceof Request ? input.url : String(input)
        );
        // PDF layout may load bundled WASM through a data URL. It is inline
        // local bytes, not an outbound request; every external origin is blocked.
        if (
          url.protocol !== "data:" &&
          url.origin !== new URL(stack.proxyUrl).origin
        ) {
          outbound++;
          outboundOrigins.push(url.origin);
          throw new Error("External fetch prohibited in orientation proof");
        }
        return previous.fetch(input, init);
      };
      const [
        { createEveToolRegistry },
        { createEvePreparation },
        { requireEvryPlantViewerForSession },
        { authorizeEvryReadCapabilityForSession },
        { withAuthenticatedSessionId },
        { confirmEvryActionPlan },
        { PRODUCTION_EVRY_PLAN_REGISTRY, executeProductionEvryActionPlan },
        { withEvryDocumentLiveProofStorage },
        { extractGeneratedDocument },
      ] = await Promise.all([
        import("@/lib/evry/eve/capabilities/registry"),
        import("@/lib/evry/eve/preparation"),
        import("@/lib/evry/eligibility/viewer"),
        import("@/lib/evry/eligibility/capabilities"),
        import("@/lib/auth/session-scope"),
        import("@/lib/evry/plans"),
        import("@/lib/evry/capabilities/execution"),
        import("@/lib/evry/capabilities/documents-wiki/document-storage"),
        import("@/lib/evry/capabilities/queries/content-documents"),
      ]);
      const store = createFixtureStore(stack.container);
      const m = createFixtureManifest("documents-05", 710);
      store.seed(m);
      seedOrientationDocumentFixture(m, store);
      try {
        const truth = orientationDocumentTruth(m, store);
        assert.ok(truth);
        const scenario = questions.find(
          (question) => question.id === m.caseId
        )!;
        assert.deepEqual(scenario.turns, [
          "Generate an agenda document for our next orientation.",
        ]);
        const actor = await requireEvryPlantViewerForSession(m.sessionId);
        const authorizeRead = (identity: string) =>
          authorizeEvryReadCapabilityForSession(identity, m.sessionId);
        const context = {
          actor,
          literalUserText: scenario.turns[0]!,
          pageContext: null,
          now: new Date(m.now),
        };
        const registry = createEveToolRegistry({
          context,
          authorizeRead,
          preparation: createEvePreparation({
            ...context,
            conversationId: randomUUID(),
            userRequestKey: randomUUID(),
            authorizeRead,
          }),
        });
        const calls: CapturedCall[] = [];
        const invoke = async (name: string, input: unknown) => {
          const id = `orientation-${calls.length}`;
          const output = await withAuthenticatedSessionId(m.sessionId, () =>
            registry.invoke(name, input, { callId: id })
          );
          calls.push({ id, name, input, output });
          return output;
        };
        const files = new Map<string, Buffer>();
        let uploads = 0;
        await withEvryDocumentLiveProofStorage(
          {
            store: async (key, bytes) => {
              uploads++;
              files.set(key, Buffer.from(bytes));
              return key;
            },
          },
          async () => {
            await t.test(
              "real next-orientation reads include all saved section timings and prepare one faithful review",
              async () => {
                const result = await prepareFromReads(invoke);
                assert.equal(result.meetingId, truth.id);
                assert.equal(truth.agenda.length, 13);
                const observed = await observedOrientationDocumentFacts(
                  m,
                  store,
                  truth,
                  calls,
                  new Set([calls.at(-1)!.id])
                );
                assert.deepEqual(
                  observed.facts,
                  orientationDocumentExpectations(m)!.facts
                );
                assert.equal(
                  store.sql(
                    `select count(*) from generated_documents where church_id='${m.ids.plant}'`
                  ),
                  "0"
                );
                assert.equal(uploads, 0);
                assert.equal(
                  JSON.stringify(calls).includes("FOREIGN_LOCATION"),
                  false
                );
                const foreign = capturedReadArtifactSchema.parse(
                  await invoke("meetings.get_many", {
                    ids: [orientationDocumentId(m, "foreign")],
                    sections: ["agenda"],
                  })
                );
                assert.ok(
                  foreign.items.every(
                    (item) => item.label === "Record unavailable"
                  )
                );
                assert.ok(
                  !JSON.stringify(foreign).includes("FOREIGN_LOCATION")
                );
              }
            );
            const presented = new Set(
              calls
                .filter((call) => call.name === "actions.prepare")
                .map((call) => call.id)
            );
            const ref = orientationDocumentPlanReference(calls, presented);
            assert.ok(ref);
            await t.test(
              "unconfirmed or wrong-fingerprint execution cannot generate a file",
              async () => {
                const unconfirmed = await withAuthenticatedSessionId(
                  m.sessionId,
                  () => executeProductionEvryActionPlan({ actor, ...ref })
                );
                assert.notEqual(unconfirmed.status, "completed");
                const wrong = await withAuthenticatedSessionId(
                  m.sessionId,
                  () =>
                    confirmEvryActionPlan({
                      actor,
                      ...ref,
                      fingerprint: "0".repeat(64),
                      decidedAt: new Date(),
                      registry: PRODUCTION_EVRY_PLAN_REGISTRY,
                    })
                );
                assert.notEqual(wrong.status, "approved");
                assert.equal(uploads, 0);
              }
            );
            await t.test(
              "exact confirmation stores actual PDF bytes once and replay has no duplicate effect",
              async () => {
                const confirmation = await withAuthenticatedSessionId(
                  m.sessionId,
                  () =>
                    confirmEvryActionPlan({
                      actor,
                      ...ref,
                      decidedAt: new Date(),
                      registry: PRODUCTION_EVRY_PLAN_REGISTRY,
                    })
                );
                assert.equal(confirmation.status, "approved");
                const result = await withAuthenticatedSessionId(
                  m.sessionId,
                  () => executeProductionEvryActionPlan({ actor, ...ref })
                );
                assert.equal(result.status, "completed");
                const rows = store.query(
                  `select storage_key,template_id,format,user_id from generated_documents where church_id='${m.ids.plant}'`
                );
                assert.equal(rows.length, 1);
                const row = z
                  .object({
                    storage_key: z.string(),
                    template_id: z.literal("orientation-agenda"),
                    format: z.literal("pdf"),
                    user_id: z.literal(m.ids.actor),
                  })
                  .parse(rows[0]);
                const bytes = files.get(row.storage_key);
                assert.ok(bytes);
                const extracted = await extractGeneratedDocument(bytes, "pdf");
                assert.equal(extracted.complete, true);
                const text = extracted.sections
                  .map((section) => section.text)
                  .join("\n");
                assert.ok(text.includes(truth.title));
                assert.ok(text.includes(truth.location));
                assert.ok(text.includes(truth.address));
                for (const section of truth.agenda) {
                  assert.ok(text.includes(section.title));
                  assert.ok(
                    text.includes(
                      section.minutes == null
                        ? "duration not recorded"
                        : `${section.minutes} minutes`
                    )
                  );
                }
                assert.doesNotMatch(text, /Vision Meeting|GROW|PRAY|GIVE/);
                assert.equal(uploads, 1);
                const replay = await withAuthenticatedSessionId(
                  m.sessionId,
                  () => executeProductionEvryActionPlan({ actor, ...ref })
                );
                assert.equal(replay.status, "completed");
                assert.equal(uploads, 1);
                assert.equal(
                  store.sql(
                    `select count(*) from generated_documents where church_id='${m.ids.plant}'`
                  ),
                  "1"
                );
              }
            );
          }
        );
      } finally {
        store.revoke(m);
      }

      await t.test(
        "actual eval adapter binds original question with honest quality pending and partial-agenda refusal",
        async () => {
          const { createProductionEveEvalAdapter } =
            await import("@/lib/evry/eve/evals/fixtures/adapter");
          let variant: "correct" | "partial" | "vision" = "correct";
          const adapter = createProductionEveEvalAdapter({
            store,
            buildSha: "0".repeat(40),
            async runProduction({
              scenario,
              registry,
              sessionId,
              onPresentResult,
            }) {
              assert.deepEqual(scenario.turns, [
                "Generate an agenda document for our next orientation.",
              ]);
              let call = 0;
              await prepareFromReads(async (name, input) => {
                const id = `adapter-orientation-${call++}`;
                const result = await registry.invoke(name, input, {
                  callId: id,
                });
                if (
                  name === "actions.prepare" &&
                  orientationDocumentPlanReference(
                    [{ id, name, input, output: result }],
                    new Set([id])
                  )
                )
                  onPresentResult(id);
                return result;
              }, variant);
              return {
                eveSessionId: sessionId,
                answer:
                  "Scripted production proof; answer quality not reviewed.",
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
          for (const mode of ["correct", "partial", "vision"] as const) {
            variant = mode;
            const scenario = questions.find((q) => q.id === "documents-05")!;
            const fixture = await adapter.prepare(scenario);
            assert.ok(
              fixture,
              "Root must wire orientation fixture before proof"
            );
            try {
              const observed = observationSchema.parse(
                await fixture.run({
                  scenario,
                  signal: AbortSignal.timeout(30_000),
                  maxCostUsd: 0.1,
                })
              );
              const failures: readonly string[] = gradeObservation(
                scenario.id,
                fixture.expectations,
                observed
              ).failures;
              if (mode === "correct")
                assert.deepEqual(failures, ["quality_not_reviewed"]);
              else
                assert.ok(
                  failures.some((failure) => failure.startsWith("fact:"))
                );
              assert.deepEqual(observed.effects, {
                domainWrites: 0,
                outboundMessages: 0,
              });
            } finally {
              await fixture.cleanup();
            }
          }
        }
      );
      assert.equal(outbound, 0, JSON.stringify(outboundOrigins));
    } finally {
      globalThis.fetch = previous.fetch;
      neonConfig.fetchEndpoint = previous.endpoint;
      for (const [key, value] of Object.entries({
        DATABASE_URL: previous.database,
        RESEND_API_KEY: previous.resend,
        LIVE_DB_TESTS: previous.live,
      })) {
        if (value === undefined) delete process.env[key];
        else process.env[key] = value;
      }
      await stack.cleanup();
    }
  }
);
