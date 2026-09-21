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
  "meeting SQL preserves optional ministry, local date evidence and complete checklist status",
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
      // A complete first page is not a complete checklist. Foreign rows must
      // neither create a checklist for this plant nor change its status.
      const checklists = [
        ["complete-one", "vision-optional", m.ids.plant, true],
        ["complete-two", "vision-optional", m.ids.plant, true],
        ["partial-one", "team-required", m.ids.plant, false],
        ["partial-two", "team-required", m.ids.plant, true],
        ["foreign-only", "orientation-optional", m.ids["foreign-plant"], false],
        [
          "foreign-incomplete",
          "vision-optional",
          m.ids["foreign-plant"],
          false,
        ],
      ] as const;
      for (const [name, meeting, church, checked] of checklists)
        store.sql(`insert into meeting_checklist_items(id,church_id,meeting_id,item_name,category,is_checked) values
          ('${id(name)}','${church}','${id(meeting)}','${name}','essential',${checked});`);

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
            sections: ["details", "checklist"],
            relatedLimit: 1,
          },
          m.ids.plant,
          m.timeZone
        )
      );
      assert.equal(detail.total, cases.length);
      const partial = detail.rows.find((row) => row.id === id("team-required"));
      assert.ok(partial);
      assert.equal(
        partial.facts.find((fact) => fact.label === "Checklist total")?.value,
        "2"
      );
      const partialPage = partial.facts.filter(
        (fact) => fact.label === "Preparation item"
      );
      assert.equal(partialPage.length, 1);
      assert.match(partialPage[0]!.value, /partial-two · Complete/);
      for (const result of [list, detail]) {
        assert.ok(!JSON.stringify(result).includes("Foreign secret"));
        assert.ok(!JSON.stringify(result).includes("foreign-only"));
        assert.ok(!JSON.stringify(result).includes("foreign-incomplete"));
        assert.ok(!result.rows.some((row) => row.id === id("foreign-meeting")));
        for (const row of result.rows) {
          assert.equal(
            row.facts.find((fact) => fact.label === "Preparation checklist")
              ?.value,
            row.id === id("vision-optional")
              ? "Complete"
              : row.id === id("team-required")
                ? "Incomplete"
                : "No checklist recorded"
          );
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
      for (const [checklist, expected] of [
        ["complete", [id("vision-optional")]],
        ["incomplete", [id("team-required")]],
        [
          "none",
          cases
            .filter(
              ([name]) => name !== "vision-optional" && name !== "team-required"
            )
            .map(([name]) => id(name)),
        ],
      ] as const) {
        const filtered = await executeOperations(
          meetingsQueryStatement(
            z.strictObject(meetingsQueryShape).parse({
              where: { all: [{ search: "Projection", checklist }] },
              query: { mode: "list", limit: 50 },
            }),
            m.ids.plant,
            new Date(m.now),
            m.timeZone
          )
        );
        assert.deepEqual(
          filtered.rows.map((row) => row.id).sort(),
          [...expected].sort()
        );
      }
      assert.deepEqual(store.writesSince(before, m), []);
      assert.equal(outbound, 5, "Only the five isolated SQL queries ran");
    } finally {
      globalThis.fetch = originalFetch;
      neonConfig.fetchEndpoint = previousEndpoint;
      if (previousDatabase === undefined) delete process.env.DATABASE_URL;
      else process.env.DATABASE_URL = previousDatabase;
      await stack.cleanup();
    }
  }
);
