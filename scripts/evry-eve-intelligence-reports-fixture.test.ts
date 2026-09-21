import assert from "node:assert/strict";
import { test } from "node:test";
import { neonConfig } from "@neondatabase/serverless";
import { questions } from "@/lib/evry/eve/evals/catalog";
import { startFixtureStack } from "@/lib/evry/eve/evals/fixtures/stack";
import { createFixtureStore } from "@/lib/evry/eve/evals/fixtures/store";
import {
  createFixtureManifest,
  FIXTURE_NOW,
} from "@/lib/evry/eve/evals/fixtures/manifest";
import {
  capturedReadArtifactSchema,
  type CapturedCall,
} from "@/lib/evry/eve/evals/fixtures/host-capture";
import {
  intelligenceReportsFixtureIds,
  intelligenceReportsId,
  seedIntelligenceReportsFixture,
  intelligenceReportsExpectations,
  observedIntelligenceReportsFacts,
} from "@/lib/evry/eve/evals/fixtures/intelligence-reports";
import { observationSchema } from "@/lib/evry/eve/evals/contract";
import { gradeObservation } from "@/lib/evry/eve/evals/grade";

/** One scripted strategy shared by direct registry and actual adapter checks. */
async function retrieve(
  caseId: string,
  invoke: (name: string, input: unknown) => Promise<unknown>
) {
  if (caseId === "intelligence-05") {
    await invoke("context.get", {});
    await invoke("intelligence.query", { query: { resource: "transitions" } });
    return;
  }
  const reports = capturedReadArtifactSchema.parse(
    await invoke("intelligence.query", {
      query: { resource: "assessments", includeFactSnapshot: true },
    })
  );
  const latest = reports.items[0];
  assert.ok(latest);
  if (caseId !== "intelligence-03")
    await invoke("intelligence.query", {
      query: { resource: "insights", assessmentIds: [latest.id] },
    });
  if (caseId === "intelligence-02")
    await invoke("teams.query", {
      request: { resource: "teams", query: { mode: "list" } },
    });
}

