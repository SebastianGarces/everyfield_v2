import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { test } from "node:test";
import { neonConfig } from "@neondatabase/serverless";
import { z } from "zod";
import { startFixtureStack } from "@/lib/evry/eve/evals/fixtures/stack";
import { createFixtureStore } from "@/lib/evry/eve/evals/fixtures/store";
import { createFixtureManifest } from "@/lib/evry/eve/evals/fixtures/manifest";
import { questions } from "@/lib/evry/eve/evals/catalog";
import { observationSchema } from "@/lib/evry/eve/evals/contract";
import { gradeObservation } from "@/lib/evry/eve/evals/grade";
import {
  capturedReadArtifactSchema,
  type CapturedCall,
} from "@/lib/evry/eve/evals/fixtures/host-capture";
import {
  bindCommunicationRetryTurns,
  communicationRetryExpectations,
  communicationRetryId,
  communicationRetryPlanReference,
  readPreparedCommunicationRetryFacts,
  seedCommunicationRetryFixture,
} from "@/lib/evry/eve/evals/fixtures/communication-retry";

test(
  "communication-06 prepares an exact failed-delivery review through the production tool registry",
  {
    skip: process.env.EVRY_EVE_COMMUNICATION_RETRY_PROOF !== "1",
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
    let outbound = 0;
    try {
      process.env.DATABASE_URL = stack.databaseUrl;
      process.env.RESEND_API_KEY = "re_isolated_no_delivery";
      neonConfig.fetchEndpoint = stack.proxyUrl;
      globalThis.fetch = async (input, init) => {
        const url = new URL(
          input instanceof Request ? input.url : String(input)
        );
        if (url.origin !== new URL(stack.proxyUrl).origin) {
          outbound++;
          throw new Error("External requests prohibited in retry fixture");
        }
        return previous.fetch(input, init);
      };
      const [
        { createEveToolRegistry },
        { createEvePreparation },
        { withAuthenticatedSessionId },
        { requireEvryPlantViewerForSession },
        { authorizeEvryReadCapabilityForSession },
        { confirmEvryActionPlan },
        { COMMUNICATION_MESSAGE_PLAN_REGISTRY },
      ] = await Promise.all([
        import("@/lib/evry/eve/capabilities/registry"),
        import("@/lib/evry/eve/preparation"),
        import("@/lib/auth/session-scope"),
        import("@/lib/evry/eligibility/viewer"),
        import("@/lib/evry/eligibility/capabilities"),
        import("@/lib/evry/plans"),
        import("@/lib/evry/capabilities/communication/messages"),
      ]);
      const store = createFixtureStore(stack.container);
      const m = createFixtureManifest("communication-06", 401);
      store.seed(m);
      seedCommunicationRetryFixture(m, store);
      assert.equal(
        store.sql(
          `select count(*) from communication_failed_retries f join communication_recipients source on source.id=f.source_recipient_id join communication_recipients child on child.id=f.retry_recipient_id where f.church_id='${m.ids.plant}' and source.person_id=child.person_id and source.email=child.email and source.id<>child.id`
        ),
        "1",
        "Historical retry preserves its source person/address and distinct delivery identity"
      );
      const expected = communicationRetryExpectations(m, store);
      const id = (key: string) => communicationRetryId(m, key);
      assert.deepEqual(
        expected.facts.sourceRecipientIds,
        [id("recipient-eligible-a"), id("recipient-eligible-b")].sort()
      );
      const actor = await requireEvryPlantViewerForSession(m.sessionId);
      const turns = bindCommunicationRetryTurns(
        m,
        questions.find((q) => q.id === m.caseId)!.turns
      );
      const authorizeRead = (
        identity: Parameters<typeof authorizeEvryReadCapabilityForSession>[0]
      ) => authorizeEvryReadCapabilityForSession(identity, m.sessionId);
      const registry = createEveToolRegistry({
        context: {
          actor,
          literalUserText: turns.join("\n"),
          pageContext: null,
          now: new Date(m.now),
        },
        authorizeRead,
        preparation: createEvePreparation({
          actor,
          conversationId: randomUUID(),
          userRequestKey: randomUUID(),
          literalUserText: turns.join("\n"),
          pageContext: null,
          now: new Date(m.now),
          authorizeRead,
        }),
      });
      const calls: CapturedCall[] = [];
      const invoke = async (name: string, input: unknown) => {
        const callId = `retry-fixture-${calls.length}`;
        const output = await withAuthenticatedSessionId(m.sessionId, () =>
          registry.invoke(name, input, { callId })
        );
        calls.push({ id: callId, name, input, output });
        return output;
      };
      const audit = store.auditStart();
      await t.test(
        "discovery reads the chosen meeting and excludes foreign delivery/source rows",
        async () => {
          const messages = capturedReadArtifactSchema.parse(
            await invoke("communication.query", {
              query: {
                resource: "messages",
                meetingIds: [m.ids["meeting-upcoming"]],
                mode: "list",
              },
            })
          );
          assert.deepEqual(
            messages.items.map((r) => r.id),
            [id("source")]
          );
          const recipients = capturedReadArtifactSchema.parse(
            await invoke("communication.query", {
              query: {
                resource: "recipients",
                messageIds: messages.items.map((r) => r.id),
                mode: "list",
              },
            })
          );
          assert.equal(recipients.counts.matched, 9);
          assert.equal(recipients.items.length, 9);
          assert.ok(
            recipients.items.some((r) => r.id === id("recipient-delivered")),
            "Reader retains authorized exclusions for explanation"
          );
          for (const forbidden of expected.absentRecordIds)
            assert.ok(!JSON.stringify(recipients).includes(forbidden));
          const full = capturedReadArtifactSchema.parse(
            await invoke("communication.get_many", {
              resource: "messages",
              ids: messages.items.map((r) => r.id),
            })
          );
          assert.deepEqual(
            full.items.map((r) => r.id),
            [id("source")]
          );
        }
      );
      let prepared: CapturedCall;
      await t.test(
        "actions.prepare persists only two eligible source deliveries and presents an unconfirmed review",
        async () => {
          await invoke("actions.prepare", {
            request: {
              operation: "communication.retry_failed",
              arguments: { communicationId: id("source") },
            },
          });
          prepared = calls.at(-1)!;
          const observed = await readPreparedCommunicationRetryFacts({
            manifest: m,
            store,
            calls,
            presented: new Set([prepared.id]),
          });
          assert.deepEqual(observed.facts, expected.facts);
          assert.deepEqual(observed.evidence, expected.requiredEvidence);
          assert.equal(
            Number(
              store.sql("select count(*) from communication_failed_retries")
            ),
            1,
            "Only the historical seed claim exists"
          );
          assert.equal(
            Number(store.sql("select count(*) from evry_plan_confirmations")),
            0
          );
          assert.equal(
            Number(
              store.sql(
                `select count(*) from communications where church_id='${m.ids.plant}'`
              )
            ),
            2
          );
        }
      );
      await t.test(
        "wrong person IDs, ineligible delivery IDs and another source refuse rather than silently change recipients",
        async () => {
          for (const args of [
            {
              communicationId: id("source"),
              recipientIds: [id("person-eligible-a")],
            },
            {
              communicationId: id("source"),
              recipientIds: [
                id("recipient-eligible-a"),
                id("recipient-delivered"),
              ],
            },
            {
              communicationId: id("source"),
              recipientIds: [id("recipient-other-meeting")],
            },
            {
              communicationId: id("source"),
              recipientIds: [id("recipient-claimed")],
            },
            { communicationId: id("foreign-source") },
          ]) {
            await invoke("actions.prepare", {
              request: {
                operation: "communication.retry_failed",
                arguments: args,
              },
            });
            assert.equal(
              communicationRetryPlanReference(
                [calls.at(-1)!],
                new Set([calls.at(-1)!.id])
              ),
              null
            );
          }
          assert.deepEqual(
            (
              await readPreparedCommunicationRetryFacts({
                manifest: m,
                store,
                calls,
                presented: new Set([prepared.id]),
              })
            ).facts,
            {}
          );
        }
      );
      await t.test(
        "exact fingerprint, actor, confirmation and expiration are required for plan evidence",
        async () => {
          const presented = new Set([prepared.id]);
          const ref = communicationRetryPlanReference([prepared], presented)!;
          const forged = structuredClone(prepared);
          const output = z
            .object({
              activePlan: z.object({
                plan: z.object({ planId: z.string(), fingerprint: z.string() }),
              }),
            })
            .parse(forged.output);
          output.activePlan.plan.fingerprint = "0".repeat(64);
          forged.output = {
            ...(prepared.output as object),
            activePlan: { mode: "set", plan: output.activePlan.plan },
          };
          assert.deepEqual(
            (
              await readPreparedCommunicationRetryFacts({
                manifest: m,
                store,
                calls: [forged],
                presented,
              })
            ).facts,
            {}
          );
          assert.deepEqual(
            (
              await readPreparedCommunicationRetryFacts({
                manifest: {
                  ...m,
                  ids: { ...m.ids, actor: m.ids["other-actor"] },
                },
                store,
                calls: [prepared],
                presented,
              })
            ).facts,
            {}
          );
          assert.deepEqual(
            (
              await readPreparedCommunicationRetryFacts({
                manifest: { ...m, now: "2099-01-01T00:00:00.000Z" },
                store,
                calls: [prepared],
                presented,
              })
            ).facts,
            {}
          );
          const denied = await withAuthenticatedSessionId(m.sessionId, () =>
            confirmEvryActionPlan({
              actor,
              planId: ref.planId,
              fingerprint: "0".repeat(64),
              decidedAt: new Date(),
              registry: COMMUNICATION_MESSAGE_PLAN_REGISTRY,
            })
          );
          assert.notEqual(denied.status, "confirmed");
          assert.equal(
            Number(store.sql("select count(*) from evry_plan_confirmations")),
            0
          );
        }
      );
      assert.deepEqual(store.writesSince(audit, m), []);
      await t.test(
        "fresh permission loss prevents a new retry review",
        async () => {
          const oldSeat = z
            .string()
            .parse(
              store.query(
                `select seat from users where id='${m.ids.actor}'`
              )[0]!.seat
            );
          store.sql(`update users set seat='member' where id='${m.ids.actor}'`);
          const permissionAudit = store.auditStart();
          try {
            await invoke("actions.prepare", {
              request: {
                operation: "communication.retry_failed",
                arguments: { communicationId: id("source") },
              },
            });
            const last = calls.at(-1)!;
            assert.equal(
              communicationRetryPlanReference([last], new Set([last.id])),
              null
            );
            assert.deepEqual(store.writesSince(permissionAudit, m), []);
          } finally {
            store.sql(
              `update users set seat='${oldSeat}' where id='${m.ids.actor}'`
            );
          }
        }
      );
      await t.test(
        "actual eval adapter grades persisted review and rejects an unshown or wrong-source plan",
        async () => {
          const { createProductionEveEvalAdapter } =
            await import("@/lib/evry/eve/evals/fixtures/adapter");
          let variant: "correct" | "unshown" | "wrong-source" = "correct";
          const sessions: string[] = [];
          const adapter = createProductionEveEvalAdapter({
            store,
            buildSha: "0".repeat(40),
            async runProduction({
              scenario,
              registry,
              onPresentResult,
              sessionId,
            }) {
              sessions.push(sessionId);
              assert.equal(
                scenario.turns[0],
                "Resend only the failed invitations from that meeting."
              );
              assert.equal(scenario.turns.length, 2);
              const meetingSelection = scenario.turns[1];
              assert.ok(
                typeof meetingSelection === "string",
                "Retry fixture requires an explicit text meeting selection"
              );
              const meetingId = z
                .uuid()
                .parse(meetingSelection.match(/\/meetings\/([a-f0-9-]+)/)?.[1]);
              const found = capturedReadArtifactSchema.parse(
                await registry.invoke(
                  "communication.query",
                  {
                    query: {
                      resource: "messages",
                      meetingIds: [meetingId],
                      mode: "list",
                    },
                  },
                  { callId: "adapter-source" }
                )
              );
              assert.equal(found.items.length, 1);
              let sourceId = found.items[0]!.id;
              if (variant === "wrong-source") {
                const all = capturedReadArtifactSchema.parse(
                  await registry.invoke(
                    "communication.query",
                    { query: { resource: "messages", mode: "list" } },
                    { callId: "adapter-wrong-source" }
                  )
                );
                sourceId = all.items.find((row) => row.id !== sourceId)!.id;
              }
              await registry.invoke(
                "communication.query",
                {
                  query: {
                    resource: "recipients",
                    messageIds: [sourceId],
                    mode: "list",
                  },
                },
                { callId: "adapter-recipients" }
              );
              await registry.invoke(
                "communication.get_many",
                { resource: "messages", ids: [sourceId] },
                { callId: "adapter-content" }
              );
              await registry.invoke(
                "actions.prepare",
                {
                  request: {
                    operation: "communication.retry_failed",
                    arguments: { communicationId: sourceId },
                  },
                },
                { callId: "adapter-prepare" }
              );
              if (variant !== "unshown") onPresentResult("adapter-prepare");
              return {
                eveSessionId: sessionId,
                answer:
                  "Scripted preparation proof; answer quality not reviewed.",
                clarificationCount: 1,
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
          const scenario = questions.find((q) => q.id === "communication-06")!;
          const fixture = await adapter.prepare(scenario);
          assert.ok(fixture);
          try {
            for (const mode of [
              "correct",
              "unshown",
              "wrong-source",
            ] as const) {
              variant = mode;
              const result = observationSchema.parse(
                await fixture.run({
                  scenario,
                  signal: AbortSignal.timeout(30_000),
                  maxCostUsd: 0.1,
                })
              );
              const failures: readonly string[] = gradeObservation(
                scenario.id,
                fixture.expectations,
                result
              ).failures;
              assert.deepEqual(result.effects, {
                domainWrites: 0,
                outboundMessages: 0,
              });
              assert.equal(result.judge, null);
              assert.equal(result.costUsd, 0);
              if (mode === "correct")
                assert.deepEqual(
                  failures,
                  ["quality_not_reviewed"],
                  JSON.stringify(result.facts)
                );
              else
                assert.ok(
                  failures.some((f) => f.startsWith("fact:")),
                  JSON.stringify(failures)
                );
            }
          } finally {
            await fixture.cleanup();
          }
          for (const sessionId of new Set(sessions))
            assert.equal(
              store.sql(
                `select count(*) from sessions where id='${sessionId}'`
              ),
              "0"
            );
        }
      );
      assert.equal(outbound, 0);
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
