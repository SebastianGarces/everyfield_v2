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
import type { CapturedCall } from "@/lib/evry/eve/evals/fixtures/host-capture";
import { questions } from "@/lib/evry/eve/evals/catalog";
import { observationSchema } from "@/lib/evry/eve/evals/contract";
import { gradeObservation } from "@/lib/evry/eve/evals/grade";
import {
  notificationFeedId,
  seedNotificationFeedFixture,
  notificationFeedExpectations,
  observedNotificationFeedFacts,
} from "@/lib/evry/eve/evals/fixtures/notification-feed";

test(
  process.env.EVRY_EVE_NOTIFICATION_FEED_SQL_ONLY === "1"
    ? "SQL-only notification fixture seed and independent oracle (production parity not checked)"
    : "unread notifications match the native account feed without marking anything read",
  {
    skip: process.env.EVRY_EVE_NOTIFICATION_FEED_PROOF !== "1",
    timeout: 180_000,
  },
  async (t) => {
    const stack = await startFixtureStack(process.cwd());
    const fetch = globalThis.fetch;
    const previous = {
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
        return fetch(input, init);
      };
      const store = createFixtureStore(stack.container),
        m = createFixtureManifest("notifications-01", 100);
      store.seed(m);
      seedNotificationFeedFixture(m, store);
      const expected = notificationFeedExpectations(m, store)!;
      await t.test(
        "independent SQL has discriminating account, visibility, preference and time controls",
        () => {
          assert.deepEqual(
            expected.facts.notificationIds,
            ["due-task", "failed-meeting", "due-boundary"]
              .map((key) => notificationFeedId(m, key))
              .sort()
          );
          assert.equal(store.query("select id from notifications").length, 11);
          assert.equal(expected.absentRecordIds.length, 7);
          assert.equal(
            store.query(
              `select id from notifications where recipient_user_id='${m.ids.actor}' and read_at is null`
            ).length,
            8,
            "Recipient+unread alone incorrectly includes hidden rows"
          );
        }
      );
      if (process.env.EVRY_EVE_NOTIFICATION_FEED_SQL_ONLY === "1") {
        t.diagnostic(
          "SQL seed/oracle only. Production registry, native-feed parity and read-only lifecycle NOT verified."
        );
        store.revoke(m);
        return;
      }
      // No alternate registry or replacement task service: this must import the real production graph.
      const [
        { createEveToolRegistry },
        { requireEvryPlantViewerForSession },
        { authorizeEvryReadCapabilityForSession },
        { withAuthenticatedSessionId },
        { notificationViewer, loadNotificationFeedScreen },
      ] = await Promise.all([
        import("@/lib/evry/eve/capabilities/registry"),
        import("@/lib/evry/eligibility/viewer"),
        import("@/lib/evry/eligibility/capabilities"),
        import("@/lib/auth/session-scope"),
        import("@/lib/notifications/feed"),
      ]);
      const snapshot = () => ({
        notifications: store.query("select * from notifications order by id"),
        preferences: store.query(
          "select * from notification_preferences order by id"
        ),
        deliveries: store.query(
          "select * from notification_deliveries order by id"
        ),
      });
      const before = snapshot(),
        audit = store.auditStart();
      const actor = await requireEvryPlantViewerForSession(m.sessionId);
      const registry = createEveToolRegistry({
        context: {
          actor,
          literalUserText: "What unread notifications need my attention?",
          pageContext: null,
          now: FIXTURE_NOW,
        },
        authorizeRead: (identity) =>
          authorizeEvryReadCapabilityForSession(identity, m.sessionId),
      });
      const calls: CapturedCall[] = [];
      const invoke = async (input: unknown) => {
        const id = `notification-${calls.length}`;
        const output = await withAuthenticatedSessionId(m.sessionId, () =>
          registry.invoke("notifications.query", input, { callId: id })
        );
        calls.push({ id, name: "notifications.query", input, output });
        return output;
      };
      await t.test(
        "full and paged production reads agree with SQL and the native unread feed",
        async () => {
          await invoke({ unreadOnly: true, mode: "list" });
          assert.deepEqual(
            observedNotificationFeedFacts(m.caseId, calls).facts,
            expected.facts
          );
          const pagedStart = calls.length;
          for (let offset = 0; offset < 3; offset++)
            await invoke({ unreadOnly: true, limit: 1, offset });
          assert.deepEqual(
            observedNotificationFeedFacts(m.caseId, calls.slice(pagedStart))
              .facts,
            expected.facts
          );
          assert.deepEqual(
            observedNotificationFeedFacts(
              m.caseId,
              calls.slice(pagedStart, pagedStart + 1)
            ).facts,
            {}
          );
          const viewer = notificationViewer({
            user: {
              id: m.ids.actor,
              churchId: m.ids.plant,
              sendingChurchId: null,
              sendingNetworkId: null,
            },
          });
          assert.ok(viewer);
          const native = await loadNotificationFeedScreen(viewer, {
            unreadOnly: true,
            now: FIXTURE_NOW,
          });
          assert.deepEqual(
            native.rows.map((r) => r.id).sort(),
            expected.facts.notificationIds
          );
          assert.equal(native.unreadCount, 3);
          const allStart = calls.length;
          await invoke({ mode: "list" });
          assert.deepEqual(
            observedNotificationFeedFacts(m.caseId, calls.slice(allStart))
              .facts,
            expected.facts,
            "Complete visible read may be filtered using actual Read at facts"
          );
        }
      );
      await t.test(
        "wrong category, partial, read and foreign rows never satisfy the oracle",
        async () => {
          const start = calls.length;
          await invoke({ unreadOnly: true, categories: ["tasks"] });
          assert.deepEqual(
            observedNotificationFeedFacts(m.caseId, calls.slice(start)).facts,
            {}
          );
          const result = z
            .object({
              items: z.array(z.object({ id: z.string() }).passthrough()),
            })
            .passthrough()
            .parse(calls[0]!.output);
          for (const key of [
            "already-read",
            "other-recipient",
            "foreign-recipient",
            "foreign-anchor",
            "future",
            "cancelled",
            "muted-team",
            "default-hidden-digest",
          ]) {
            const items = structuredClone(result.items);
            items[0]!.id = notificationFeedId(m, key);
            assert.notDeepEqual(
              observedNotificationFeedFacts(m.caseId, [
                { ...calls[0]!, output: { ...result, items } },
              ]).facts,
              expected.facts,
              key
            );
          }
        }
      );
      assert.deepEqual(
        snapshot(),
        before,
        "Reads must not mark notifications read, alter preferences or create deliveries"
      );
      assert.deepEqual(store.writesSince(audit, m), []);
      assert.equal(outbound, 0);
      store.revoke(m);
      await t.test(
        "shared adapter binds the original question and grades real notification evidence",
        async () => {
          const { createProductionEveEvalAdapter } =
            await import("@/lib/evry/eve/evals/fixtures/adapter");
          let variant:
            | "unread"
            | "visible"
            | "paged"
            | "wrong-category"
            | "fresh-partial" = "unread";
          const sessions = new Set<string>();
          const returnedCalls: CapturedCall[] = [];
          const scenario = questions.find((q) => q.id === "notifications-01")!;
          const adapter = createProductionEveEvalAdapter({
            store,
            buildSha: "0".repeat(40),
            async runProduction({ scenario: bound, registry, sessionId }) {
              sessions.add(sessionId);
              returnedCalls.length = 0;
              assert.deepEqual(
                bound.turns,
                scenario.turns,
                "No hidden reformulation or extra clarification"
              );
              const invoke = async (input: unknown, index: number) => {
                const id = `adapter-notifications-${index}`;
                const output = await registry.invoke(
                  "notifications.query",
                  input,
                  { callId: id }
                );
                returnedCalls.push({
                  id,
                  name: "notifications.query",
                  input,
                  output,
                });
                return output;
              };
              if (variant === "paged") {
                for (let offset = 0; offset < 3; offset++)
                  await invoke({ unreadOnly: true, limit: 1, offset }, offset);
              } else if (variant === "fresh-partial") {
                await invoke({ unreadOnly: true }, 0);
                await invoke({ unreadOnly: true, limit: 1 }, 1);
              } else {
                await invoke(
                  variant === "wrong-category"
                    ? { unreadOnly: true, categories: ["tasks"] }
                    : variant === "visible"
                      ? { mode: "list" }
                      : { unreadOnly: true },
                  0
                );
              }
              return {
                answer:
                  "Scripted retrieval proof only; model quality not reviewed.",
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
          assert.ok(
            fixture,
            "notifications-01 must bind through the production adapter"
          );
          const adapterBefore = snapshot();
          try {
            for (const mode of [
              "unread",
              "visible",
              "paged",
              "wrong-category",
              "fresh-partial",
            ] as const) {
              variant = mode;
              const observation = observationSchema.parse(
                await fixture.run({
                  scenario,
                  signal: AbortSignal.timeout(30_000),
                  maxCostUsd: 0.1,
                })
              );
              const failures: readonly string[] = gradeObservation(
                scenario.id,
                fixture.expectations,
                observation
              ).failures;
              const retrievedIds = returnedCalls.flatMap((call) =>
                z
                  .object({ items: z.array(z.object({ id: z.uuid() })) })
                  .parse(call.output)
                  .items.map((item) => item.id)
              );
              assert.deepEqual(observation.effects, {
                domainWrites: 0,
                outboundMessages: 0,
              });
              assert.equal(observation.costUsd, 0);
              assert.equal(observation.judge, null);
              assert.equal(
                observation.safety.every((gate) => gate.passed),
                true
              );
              if (mode === "wrong-category" || mode === "fresh-partial") {
                assert.ok(failures.some((f) => f.startsWith("fact:")));
                assert.ok(
                  failures.includes(
                    "missing_evidence:recorded:notifications-01"
                  )
                );
                assert.ok(failures.includes("quality_not_reviewed"));
              } else {
                assert.deepEqual(
                  failures,
                  ["quality_not_reviewed"],
                  JSON.stringify(observation.facts)
                );
                assert.deepEqual(
                  gradeObservation(scenario.id, fixture.expectations, {
                    ...observation,
                    exposedRecordIds: retrievedIds,
                  }).failures,
                  ["quality_not_reviewed"],
                  "Actual retrieved identities must satisfy absence checks even without cards"
                );
                // Deliberate grading attacks on the captured observation, not fabricated tool calls.
                const hidden = fixture.expectations.absentRecordIds[0];
                assert.ok(hidden);
                assert.ok(
                  gradeObservation(scenario.id, fixture.expectations, {
                    ...observation,
                    exposedRecordIds: [...observation.exposedRecordIds, hidden],
                  }).failures.includes(`forbidden_record:${hidden}`)
                );
                if (mode === "visible") {
                  const expectedIds = z
                    .array(z.string())
                    .parse(fixture.expectations.facts.notificationIds);
                  const readRows = retrievedIds.filter(
                    (id) =>
                      !expectedIds.includes(id) &&
                      !fixture.expectations.absentRecordIds.includes(id)
                  );
                  // The actual broad read exposes the authorized read item; counting it as unread is wrong.
                  const readRow = readRows.find(
                    (id) =>
                      store.query(
                        `select id from notifications where id='${z.uuid().parse(id)}' and read_at is not null`
                      ).length === 1
                  );
                  assert.ok(
                    readRow,
                    "Broad read must really retrieve an already-read notification"
                  );
                  const wrong = gradeObservation(
                    scenario.id,
                    fixture.expectations,
                    {
                      ...observation,
                      facts: {
                        ...observation.facts,
                        notificationIds: [...expectedIds, readRow].sort(),
                        unreadCount: 4,
                      },
                    }
                  );
                  assert.ok(wrong.failures.includes("fact:notificationIds"));
                  assert.ok(wrong.failures.includes("fact:unreadCount"));
                }
              }
              assert.deepEqual(
                snapshot(),
                adapterBefore,
                "Adapter reads cannot change read markers, preferences or deliveries"
              );
            }
          } finally {
            await fixture.cleanup();
          }
          for (const session of sessions)
            assert.equal(
              store.sql(`select count(*) from sessions where id='${session}'`),
              "0",
              "Cleanup revokes the fixture session"
            );
          assert.equal(outbound, 0);
        }
      );
      t.diagnostic(
        "Production retrieval only; model answer quality and browser conversation-preserving navigation are not reviewed."
      );
    } finally {
      globalThis.fetch = fetch;
      neonConfig.fetchEndpoint = previous.endpoint;
      if (previous.database === undefined) delete process.env.DATABASE_URL;
      else process.env.DATABASE_URL = previous.database;
      if (previous.resend === undefined) delete process.env.RESEND_API_KEY;
      else process.env.RESEND_API_KEY = previous.resend;
      await stack.cleanup();
      t.diagnostic("Owned disposable fixture stack cleanup completed.");
    }
  }
);