test(
  "stored intelligence findings, historical evidence and phase transitions match independent SQL",
  {
    skip: process.env.EVRY_EVE_INTELLIGENCE_REPORTS_PROOF !== "1",
    timeout: 240_000,
  },
  async (t) => {
    const stack = await startFixtureStack(process.cwd());
    const originalFetch = globalThis.fetch,
      previous = {
        database: process.env.DATABASE_URL,
        resend: process.env.RESEND_API_KEY,
        endpoint: neonConfig.fetchEndpoint,
      };
    let outbound = 0;
    try {
      process.env.DATABASE_URL = stack.databaseUrl;
      process.env.RESEND_API_KEY = "re_fixture_never_sent";
      neonConfig.fetchEndpoint = stack.proxyUrl;
      globalThis.fetch = async (input, init) => {
        const url = new URL(
          input instanceof Request ? input.url : String(input)
        );
        if (url.origin !== new URL(stack.proxyUrl).origin) {
          outbound++;
          throw new Error("Only isolated database requests allowed");
        }
        return originalFetch(input, init);
      };
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
      const store = createFixtureStore(stack.container);
      for (const caseId of intelligenceReportsFixtureIds)
        await t.test(caseId, async () => {
          const m = createFixtureManifest(caseId, 100);
          store.seed(m);
          seedIntelligenceReportsFixture(m, store);
          const expected = intelligenceReportsExpectations(m, store)!;
          const audit = store.auditStart(),
            calls: CapturedCall[] = [];
          let authorized = 0;
          const actor = await requireEvryPlantViewerForSession(m.sessionId);
          const registry = createEveToolRegistry({
            context: {
              actor,
              literalUserText: questions.find((q) => q.id === caseId)!
                .turns[0]!,
              pageContext: null,
              now: FIXTURE_NOW,
            },
            authorizeRead: async (identity) => {
              authorized++;
              return authorizeEvryReadCapabilityForSession(
                identity,
                m.sessionId
              );
            },
          });
          const invoke = async (name: string, input: unknown) => {
            const id = `${caseId}-${calls.length}`;
            const output = await withAuthenticatedSessionId(m.sessionId, () =>
              registry.invoke(name, input, { callId: id })
            );
            calls.push({ id, name, input, output });
            return output;
          };
          await retrieve(caseId, invoke);
          if (caseId === "intelligence-05") {
            assert.equal(
              expected.facts.transitionId,
              intelligenceReportsId(m, "current-transition")
            );
            assert.equal(expected.facts.currentPhase, 3);
            const declarationOnly = structuredClone(calls);
            const last = declarationOnly.at(-1)!;
            const output = capturedReadArtifactSchema.parse(last.output);
            output.items = output.items.filter(
              (r) => r.id === intelligenceReportsId(m, "declaration")
            );
            output.counts.matched = 1;
            last.output = output;
            assert.notDeepEqual(
              observedIntelligenceReportsFacts(caseId, declarationOnly).facts,
              expected.facts,
              "Declaration cannot satisfy advancement"
            );
          } else {
            const reports = capturedReadArtifactSchema.parse(calls[0]!.output);
            assert.equal(
              reports.items[0]?.id,
              intelligenceReportsId(m, "latest")
            );
            assert.equal(
              reports.counts.matched,
              2,
              "Exclude newer failed and foreign reports"
            );
            if (caseId === "intelligence-02") {
              assert.equal(expected.facts.reportFilled, 4);
              assert.equal(
                store.query(
                  `select id from ministry_teams where church_id='${m.ids.plant}' and leader_id is not null`
                ).length,
                5,
                "Current leadership must differ from historical coverage"
              );
            }
            if (caseId === "intelligence-03") {
              assert.deepEqual(expected.facts.unknownIndicators, [
                "launch.decisionsCount",
                "training.requiredCompletionRate",
              ]);
              assert.deepEqual(expected.facts.zeroIndicators, [
                "launch.attendanceCount",
              ]);
              assert.equal(expected.facts.selfAttestedFunding, true);
            }
          }
          assert.deepEqual(
            observedIntelligenceReportsFacts(caseId, calls).facts,
            expected.facts
          );
          assert.deepEqual(
            observedIntelligenceReportsFacts(
              caseId,
              calls,
              new Set(calls.map((c) => c.id))
            ).facts,
            expected.facts,
            "Read evidence does not depend on rendering a card"
          );
          // These mutations are grader controls, not claims about real tool behavior.
          const wrong = structuredClone(calls);
          const firstRead = wrong.find((c) => c.name === "intelligence.query")!;
          const altered = capturedReadArtifactSchema.parse(firstRead.output);
          altered.items = [];
          altered.counts.matched = 0;
          firstRead.output = altered;
          assert.notDeepEqual(
            observedIntelligenceReportsFacts(caseId, wrong).facts,
            expected.facts
          );
          const foreign = capturedReadArtifactSchema.parse(
            await invoke("intelligence.query", {
              query: {
                resource: "insights",
                assessmentIds: [intelligenceReportsId(m, "foreign")],
              },
            })
          );
          assert.equal(foreign.counts.matched, 0);
          assert.deepEqual(foreign.items, []);
          assert.ok(authorized >= 2);
          assert.deepEqual(store.writesSince(audit, m), []);
          const before = calls.length;
          store.revoke(m);
          await assert.rejects(() =>
            invoke("intelligence.query", { query: { resource: "assessments" } })
          );
          assert.equal(
            calls.length,
            before,
            "Revoked actor never receives records"
          );
          t.diagnostic(
            `${caseId}: actual registry reads agree with independent SQL; no model answer or quality verdict generated`
          );
        });
      const { createProductionEveEvalAdapter } =
        await import("@/lib/evry/eve/evals/fixtures/adapter");
      const adapter = createProductionEveEvalAdapter({
        store,
        buildSha: "0".repeat(40),
        async runProduction({ scenario, registry }) {
          let call = 0;
          await retrieve(scenario.id, (name, input) =>
            registry.invoke(name, input, { callId: `intelligence-${call++}` })
          );
          return {
            answer: "Scripted query proof; model quality is not reviewed.",
            clarificationCount: 0,
            costUsd: 0,
            judge: null,
            latency: { acknowledgementMs: 0, firstTextMs: null, totalMs: 0 },
          };
        },
      });
      for (const caseId of intelligenceReportsFixtureIds)
        await t.test(`${caseId}: adapter and grade`, async () => {
          const scenario = questions.find((q) => q.id === caseId);
          assert.ok(scenario);
          const fixture = await adapter.prepare(scenario);
          assert.ok(fixture, `${caseId} adapter binding required`);
          try {
            const observation = observationSchema.parse(
              await fixture.run({
                scenario,
                signal: AbortSignal.timeout(30_000),
                maxCostUsd: 0,
              })
            );
            assert.deepEqual(
              gradeObservation(caseId, fixture.expectations, observation)
                .failures,
              ["quality_not_reviewed"]
            );
            assert.deepEqual(observation.effects, {
              domainWrites: 0,
              outboundMessages: 0,
            });
          } finally {
            await fixture.cleanup();
          }
        });
      assert.equal(outbound, 0);
    } finally {
      globalThis.fetch = originalFetch;
      neonConfig.fetchEndpoint = previous.endpoint;
      if (previous.database === undefined) delete process.env.DATABASE_URL;
      else process.env.DATABASE_URL = previous.database;
      if (previous.resend === undefined) delete process.env.RESEND_API_KEY;
      else process.env.RESEND_API_KEY = previous.resend;
      await stack.cleanup();
    }
  }
);
