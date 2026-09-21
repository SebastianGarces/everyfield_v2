import assert from "node:assert/strict";
import { test } from "node:test";
import { neonConfig } from "@neondatabase/serverless";
import { z } from "zod";
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
import { selectCases } from "@/lib/evry/eve/evals/catalog";
import { observationSchema } from "@/lib/evry/eve/evals/contract";
import { gradeObservation } from "@/lib/evry/eve/evals/grade";
import {
  communicationDeliveryFixtureIds,
  communicationDeliveryId,
  communicationDeliveryWindow,
  seedCommunicationDeliveryFixture,
  communicationDeliveryExpectations,
  observedCommunicationDeliveryFacts,
} from "@/lib/evry/eve/evals/fixtures/communication-delivery";

/** The direct and adapter proofs execute the same retrieval plan; no expected IDs enter it. */
async function retrieve(
  caseId: string,
  invoke: (
    name: string,
    input: unknown
  ) => Promise<z.infer<typeof capturedReadArtifactSchema>>
) {
  if (caseId === "communication-01") {
    const meetings = await invoke("meetings.query", {
      where: {
        all: [
          {
            date: { kind: "range", from: "2026-09-13", through: "2026-09-13" },
          },
        ],
      },
      query: { mode: "list" },
    });
    await invoke("communication.query", {
      query: {
        resource: "recipients",
        meetingIds: meetings.items.map((i) => i.id),
      },
    });
  } else if (caseId === "communication-02") {
    await invoke("communication.query", {
      query: {
        resource: "recipients",
        deliveryStatuses: ["failed", "bounced"],
      },
    });
    await invoke("attendance.query", { result: { mode: "list", limit: 50 } });
  } else if (caseId === "communication-03") {
    const people = await invoke("people.query", {
      cohort: { anyOf: [{ search: "Alex" }, { search: "Jordan" }] },
      result: { mode: "list", limit: 50 },
    });
    await invoke("communication.query", {
      query: {
        resource: "messages",
        personIds: people.items.map((i) => i.id),
        statuses: ["sent"],
        timeField: "sent",
        window: communicationDeliveryWindow,
      },
    });
  } else {
    const templates = await invoke("communication.query", {
      query: {
        resource: "templates",
        search: "orientation",
        category: "meeting_invitation",
      },
    });
    await invoke("communication.get_many", {
      resource: "templates",
      ids: templates.items.map((i) => i.id),
    });
  }
}

