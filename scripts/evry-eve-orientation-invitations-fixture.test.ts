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
  orientationInvitationsExpectations,
  orientationInvitationsId,
  orientationInvitationsPlanReference,
  orientationInvitationsRequest,
  orientationInvitationsTruth,
  readPreparedOrientationInvitationsFacts,
  seedOrientationInvitationsFixture,
} from "@/lib/evry/eve/evals/fixtures/orientation-invitations";

type Variant =
  | "correct"
  | "stage-only"
  | "any-attendance"
  | "first-page"
  | "past-meeting";
/** All IDs and invitation content come from real production reads, never the oracle. */
async function prepare(
  invoke: (name: string, input: unknown) => Promise<unknown>,
  variant: Variant
) {
  const meetings = capturedReadArtifactSchema.parse(
    await invoke("meetings.query", {
      where: {
        all: [
          {
            types: ["orientation"],
            statuses: ["planning", "ready"],
            ...(variant === "past-meeting" ? {} : { timing: "upcoming" }),
          },
        ],
      },
      query: { mode: "list", sort: "date", direction: "asc", limit: 1 },
    })
  );
  assert.equal(meetings.items.length, 1);
  const selected: string[] = [];
  for (let page = 0; page < 30; page++) {
    const result = capturedReadArtifactSchema.parse(
      await invoke("people.query", {
        cohort: {
          all: {
            ...(variant === "stage-only"
              ? { stages: ["core_group"] }
              : { commitment: { existence: "recorded" } }),
            attendance: {
              maximumMeetings: 0,
              ...(variant === "any-attendance"
                ? {}
                : { meetingTypes: ["orientation"] }),
            },
          },
        },
        result: {
          mode: "list",
          limit: 2,
          ...(selected.length ? { afterId: selected.at(-1) } : {}),
        },
      })
    );
    selected.push(...result.items.map((p) => p.id));
    if (variant === "first-page" || selected.length === result.counts.matched)
      break;
    assert.ok(
      result.items.length > 0 && selected.length < result.counts.matched
    );
  }
  assert.ok(selected.length && new Set(selected).size === selected.length);
  const template = z
    .object({
      status: z.literal("available"),
      source: z.literal("visible_template"),
      templateId: z.uuid(),
      subject: z.string(),
      body: z.string(),
    })
    .parse(
      await invoke("templates.for_meeting", { meetingType: "orientation" })
    );
  await invoke("actions.prepare", {
    request: {
      operation: "communication.send",
      arguments: {
        audience: { kind: "people", recipientIds: selected },
        draft: { kind: "template", templateId: template.templateId },
        meetingId: meetings.items[0]!.id,
      },
    },
  });
  return { selected, template };
}

