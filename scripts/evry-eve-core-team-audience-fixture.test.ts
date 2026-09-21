import assert from "node:assert/strict";
import { test } from "node:test";
import { neonConfig } from "@neondatabase/serverless";
import { regressions } from "@/lib/evry/eve/evals/catalog";
import { startFixtureStack } from "@/lib/evry/eve/evals/fixtures/stack";
import { createFixtureStore } from "@/lib/evry/eve/evals/fixtures/store";
import {
  createFixtureManifest,
  fixtureId,
  type FixtureManifest,
} from "@/lib/evry/eve/evals/fixtures/manifest";
import { capturedReadArtifactSchema } from "@/lib/evry/eve/evals/fixtures/host-capture";
import { gradeObservation } from "@/lib/evry/eve/evals/grade";
import { observationSchema } from "@/lib/evry/eve/evals/contract";
import { z } from "zod";

test(
  "named core-team lookup and persisted invitation use the same current tenant audience",
  {
    skip: process.env.EVRY_EVE_CORE_TEAM_AUDIENCE_PROOF !== "1",
    timeout: 120_000,
  },
  async () => {
    const stack = await startFixtureStack(process.cwd());
    const previousDatabase = process.env.DATABASE_URL;
    const previousResend = process.env.RESEND_API_KEY;
    const previousEndpoint = neonConfig.fetchEndpoint;
    const originalFetch = globalThis.fetch;
    let outbound = 0;
    try {
      process.env.DATABASE_URL = stack.databaseUrl;
      process.env.RESEND_API_KEY = "re_isolated_fixture_no_delivery";
      neonConfig.fetchEndpoint = stack.proxyUrl;
      globalThis.fetch = async (input, init) => {
        const url = new URL(
          input instanceof Request ? input.url : String(input)
        );
        if (url.origin !== new URL(stack.proxyUrl).origin) {
          outbound++;
          throw new Error("Only the isolated fixture proxy is allowed");
        }
        return originalFetch(input, init);
      };
      const { createProductionEveEvalAdapter } =
        await import("@/lib/evry/eve/evals/fixtures/adapter");
      const base = createFixtureStore(stack.container);
      const extra = (m: FixtureManifest, name: string) =>
        fixtureId(`${m.caseId}:${m.repetition}`, `core-audience:${name}`);
      const truth = (m: FixtureManifest) =>
        base
          .query(
            `select id from persons where church_id='${m.ids.plant}' and deleted_at is null and status in ('core_group','launch_team','leader')`
          )
          .map((row) => z.string().parse(row.id))
          .sort();
      const original = regressions.find(
        (r) => r.id === "regression-orientation"
      );
      assert.ok(original);
      const m = createFixtureManifest(original.id, 0);
      const scenario = structuredClone(original);
      scenario.expectations.facts.recipientIds = [
        m.ids["core-alex"],
        m.ids["core-jordan"],
        extra(m, "launch"),
        extra(m, "leader"),
      ].sort();
      let expected: string[] = [];
      const adapter = createProductionEveEvalAdapter({
        buildSha: "0".repeat(40),
        store: {
          ...base,
          seed(manifest) {
            base.seed(manifest);
            assert.equal(manifest.digest, m.digest);
            for (const [name, status, deleted] of [
              ["launch", "launch_team", false],
              ["leader", "leader", false],
              ["deleted-leader", "leader", true],
              ["former-core", "core_group", false],
            ] as const)
              base.sql(
                `insert into persons(id,church_id,first_name,last_name,email,status,created_by,deleted_at) values ('${extra(m, name)}','${m.ids.plant}','${name}','Fixture','${extra(m, name)}@example.test','${status}','${m.ids.actor}',${deleted ? "'2026-09-01'" : "null"});`
              );
            base.sql(
              `update persons set status='prospect' where id='${extra(m, "former-core")}'; update persons set status='leader' where id='${m.ids["person-foreign"]}'; insert into commitments(church_id,person_id,commitment_type,signed_date) values ('${m.ids.plant}','${extra(m, "former-core")}','core_group','2026-09-01');`
            );
            expected = truth(m);
            assert.deepEqual(
              expected,
              scenario.expectations.facts.recipientIds
            );
          },
          truth(manifest) {
            return { ...base.truth(manifest), core: truth(manifest) };
          },
        },
        async runProduction({ registry, onPresentResult }) {
          const read = capturedReadArtifactSchema.parse(
            await registry.invoke(
              "people.query",
              {
                cohort: { all: { audience: "core_team" } },
                result: { mode: "list", limit: 50 },
              },
              { callId: "core-read" }
            )
          );
          assert.deepEqual(read.items.map((item) => item.id).sort(), expected);
          assert.equal(read.counts.matched, 4);
          // Exact stage and historical commitment remain different selections.
          const exact = capturedReadArtifactSchema.parse(
            await registry.invoke(
              "people.query",
              {
                cohort: { all: { stages: ["core_group"] } },
                result: { mode: "list", limit: 50 },
              },
              { callId: "exact-stage-control" }
            )
          );
          assert.deepEqual(
            exact.items.map((item) => item.id).sort(),
            [m.ids["core-alex"], m.ids["core-jordan"]].sort()
          );
          const history = capturedReadArtifactSchema.parse(
            await registry.invoke(
              "people.query",
              {
                cohort: {
                  all: {
                    commitment: {
                      existence: "recorded",
                      types: ["core_group"],
                    },
                  },
                },
                result: { mode: "list", limit: 50 },
              },
              { callId: "history-control" }
            )
          );
          assert.deepEqual(
            history.items.map((item) => item.id),
            [extra(m, "former-core")]
          );
          await registry.invoke(
            "locations.query",
            { search: "church", limit: 25 },
            { callId: "location" }
          );
          await registry.invoke(
            "templates.for_meeting",
            { meetingType: "orientation" },
            { callId: "template" }
          );
          await registry.invoke(
            "actions.prepare",
            {
              request: {
                operation: "recipe.meeting-invite",
                arguments: {
                  meetingType: "orientation",
                  title: "Core Team Orientation",
                  dateTime: { date: "2026-09-27", time: "10:00" },
                  audience: "core_team",
                  durationMinutes: 120,
                  locationId: m.ids["church-location"],
                  subject: "Join us for {{meeting_title}}",
                  body: "Hi {{first_name}}, join us on {{meeting_date}} at {{meeting_location}}.",
                },
              },
            },
            { callId: "prepare-core" }
          );
          onPresentResult("prepare-core");
          return {
            answer: "Scripted audience proof, not a model response.",
            clarificationCount: 0,
            costUsd: 0,
            judge: null,
            latency: { acknowledgementMs: 0, firstTextMs: null, totalMs: 0 },
          };
        },
      });
      const fixture = await adapter.prepare(scenario);
      assert.ok(fixture);
      try {
        const observation = observationSchema.parse(
          await fixture.run({
            scenario,
            signal: AbortSignal.timeout(30_000),
            maxCostUsd: 0.1,
          })
        );
        const grade = gradeObservation(
          scenario.id,
          fixture.expectations,
          observation
        );
        assert.deepEqual(
          grade.failures,
          ["quality_not_reviewed"],
          JSON.stringify(grade)
        );
        assert.deepEqual(
          observation.facts.recipientIds,
          expected,
          "Recipients must come from the persisted unconfirmed plan, not a model claim"
        );
        assert.deepEqual(observation.effects, {
          domainWrites: 0,
          outboundMessages: 0,
        });
        assert.equal(outbound, 0);
      } finally {
        await fixture.cleanup();
      }
    } finally {
      globalThis.fetch = originalFetch;
      neonConfig.fetchEndpoint = previousEndpoint;
      if (previousDatabase === undefined) delete process.env.DATABASE_URL;
      else process.env.DATABASE_URL = previousDatabase;
      if (previousResend === undefined) delete process.env.RESEND_API_KEY;
      else process.env.RESEND_API_KEY = previousResend;
      await stack.cleanup();
    }
  }
);
