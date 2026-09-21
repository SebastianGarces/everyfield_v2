import assert from "node:assert/strict";
import { test } from "node:test";
import { neonConfig } from "@neondatabase/serverless";
import { z } from "zod";
import { startFixtureStack } from "@/lib/evry/eve/evals/fixtures/stack";
import { createFixtureStore } from "@/lib/evry/eve/evals/fixtures/store";
import {
  createFixtureManifest,
  fixtureId,
} from "@/lib/evry/eve/evals/fixtures/manifest";

test(
  "meeting SQL omits absent optional ministry and keeps local date evidence model-only",
  {
    skip: process.env.EVRY_EVE_MEETING_PROJECTION_PROOF !== "1",
    timeout: 120_000,
  },
  async () => {
    const stack = await startFixtureStack(process.cwd());
    const previousDatabase = process.env.DATABASE_URL;
    const previousEndpoint = neonConfig.fetchEndpoint;
    const originalFetch = globalThis.fetch;
    let outbound = 0;
    try {
      process.env.DATABASE_URL = stack.databaseUrl;
      neonConfig.fetchEndpoint = stack.proxyUrl;
      globalThis.fetch = async (input, init) => {
        const url = new URL(
          input instanceof Request ? input.url : String(input)
        );
        assert.equal(url.origin, new URL(stack.proxyUrl).origin);
        outbound++;
        return originalFetch(input, init);
      };
      const {
        meetingsQueryShape,
        meetingsQueryStatement,
        meetingsGetManyStatement,
      } = await import("@/lib/evry/capabilities/queries/operations-meetings");
      const { executeOperations, operationsArtifact } =
        await import("@/lib/evry/capabilities/queries/operations-core");
      const { publicEvryArtifact } =
        await import("@/lib/evry/artifacts/public");
      const { meetingCreateSchema } =
        await import("@/lib/validations/meetings");
      const m = createFixtureManifest("meeting-projection", 0);
      const store = createFixtureStore(stack.container);
      store.seed(m);
      const id = (name: string) => fixtureId(m.caseId, name);
      const foreignTeam = id("foreign-team");
      store.sql(`insert into ministry_teams(id,church_id,name,created_by) values
        ('${foreignTeam}','${m.ids["foreign-plant"]}','Foreign secret ministry','${m.ids["foreign-actor"]}');`);
      const cases = [
        ["orientation-optional", "orientation", null, undefined],
        ["vision-optional", "vision_meeting", null, undefined],
        ["team-required", "team_meeting", null, "Not recorded"],
        ["orientation-linked", "orientation", m.ids.ministry, "Hospitality"],
        ["team-linked", "team_meeting", m.ids.ministry, "Hospitality"],
        ["orientation-foreign-link", "orientation", foreignTeam, undefined],
        ["team-foreign-link", "team_meeting", foreignTeam, "Not recorded"],
      ] as const;
      for (const [name, type, teamId] of cases)
        store.sql(`insert into church_meetings(id,church_id,type,title,datetime,team_id,created_by) values
          ('${id(name)}','${m.ids.plant}','${type}','Projection ${name}','2026-11-01 01:30:00',${teamId ? `'${teamId}'` : "null"},'${m.ids.actor}');`);
      store.sql(`insert into church_meetings(id,church_id,type,title,datetime,team_id,created_by) values
        ('${id("foreign-meeting")}','${m.ids["foreign-plant"]}','team_meeting','Projection Foreign secret meeting','2026-11-01 01:30:00','${foreignTeam}','${m.ids["foreign-actor"]}');`);

      // The product requires a team only for team meetings, not orientations.
      for (const type of ["orientation", "vision_meeting"])
        assert.equal(
          meetingCreateSchema.safeParse({ type, datetime: new Date(m.now) })
            .success,
          true
        );
      assert.equal(
        meetingCreateSchema.safeParse({
          type: "team_meeting",
          datetime: new Date(m.now),
        }).success,
        false
      );
      const before = store.auditStart();
      const query = z.strictObject(meetingsQueryShape).parse({
        where: { all: [{ search: "Projection" }] },
        query: { mode: "list", limit: 50 },
      });
      const list = await executeOperations(
        meetingsQueryStatement(query, m.ids.plant, new Date(m.now), m.timeZone)
      );
      assert.equal(list.total, cases.length);
      for (const [name, , , expectedMinistry] of cases) {
        const row = list.rows.find((row) => row.id === id(name));
        assert.ok(row);
        assert.equal(
          row.facts.find((fact) => fact.label === "Ministry")?.value,
          expectedMinistry,
          name
        );
      }
      const detail = await executeOperations(
        meetingsGetManyStatement(
          {
            ids: [...cases.map(([name]) => id(name)), id("foreign-meeting")],
            sections: ["details"],
            relatedLimit: 10,
          },
          m.ids.plant,
          m.timeZone
        )
      );
      assert.equal(detail.total, cases.length);
      for (const result of [list, detail]) {
        assert.ok(!JSON.stringify(result).includes("Foreign secret"));
        assert.ok(!result.rows.some((row) => row.id === id("foreign-meeting")));
        for (const row of result.rows) {
          assert.deepEqual(
            row.facts.find((fact) => fact.label === "Local start"),
            {
              label: "Local start",
              value: "2026-11-01 01:30:00",
              modelOnly: true,
            }
          );
          assert.deepEqual(
            row.facts.find((fact) => fact.label === "Timezone"),
            {
              label: "Timezone",
              value: "America/New_York",
              modelOnly: true,
            }
          );
        }
        const artifact = operationsArtifact(
          "Meetings",
          "/meetings",
          result,
          query,
          new Date(m.now),
          m.timeZone
        );
        assert.ok(
          artifact.items.every((item) =>
            item.facts.some(
              (fact) => fact.label === "Local start" && fact.modelOnly
            )
          )
        );
        const publicArtifact = publicEvryArtifact(artifact);
        assert.equal(publicArtifact.kind, "read");
        if (publicArtifact.kind !== "read")
          throw new Error("Expected read projection");
        for (const item of publicArtifact.items) {
          assert.ok(item.facts.some((fact) => fact.label === "When"));
          assert.ok(
            !item.facts.some(
              (fact) =>
                fact.label === "Local start" || fact.label === "Timezone"
            )
          );
        }
      }
      assert.deepEqual(store.writesSince(before, m), []);
      assert.equal(outbound, 2, "Only the two isolated SQL queries ran");
    } finally {
      globalThis.fetch = originalFetch;
      neonConfig.fetchEndpoint = previousEndpoint;
      if (previousDatabase === undefined) delete process.env.DATABASE_URL;
      else process.env.DATABASE_URL = previousDatabase;
      await stack.cleanup();
    }
  }
);