test(
  "orientations-04 real committed/attendance query and exact existing-meeting invitation review",
  {
    skip: process.env.EVRY_EVE_ORIENTATION_INVITATIONS_PROOF !== "1",
    timeout: 240_000,
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
      process.env.RESEND_API_KEY = "re_isolated_no_delivery";
      neonConfig.fetchEndpoint = stack.proxyUrl;
      globalThis.fetch = async (input, init) => {
        const url = new URL(
          input instanceof Request ? input.url : String(input)
        );
        if (url.origin !== new URL(stack.proxyUrl).origin) {
          external++;
          throw new Error(
            "External calls prohibited in orientation invitation proof"
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
      const m = createFixtureManifest("orientations-04", 741);
      store.seed(m);
      seedOrientationInvitationsFixture(m, store);
      const truth = orientationInvitationsTruth(m, store),
        expected = orientationInvitationsExpectations(m, store)!;
      assert.equal(truth.meeting.id, orientationInvitationsId(m, "next"));
      assert.equal(truth.meeting.localStart, "2026-09-20T13:00:00");
      assert.equal(truth.meeting.zone, "America/New_York");
      assert.deepEqual(
        truth.people.map((p) => p.id).sort(),
        [
          "new",
          "rsvp",
          "vision-only",
          "duplicate-commitment",
          "no-email",
          "suppressed",
        ]
          .map((key) => orientationInvitationsId(m, key))
          .sort()
      );
      assert.equal(truth.eligible.length, 4);
      const actor = await requireEvryPlantViewerForSession(m.sessionId);
      const authorizeRead = (
        identity: Parameters<typeof authorizeEvryReadCapabilityForSession>[0]
      ) => authorizeEvryReadCapabilityForSession(identity, m.sessionId);
      const audit = store.auditStart();
      let serial = 0,
        correct: CapturedCall[] = [];
      for (const variant of [
        "correct",
        "stage-only",
        "any-attendance",
        "first-page",
        "past-meeting",
      ] as const)
        await t.test(variant, async () => {
          const calls: CapturedCall[] = [];
          const registry = createEveToolRegistry({
            context: {
              actor,
              literalUserText: orientationInvitationsRequest,
              pageContext: null,
              now: new Date(m.now),
            },
            authorizeRead,
            preparation: createEvePreparation({
              actor,
              conversationId: randomUUID(),
              userRequestKey: randomUUID(),
              literalUserText: orientationInvitationsRequest,
              pageContext: null,
              now: new Date(m.now),
              authorizeRead,
            }),
          });
          const invoke = async (name: string, input: unknown) => {
            const id = `orientation-invitation-${serial++}`;
            const output = await withAuthenticatedSessionId(m.sessionId, () =>
              registry.invoke(name, input, { callId: id })
            );
            calls.push({ id, name, input, output });
            return output;
          };
          const selection = await prepare(invoke, variant);
          const presented = new Set([calls.at(-1)!.id]);
          assert.ok(
            orientationInvitationsPlanReference(calls, presented),
            `${variant} must produce a real review, not a schema refusal`
          );
          const actual = await readPreparedOrientationInvitationsFacts({
            manifest: m,
            store,
            calls,
            presented,
          });
          if (variant === "correct") {
            assert.deepEqual(actual.facts, expected.facts);
            assert.deepEqual(actual.evidence, expected.requiredEvidence);
            assert.equal(selection.selected.length, 6);
            assert.equal(
              calls.filter((c) => c.name === "people.query").length,
              3
            );
            correct = calls;
          } else
            assert.notDeepEqual(
              actual.facts,
              expected.facts,
              `${variant} must fail independent SQL truth`
            );
          assert.deepEqual(store.writesSince(audit, m), []);
        });
      await t.test(
        "shown owner, exact fingerprint, fresh status, and actual source reads are required",
        async () => {
          assert.ok(
            correct.length,
            "correct production strategy must have succeeded"
          );
          const presented = new Set([correct.at(-1)!.id]);
          const observe = (
            calls = correct,
            manifest = m,
            visible = presented
          ) =>
            readPreparedOrientationInvitationsFacts({
              manifest,
              store,
              calls,
              presented: visible,
            });
          assert.deepEqual((await observe(correct, m, new Set())).facts, {});
          for (const manifest of [
            { ...m, ids: { ...m.ids, actor: m.ids["other-actor"] } },
            { ...m, ids: { ...m.ids, plant: m.ids["foreign-plant"] } },
            { ...m, now: "2099-01-01T00:00:00.000Z" },
          ])
            assert.deepEqual((await observe(correct, manifest)).facts, {});
          const withoutPeople = await observe(
            correct.filter((c) => c.name !== "people.query")
          );
          assert.equal(withoutPeople.facts.audienceWasRead, false);
          const withoutMeeting = await observe(
            correct.filter((c) => c.name !== "meetings.query")
          );
          assert.equal(withoutMeeting.facts.meetingWasRead, false);
          const newerFailure: CapturedCall = {
            id: "later-failure",
            name: "actions.prepare",
            input: {},
            output: {},
          };
          assert.deepEqual(
            (
              await observe(
                [...correct, newerFailure],
                m,
                new Set([...presented, newerFailure.id])
              )
            ).facts,
            {}
          );
          const ref = orientationInvitationsPlanReference(correct, presented)!;
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
            `update evry_action_plan_states set status='cancelled' where plan_id='${ref.planId}';`
          );
          assert.deepEqual((await observe()).facts, {});
        }
      );
      assert.equal(
        store.sql(
          `select count(*) from evry_plan_confirmations where church_id='${m.ids.plant}'`
        ),
        "0"
      );
      assert.deepEqual(store.writesSince(audit, m), []);
      await t.test(
        "actual evaluation adapter grades exact and wrong invitation reviews without inventing model quality",
        async () => {
          const { createProductionEveEvalAdapter } =
            await import("@/lib/evry/eve/evals/fixtures/adapter");
          let variant: Variant = "correct";
          let callNumber = 0;
          const adapter = createProductionEveEvalAdapter({
            store,
            buildSha: "0".repeat(40),
            async runProduction({
              scenario,
              registry,
              onPresentResult,
              sessionId,
            }) {
              assert.deepEqual(scenario.turns, [orientationInvitationsRequest]);
              const calls: CapturedCall[] = [];
              const invoke = async (name: string, input: unknown) => {
                const id = `adapter-orientation-invitation-${callNumber++}`;
                const output = await registry.invoke(name, input, {
                  callId: id,
                });
                calls.push({ id, name, input, output });
                return output;
              };
              await prepare(invoke, variant);
              const shown = calls.at(-1)!;
              assert.ok(
                orientationInvitationsPlanReference(calls, new Set([shown.id])),
                `${variant} must reach a persisted invitation review, not a schema refusal`
              );
              onPresentResult(shown.id);
              return {
                eveSessionId: sessionId,
                answer: "Scripted review proof; model quality not reviewed.",
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
          const scenario = questions.find((q) => q.id === "orientations-04")!;
          const fixture = await adapter.prepare(scenario);
          assert.ok(
            fixture,
            "Root must bind orientations-04 to the production adapter and preparation path"
          );
          try {
            for (const mode of [
              "correct",
              "stage-only",
              "any-attendance",
              "first-page",
              "past-meeting",
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
                  `${mode}: ${JSON.stringify(failures)}`
                );
            }
          } finally {
            await fixture.cleanup();
          }
        }
      );
      assert.equal(external, 0, "No model/provider/outbound calls");
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
