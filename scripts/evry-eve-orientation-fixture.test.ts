import assert from "node:assert/strict";
import { test } from "node:test";
import { neonConfig } from "@neondatabase/serverless";
import { z } from "zod";
import { regressions } from "@/lib/evry/eve/evals/catalog";
import { gradeObservation } from "@/lib/evry/eve/evals/grade";
import { observationSchema } from "@/lib/evry/eve/evals/contract";
import { createFixtureManifest } from "@/lib/evry/eve/evals/fixtures/manifest";
import { createFixtureStore } from "@/lib/evry/eve/evals/fixtures/store";
import { startFixtureStack } from "@/lib/evry/eve/evals/fixtures/stack";
import type { CapturedCall } from "@/lib/evry/eve/evals/fixtures/host-capture";

test(
  "orientation facts come from an owned, fingerprint-verified unconfirmed production plan",
  {
    skip: process.env.EVRY_EVE_ORIENTATION_PROOF !== "1",
    timeout: 180_000,
  },
  async (t) => {
    const stack = await startFixtureStack(process.cwd());
    try {
      process.env.DATABASE_URL = stack.databaseUrl;
      process.env.RESEND_API_KEY = "re_eve_fixture_never_sent";
      neonConfig.fetchEndpoint = stack.proxyUrl;
      const { createProductionEveEvalAdapter } =
        await import("@/lib/evry/eve/evals/fixtures/adapter");
      const { readPreparedOrientationFacts } =
        await import("@/lib/evry/eve/evals/fixtures/prepared-facts");
      const store = createFixtureStore(stack.container);
      const scenario = regressions.find(
        (row) => row.id === "regression-orientation"
      )!;
      type Variant = "correct" | "type" | "date" | "audience" | "template";
      let variant: Variant = "correct";
      let repetition = 0;
      let calls: CapturedCall[] = [];
      let presented = new Set<string>();
      const adapter = createProductionEveEvalAdapter({
        store,
        buildSha: "0".repeat(40),
        async runProduction({ registry, onPresentResult }) {
          calls = [];
          presented = new Set();
          const invoke = async (name: string, input: unknown) => {
            const id = `orientation-${calls.length}`;
            const output = await registry.invoke(name, input, { callId: id });
            calls.push({ id, name, input, output });
            return output;
          };
          const calendar = z
            .object({ calendarDate: z.string(), localTime: z.string() })
            .parse(
              await invoke("calendar.resolve", {
                date: { kind: "weekday", weekday: 0, occurrence: "upcoming" },
                localTime: "10:00",
                durationMinutes: 120,
              })
            );
          const locations = z
            .object({ items: z.array(z.object({ id: z.uuid() })) })
            .parse(await invoke("locations.query", {}));
          assert.equal(locations.items.length, 1);
          const template = z
            .object({
              subject: z.string(),
              body: z.string(),
              source: z.literal("visible_template"),
            })
            .parse(
              await invoke("templates.for_meeting", {
                meetingType: "orientation",
              })
            );
          const manifest = createFixtureManifest(scenario.id, repetition);
          const result = await invoke("actions.prepare", {
            request: {
              operation: "recipe.meeting-invite",
              arguments: {
                meetingType:
                  variant === "type" ? "vision_meeting" : "orientation",
                title: "Core team orientation",
                dateTime: {
                  date:
                    variant === "date" ? "2026-09-28" : calendar.calendarDate,
                  time: calendar.localTime,
                },
                durationMinutes: 120,
                ...(variant === "audience"
                  ? { guestPersonIds: [manifest.ids["core-alex"]] }
                  : { audience: "core_team" }),
                locationId: locations.items[0].id,
                subject:
                  variant === "template"
                    ? "A different invitation"
                    : template.subject,
                body:
                  variant === "template"
                    ? "This is not the saved template."
                    : template.body,
              },
            },
          });
          if (variant === "type") {
            assert.deepEqual(
              result,
              { status: "unavailable" },
              "The production resolver rejects this inconsistent meeting type"
            );
          } else {
            assert.ok(
              z
                .object({ activePlan: z.object({ mode: z.literal("set") }) })
                .safeParse(result).success,
              JSON.stringify(result)
            );
            const reference = calls.at(-1)!.id;
            presented.add(reference);
            onPresentResult(reference);
          }
          return {
            answer:
              "Scripted production preparation proof; model quality not evaluated.",
            clarificationCount: 0,
            costUsd: 0,
            judge: null,
            latency: { acknowledgementMs: 0, firstTextMs: null, totalMs: 0 },
          };
        },
      });
      for (const entry of [
        "correct",
        "type",
        "date",
        "audience",
        "template",
      ] as const) {
        variant = entry;
        await t.test(entry, async () => {
          const fixture = await adapter.prepare(scenario);
          assert.ok(
            fixture,
            "Orientation must bind without injected preparation or facts"
          );
          try {
            const observation = observationSchema.parse(
              await fixture.run({
                scenario,
                signal: AbortSignal.timeout(30_000),
                maxCostUsd: 0.1,
              })
            );
            assert.deepEqual(observation.effects, {
              domainWrites: 0,
              outboundMessages: 0,
            });
            const failures = gradeObservation(
              scenario.id,
              fixture.expectations,
              observation
            ).failures;
            const expected = {
              correct: [],
              type: Object.keys(fixture.expectations.facts).map(
                (key) => `fact:${key}`
              ),
              date: ["fact:localDate"],
              audience: ["fact:recipientIds"],
              template: ["fact:templateSubject", "fact:templateBody"],
            }[entry];
            assert.deepEqual(
              failures,
              [...expected, "quality_not_reviewed"],
              JSON.stringify(observation.facts)
            );
            if (entry === "correct") {
              const manifest = createFixtureManifest(scenario.id, repetition);
              const input = { manifest, store, calls, presented };
              assert.deepEqual(
                await readPreparedOrientationFacts(input),
                observation.facts
              );
              assert.deepEqual(
                await readPreparedOrientationFacts({
                  ...input,
                  presented: new Set(),
                }),
                {},
                "Unpresented plans are not response evidence"
              );
              assert.deepEqual(
                await readPreparedOrientationFacts({
                  ...input,
                  manifest: {
                    ...manifest,
                    ids: {
                      ...manifest.ids,
                      actor: manifest.ids["other-actor"],
                    },
                  },
                }),
                {},
                "Another actor cannot claim this plan"
              );
              assert.deepEqual(
                await readPreparedOrientationFacts({
                  ...input,
                  manifest: {
                    ...manifest,
                    ids: {
                      ...manifest.ids,
                      plant: manifest.ids["foreign-plant"],
                    },
                  },
                }),
                {},
                "Another tenant cannot claim this plan"
              );
              const identity = z
                .object({
                  activePlan: z.object({
                    plan: z.object({
                      planId: z.uuid(),
                      fingerprint: z.string(),
                    }),
                  }),
                })
                .parse(calls.at(-1)!.output).activePlan.plan;
              const wrongFingerprint = calls.map((call) =>
                call.name === "actions.prepare"
                  ? {
                      ...call,
                      output: {
                        activePlan: {
                          mode: "set",
                          plan: { ...identity, fingerprint: "0".repeat(64) },
                        },
                      },
                    }
                  : call
              );
              assert.deepEqual(
                await readPreparedOrientationFacts({
                  ...input,
                  calls: wrongFingerprint,
                }),
                {},
                "A forged fingerprint cannot supply facts"
              );
              assert.deepEqual(
                await readPreparedOrientationFacts({
                  ...input,
                  manifest: { ...manifest, now: "2026-09-21T16:00:00.000Z" },
                }),
                {},
                "Expired plans cannot supply preconfirmation facts"
              );
              store.sql(
                `update evry_action_plan_states set status='cancelled' where plan_id='${identity.planId}';`
              );
              assert.deepEqual(
                await readPreparedOrientationFacts(input),
                {},
                "Cancelled plans cannot supply preconfirmation facts"
              );
              store.sql(
                `update evry_action_plan_states set status='awaiting_confirmation' where plan_id='${identity.planId}';`
              );
              assert.throws(
                () =>
                  store.sql(
                    `update evry_action_plans set document=jsonb_set(document,'{confirmation,title}','"Tampered title"') where id='${identity.planId}';`
                  ),
                /immutable Evry row/,
                "The database itself rejects plan-content tampering"
              );
              assert.deepEqual(
                await readPreparedOrientationFacts(input),
                observation.facts,
                "Rejected tampering leaves the original fingerprint and facts intact"
              );
            }
          } finally {
            await fixture.cleanup();
          }
        });
        repetition++;
      }
    } finally {
      await stack.cleanup();
    }
  }
);
