import assert from "node:assert/strict";
import { test } from "node:test";
import { neonConfig } from "@neondatabase/serverless";
import { z } from "zod";
import { questions } from "@/lib/evry/eve/evals/catalog";
import { startFixtureStack } from "@/lib/evry/eve/evals/fixtures/stack";
import { createFixtureStore } from "@/lib/evry/eve/evals/fixtures/store";
import {
  createFixtureManifest,
  FIXTURE_NOW,
} from "@/lib/evry/eve/evals/fixtures/manifest";
import {
  relationalFixtureIds,
  seedRelationalFixture,
  relationalExpectations,
  observedRelationalFacts,
} from "@/lib/evry/eve/evals/fixtures/relational";
import {
  capturedReadArtifactSchema,
  type CapturedCall,
} from "@/lib/evry/eve/evals/fixtures/host-capture";

test(
  "original relational questions use authorized production reads against independent SQL truth",
  { skip: process.env.EVRY_EVE_RELATIONAL_PROOF !== "1", timeout: 180_000 },
  async (t) => {
    const stack = await startFixtureStack(process.cwd());
    const originalFetch = globalThis.fetch;
    let outboundAttempts = 0;
    try {
      process.env.DATABASE_URL = stack.databaseUrl;
      process.env.RESEND_API_KEY = "re_eve_fixture_never_sent";
      neonConfig.fetchEndpoint = stack.proxyUrl;
      globalThis.fetch = async (input, init) => {
        const url = new URL(
          input instanceof Request ? input.url : String(input)
        );
        if (url.origin !== new URL(stack.proxyUrl).origin) {
          outboundAttempts++;
          throw new Error(
            "Relational fixture allows only its disposable database proxy"
          );
        }
        return originalFetch(input, init);
      };
      const { createEveToolRegistry } =
        await import("@/lib/evry/eve/capabilities/registry");
      const { requireEvryPlantViewerForSession } =
        await import("@/lib/evry/eligibility/viewer");
      const { authorizeEvryReadCapabilityForSession } =
        await import("@/lib/evry/eligibility/capabilities");
      const { withAuthenticatedSessionId } =
        await import("@/lib/auth/session-scope");
      const store = createFixtureStore(stack.container);
      for (const id of relationalFixtureIds)
        await t.test(id, async (t) => {
          const scenario = questions.find((q) => q.id === id);
          assert.ok(scenario);
          const manifest = createFixtureManifest(id, 0);
          store.seed(manifest);
          seedRelationalFixture(manifest, store);
          const expected = relationalExpectations(manifest, store);
          assert.ok(expected);
          const actor = await requireEvryPlantViewerForSession(
            manifest.sessionId
          );
          const after = store.auditStart();
          let authorizations = 0;
          const registry = createEveToolRegistry({
            context: {
              actor,
              literalUserText: scenario.turns.join("\n"),
              pageContext: null,
              now: FIXTURE_NOW,
            },
            async authorizeRead(identity) {
              const auth = await authorizeEvryReadCapabilityForSession(
                identity,
                manifest.sessionId
              );
              assert.ok(auth);
              authorizations++;
              return auth;
            },
          });
          const run = async (wrong: boolean) =>
            withAuthenticatedSessionId(manifest.sessionId, async () => {
              const calls: CapturedCall[] = [];
              const presented = new Set<string>();
              const invoke = async (
                name: string,
                input: unknown,
                present = false
              ) => {
                const callId = `relational-${calls.length}`;
                const output = await registry.invoke(name, input, { callId });
                const artifact = capturedReadArtifactSchema.parse(output);
                calls.push({ id: callId, name, input, output });
                if (present) presented.add(callId);
                return artifact.items;
              };
              if (id === "people-05") {
                const groups = await invoke("people.query", {
                  cohort: {},
                  result: { mode: "group", by: "household" },
                });
                const rivera = groups.find((i) => i.label === "Rivera");
                assert.ok(rivera);
                const groupKey = rivera.facts?.find(
                  (f) => f.label === "Group key"
                )?.value;
                const householdId = z
                  .uuid()
                  .parse(groupKey?.match(/\[([^\]]+)\]$/)?.[1]);
                await invoke(
                  "people.query",
                  {
                    cohort: {
                      all: wrong
                        ? { search: "Rivera" }
                        : { householdIds: [householdId] },
                    },
                    result: { mode: "list" },
                  },
                  true
                );
              }
              if (id === "training-02")
                await invoke(
                  "training.query",
                  {
                    request: {
                      resource: "completions",
                      where: {
                        all: wrong
                          ? []
                          : [
                              {
                                completedDate: {
                                  kind: "relative",
                                  period: "this_month",
                                },
                              },
                            ],
                      },
                      query: { mode: "list" },
                    },
                  },
                  true
                );
              if (id === "commitments-01") {
                const records = await invoke("people.history.query", {
                  resource: {
                    kind: "commitments",
                    types: [wrong ? "core_group" : "launch_team"],
                  },
                  result: { mode: "list" },
                });
                const personIds = [
                  ...new Set(
                    records.flatMap(
                      (r) =>
                        r.facts
                          ?.filter((f) => f.label === "person_id")
                          .map((f) => f.value) ?? []
                    )
                  ),
                ];
                assert.equal(personIds.length, wrong ? 1 : 2);
                if (!wrong)
                  assert.equal(
                    records.length,
                    3,
                    "Repeated commitments must not create repeated people"
                  );
                await invoke(
                  "people.get_many",
                  { resource: "person", ids: personIds },
                  true
                );
              }
              if (id === "meetings-02") {
                const meetings = await invoke("meetings.query", {
                  where: {
                    all: [
                      {
                        types: ["vision_meeting"],
                        statuses: ["completed"],
                        date: {
                          kind: "range",
                          from: null,
                          through: "2026-09-20",
                        },
                      },
                    ],
                  },
                  query: {
                    mode: "list",
                    limit: 2,
                    sort: "date",
                    direction: "desc",
                  },
                });
                assert.equal(meetings.length, 2);
                const cohorts: string[][] = [];
                for (const meeting of meetings) {
                  const rows = await invoke("attendance.query", {
                    meetingIds: [meeting.id],
                    ...(wrong
                      ? { rsvp: ["confirmed"] }
                      : { statuses: ["attended"] }),
                    result: { mode: "list" },
                  });
                  cohorts.push([
                    ...new Set(
                      rows.flatMap(
                        (r) =>
                          r.facts
                            ?.filter((f) => f.label === "person_id")
                            .map((f) => f.value) ?? []
                      )
                    ),
                  ]);
                }
                const previous = new Set(cohorts[1]);
                await invoke(
                  "people.get_many",
                  {
                    resource: "person",
                    ids: cohorts[0].filter((id) => !previous.has(id)),
                  },
                  true
                );
              }
              return {
                calls,
                observed: observedRelationalFacts(id, calls, presented),
              };
            });
          const good = await run(false);
          assert.deepEqual(good.observed.facts, expected.facts);
          assert.deepEqual(
            good.observed.evidence.sort(),
            expected.requiredEvidence.sort()
          );
          assert.ok(good.calls.length <= expected.maxToolCalls);
          await t.test(
            "wrong relationship or filter cannot pass the SQL oracle",
            async () => {
              const bad = await run(true);
              assert.notDeepEqual(bad.observed.facts, expected.facts);
              assert.notDeepEqual(
                bad.observed.evidence.sort(),
                expected.requiredEvidence.sort()
              );
            }
          );
          assert.ok(authorizations >= good.calls.length * 2);
          assert.deepEqual(store.writesSince(after, manifest), []);
          assert.equal(outboundAttempts, 0);
          store.revoke(manifest);
        });
    } finally {
      globalThis.fetch = originalFetch;
      await stack.cleanup();
    }
  }
);