test(
  "communication delivery, RSVP joins, sent history and complete templates use authorized production queries",
  {
    skip: process.env.EVRY_EVE_COMMUNICATION_DELIVERY_PROOF !== "1",
    timeout: 180_000,
  },
  async (t) => {
    const stack = await startFixtureStack(process.cwd());
    const original = {
      fetch: globalThis.fetch,
      database: process.env.DATABASE_URL,
      resend: process.env.RESEND_API_KEY,
      endpoint: neonConfig.fetchEndpoint,
    };
    let outbound = 0;
    try {
      process.env.DATABASE_URL = stack.databaseUrl;
      process.env.RESEND_API_KEY = "re_fixture_no_send";
      neonConfig.fetchEndpoint = stack.proxyUrl;
      globalThis.fetch = async (input, init) => {
        const url = new URL(
          input instanceof Request ? input.url : String(input)
        );
        if (url.origin !== new URL(stack.proxyUrl).origin) {
          outbound++;
          throw new Error("Only isolated SQL requests are allowed");
        }
        return original.fetch(input, init);
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
      for (const caseId of communicationDeliveryFixtureIds)
        await t.test(caseId, async () => {
          const m = createFixtureManifest(caseId, 100),
            id = (key: string) => communicationDeliveryId(m, key);
          store.seed(m);
          seedCommunicationDeliveryFixture(m, store);
          const expected = communicationDeliveryExpectations(m, store)!;
          const actor = await requireEvryPlantViewerForSession(m.sessionId);
          const registry = createEveToolRegistry({
            context: {
              actor,
              literalUserText: selectCases("full").find((q) => q.id === caseId)!
                .turns[0]!,
              pageContext: null,
              now: FIXTURE_NOW,
            },
            authorizeRead: (identity) =>
              authorizeEvryReadCapabilityForSession(identity, m.sessionId),
          });
          const calls: CapturedCall[] = [];
          const invoke = async (name: string, input: unknown) => {
            const callId = `delivery-${calls.length}`;
            const output = await withAuthenticatedSessionId(m.sessionId, () =>
              registry.invoke(name, input, { callId })
            );
            calls.push({ id: callId, name, input, output });
            return capturedReadArtifactSchema.parse(output);
          };
          const audit = store.auditStart();
          const snapshot = () =>
            store.query(
              `select id,status,sent_at from communications where church_id in ('${m.ids.plant}','${m.ids["foreign-plant"]}') order by id`
            );
          const before = snapshot();
          await retrieve(caseId, invoke);
          if (caseId === "communication-01") {
            const query = {
              resource: "recipients",
              meetingIds: [id("sunday")],
            };
            assert.deepEqual(
              observedCommunicationDeliveryFacts(caseId, calls).facts,
              expected.facts
            );
            const paged = calls.length;
            for (let offset = 0; offset < 7; offset++)
              await invoke("communication.query", {
                query: { ...query, limit: 1, offset },
              });
            assert.deepEqual(
              observedCommunicationDeliveryFacts(caseId, [
                calls[0]!,
                ...calls.slice(paged),
              ]).facts,
              expected.facts
            );
            assert.deepEqual(
              observedCommunicationDeliveryFacts(caseId, [
                calls[0]!,
                calls[paged]!,
              ]).facts,
              {}
            );
            await invoke("communication.query", {
              query: { ...query, mode: "group", groupBy: "status" },
            });
            assert.deepEqual(
              observedCommunicationDeliveryFacts(caseId, calls).facts,
              expected.facts
            );
            await invoke("communication.query", {
              query: { ...query, deliveryStatuses: ["delivered", "opened"] },
            });
            assert.notDeepEqual(
              observedCommunicationDeliveryFacts(caseId, calls).facts,
              expected.facts,
              "Delivery-only excludes accepted, unknown and failed states"
            );
            const wrong = await invoke("communication.query", {
              query: {
                resource: "recipients",
                meetingIds: [id("other-meeting")],
              },
            });
            assert.equal(wrong.counts.matched, 1);
            assert.deepEqual(
              observedCommunicationDeliveryFacts(caseId, calls).facts,
              {}
            );
          } else if (caseId === "communication-02") {
            const failures = calls[0]!;
            assert.deepEqual(
              observedCommunicationDeliveryFacts(caseId, calls).facts,
              expected.facts
            );
            assert.equal(
              z.array(z.string()).parse(expected.facts.unansweredFailures)
                .length,
              2
            );
            const attendance = calls[1]!;
            const failedItems = capturedReadArtifactSchema.parse(
              failures.output
            ).items;
            const personIds = failedItems.map(
              (i) => i.facts!.find((f) => f.label === "Person ID")!.value
            );
            const scoped = {
              cohort: { all: { personIds } },
              meetingIds: [id("sunday")],
              result: { mode: "list", limit: 1 },
            };
            const scopedStart = calls.length;
            let afterId: string | undefined;
            do {
              const result = await invoke("attendance.query", {
                ...scoped,
                result: { ...scoped.result, ...(afterId ? { afterId } : {}) },
              });
              afterId = result.items.at(-1)?.id;
              if (
                result.items.length === 0 ||
                calls
                  .slice(scopedStart)
                  .flatMap(
                    (c) => capturedReadArtifactSchema.parse(c.output).items
                  ).length === result.counts.matched
              )
                break;
            } while (afterId);
            assert.deepEqual(
              observedCommunicationDeliveryFacts(caseId, [
                failures,
                ...calls.slice(scopedStart),
              ]).facts,
              expected.facts,
              "Complete scoped RSVP batch preserves missing-row evidence"
            );
            assert.deepEqual(
              observedCommunicationDeliveryFacts(caseId, [
                failures,
                calls[scopedStart]!,
              ]).facts,
              {},
              "One attendance page is not absence evidence"
            );
            await invoke("attendance.query", {
              rsvp: ["confirmed"],
              result: { mode: "list", limit: 50 },
            });
            assert.deepEqual(
              observedCommunicationDeliveryFacts(caseId, [
                failures,
                calls.at(-1)!,
              ]).facts,
              {}
            );
            await invoke("communication.query", {
              query: { resource: "recipients", deliveryStatuses: ["failed"] },
            });
            assert.notDeepEqual(
              observedCommunicationDeliveryFacts(caseId, [
                calls.at(-1)!,
                attendance,
              ]).facts,
              expected.facts,
              "Bounced unresponded invitee must not disappear"
            );
            const raw = capturedReadArtifactSchema.parse(failures.output);
            assert.ok(
              raw.items.some((i) =>
                i.facts?.some(
                  (f) =>
                    f.label === "Delivery failure confirmed" &&
                    f.value === "true"
                )
              ),
              "Provider provenance remains available; not all failures imply retry eligibility"
            );
          } else if (caseId === "communication-03") {
            const people = calls[0]!;
            const selected = capturedReadArtifactSchema
              .parse(people.output)
              .items.map((i) => i.id);
            assert.equal(selected.length, 2);
            const query = {
              resource: "messages",
              personIds: selected,
              statuses: ["sent"],
              timeField: "sent",
              window: communicationDeliveryWindow,
            };
            assert.deepEqual(
              observedCommunicationDeliveryFacts(caseId, calls).facts,
              expected.facts
            );
            const paged = calls.length;
            for (let offset = 0; offset < 4; offset++)
              await invoke("communication.query", {
                query: { ...query, limit: 1, offset },
              });
            assert.deepEqual(
              observedCommunicationDeliveryFacts(caseId, [
                people,
                ...calls.slice(paged),
              ]).facts,
              expected.facts
            );
            const wrong = await invoke("communication.query", {
              query: { ...query, timeField: "created" },
            });
            assert.equal(
              wrong.counts.matched,
              5,
              "Creation time includes an older historical send"
            );
            assert.deepEqual(
              observedCommunicationDeliveryFacts(caseId, calls).facts,
              {}
            );
            await invoke("communication.query", {
              query: { ...query, personIds: [m.ids["core-alex"]] },
            });
            assert.deepEqual(
              observedCommunicationDeliveryFacts(caseId, calls).facts,
              {}
            );
          } else {
            const search = capturedReadArtifactSchema.parse(calls[0]!.output);
            assert.deepEqual(
              search.items.map((i) => i.id),
              [m.ids["orientation-template"]],
              "Local fork hides global original and foreign template"
            );
            assert.deepEqual(
              observedCommunicationDeliveryFacts(caseId, calls.slice(0, 1))
                .facts,
              {},
              "Search metadata is not the full template"
            );
            assert.deepEqual(
              observedCommunicationDeliveryFacts(caseId, calls).facts,
              expected.facts
            );
            const hidden = await invoke("communication.get_many", {
              resource: "templates",
              ids: [id("system-template"), id("foreign-template")],
            });
            assert.equal(hidden.items.length, 0);
            assert.deepEqual(
              observedCommunicationDeliveryFacts(caseId, calls).facts,
              {}
            );
          }
          const foreign = await invoke("communication.query", {
            query: {
              resource: "recipients",
              messageIds: [id("foreign-invitation")],
            },
          });
          assert.equal(foreign.counts.matched, 0);
          assert.deepEqual(snapshot(), before);
          assert.deepEqual(store.writesSince(audit, m), []);
          store.revoke(m);
          await assert.rejects(
            () =>
              withAuthenticatedSessionId(m.sessionId, () =>
                registry.invoke(
                  "communication.query",
                  { query: { resource: "messages" } },
                  { callId: "revoked" }
                )
              ),
            { name: "UnauthorizedError", digest: "EF_SESSION_EXPIRED" }
          );
          assert.equal(outbound, 0);
        });
      const { createProductionEveEvalAdapter } =
        await import("@/lib/evry/eve/evals/fixtures/adapter");
      for (const caseId of communicationDeliveryFixtureIds)
        await t.test(`${caseId} production adapter`, async () => {
          const scenario = selectCases("full").find((q) => q.id === caseId)!;
          const manifest = createFixtureManifest(caseId, 0);
          let incomplete = false;
          const sessions = new Set<string>(),
            captured: CapturedCall[] = [];
          const adapter = createProductionEveEvalAdapter({
            store,
            buildSha: "0".repeat(40),
            async runProduction({ scenario: bound, registry, sessionId }) {
              assert.deepEqual(
                bound.turns,
                scenario.turns,
                "Original question is preserved"
              );
              sessions.add(sessionId);
              captured.length = 0;
              const invoke = async (name: string, input: unknown) => {
                const callId = `adapter-delivery-${captured.length}`,
                  output = await registry.invoke(name, input, { callId });
                captured.push({ id: callId, name, input, output });
                return capturedReadArtifactSchema.parse(output);
              };
              await retrieve(caseId, invoke);
              if (incomplete) {
                if (
                  caseId === "communication-04" ||
                  caseId === "regression-template-placeholders"
                )
                  await invoke("communication.get_many", {
                    resource: "templates",
                    ids: [
                      communicationDeliveryId(manifest, "foreign-template"),
                    ],
                  });
                else {
                  const latest = captured.findLast(
                    (c) => c.name === "communication.query"
                  )!;
                  const input = z
                    .object({ query: z.record(z.string(), z.unknown()) })
                    .parse(latest.input);
                  await invoke("communication.query", {
                    query: { ...input.query, limit: 1, offset: 0 },
                  });
                }
              }
              return {
                answer:
                  "Scripted production retrieval only; no model quality judgment.",
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
          const fixture = await adapter.prepare(scenario);
          assert.ok(fixture, "Case must be bound by the real adapter");
          assert.deepEqual(
            fixture.expectations.facts,
            communicationDeliveryExpectations(manifest, store)!.facts,
            "Prepared adapter truth comes from independently authored SQL"
          );
          try {
            for (const partial of [false, true]) {
              incomplete = partial;
              const observation = observationSchema.parse(
                await fixture.run({
                  scenario,
                  signal: AbortSignal.timeout(30_000),
                  maxCostUsd: 0.1,
                })
              );
              const grade = gradeObservation(
                caseId,
                fixture.expectations,
                observation
              );
              assert.equal(observation.judge, null);
              assert.equal(observation.costUsd, 0);
              assert.deepEqual(observation.effects, {
                domainWrites: 0,
                outboundMessages: 0,
              });
              assert.ok(observation.safety.every((gate) => gate.passed));
              assert.ok(grade.failures.includes("quality_not_reviewed"));
              assert.equal(
                grade.status,
                "failed",
                "Tool truth cannot claim reviewed model quality"
              );
              if (partial)
                assert.ok(
                  grade.failures.some((f) => f.startsWith("fact:")),
                  "Fresh incomplete or unavailable evidence invalidates prior complete source"
                );
              else {
                assert.deepEqual(grade.failures, ["quality_not_reviewed"]);
                const exposed = captured.flatMap((c) =>
                  capturedReadArtifactSchema
                    .parse(c.output)
                    .items.map((i) => i.id)
                );
                assert.deepEqual(
                  gradeObservation(caseId, fixture.expectations, {
                    ...observation,
                    exposedRecordIds: exposed,
                  }).failures,
                  ["quality_not_reviewed"]
                );
                const forbidden = fixture.expectations.absentRecordIds[0]!;
                assert.ok(
                  gradeObservation(caseId, fixture.expectations, {
                    ...observation,
                    exposedRecordIds: [...exposed, forbidden],
                  }).failures.includes(`forbidden_record:${forbidden}`)
                );
              }
            }
          } finally {
            await fixture.cleanup();
          }
          for (const session of sessions)
            assert.equal(
              store.sql(
                `select count(*) from sessions where id='${z
                  .string()
                  .regex(/^[a-f0-9]+$/)
                  .parse(session)}'`
              ),
              "0"
            );
          assert.equal(outbound, 0);
        });
    } finally {
      globalThis.fetch = original.fetch;
      neonConfig.fetchEndpoint = original.endpoint;
      if (original.database === undefined) delete process.env.DATABASE_URL;
      else process.env.DATABASE_URL = original.database;
      if (original.resend === undefined) delete process.env.RESEND_API_KEY;
      else process.env.RESEND_API_KEY = original.resend;
      await stack.cleanup();
    }
  }
);
