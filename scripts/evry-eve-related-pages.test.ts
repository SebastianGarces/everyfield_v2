import assert from "node:assert/strict";
import { test } from "node:test";
import { z } from "zod";
import { neonConfig } from "@neondatabase/serverless";
import { startFixtureStack } from "@/lib/evry/eve/evals/fixtures/stack";
import { createFixtureStore } from "@/lib/evry/eve/evals/fixtures/store";
import { createFixtureManifest } from "@/lib/evry/eve/evals/fixtures/manifest";

test(
  "reader continuation retrieves complete related lists, Unicode history and report evidence, with scoped wiki browsing",
  { skip: process.env.EVRY_EVE_HTTP_PROOF !== "1", timeout: 120_000 },
  async () => {
    const stack = await startFixtureStack(process.cwd());
    const previous = {
      database: process.env.DATABASE_URL,
      endpoint: neonConfig.fetchEndpoint,
    };
    try {
      process.env.DATABASE_URL = stack.databaseUrl;
      neonConfig.fetchEndpoint = stack.proxyUrl;
      const { db } = await import("@/db");
      const { tasksGetManyStatement } =
        await import("@/lib/evry/capabilities/queries/operations-tasks");
      const { meetingsGetManyStatement } =
        await import("@/lib/evry/capabilities/queries/operations-meetings");
      const store = createFixtureStore(stack.container);
      const m = createFixtureManifest("related-pages", 0);
      store.seed(m);
      store.sql(`insert into tasks(id,church_id,title,status,priority,created_by_id) select ('90000000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid,'${m.ids.plant}','Prerequisite '||n,'not_started','high','${m.ids.actor}' from generate_series(1,21)n;
      insert into task_dependencies(church_id,task_id,prerequisite_task_id) select '${m.ids.plant}','${m.ids["task-today"]}',('90000000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid from generate_series(1,21)n;
      insert into meeting_checklist_items(id,church_id,meeting_id,item_name,category,is_checked) select ('90000000-0000-4000-8001-'||lpad(n::text,12,'0'))::uuid,'${m.ids.plant}','${m.ids["meeting-upcoming"]}','Preparation item '||n,'custom',false from generate_series(1,21)n;`);
      const result = z.object({
        rows: z.array(
          z.object({
            facts: z.array(z.object({ label: z.string(), value: z.string() })),
          })
        ),
      });
      for (const kind of ["tasks", "meetings"] as const) {
        const pages: string[][] = [];
        for (const relatedOffset of [0, 20, 40]) {
          const statement =
            kind === "tasks"
              ? tasksGetManyStatement(
                  {
                    ids: [m.ids["task-today"]],
                    sections: ["dependencies"],
                    relatedLimit: 20,
                    relatedOffset,
                  },
                  m.ids.plant
                )
              : meetingsGetManyStatement(
                  {
                    ids: [m.ids["meeting-upcoming"]],
                    sections: ["checklist"],
                    relatedLimit: 20,
                    relatedOffset,
                  },
                  m.ids.plant,
                  "America/New_York"
                );
          const data = result.parse((await db.execute(statement)).rows[0]);
          pages.push(
            data.rows[0]!.facts.filter(
              (f) =>
                f.label ===
                (kind === "tasks" ? "Prerequisite" : "Preparation item")
            ).map((f) => f.value)
          );
        }
        assert.deepEqual(
          pages.map((p) => p.length),
          [20, 1, 0]
        );
        assert.equal(new Set(pages.flat()).size, 21);
        assert.match(pages[1]![0]!, /21/);
      }
      const { buildPeopleHistoryQuery, peopleHistoryQuerySchema } =
        await import("@/lib/evry/capabilities/queries/people-query-sql");
      const historyId = "90000000-0000-4000-8002-000000000001";
      store.sql(
        `insert into person_activities(id,church_id,person_id,performed_by,activity_type,metadata,created_at) values ('${historyId}','${m.ids.plant}','${m.ids["prospect-new"]}','${m.ids.actor}','note_added',jsonb_build_object('note',repeat('😀',700)||'FINAL EVIDENCE'),'2026-09-20T14:15:00');`
      );
      const history = z.object({
        rows: z.array(
          z.object({
            content: z.string(),
            created_at: z.string(),
            content_next_offset: z.number().nullable(),
          })
        ),
      });
      let contentOffset = 0;
      let reconstructed = "";
      for (let page = 0; page < 10; page++) {
        const input = peopleHistoryQuerySchema.parse({
          resource: { kind: "notes" },
          recordIds: [historyId],
          contentOffset,
          dateBasis: "created_at",
          dates: { from: "2026-09-20", through: "2026-09-20" },
          result: { mode: "list" },
        });
        const data = history.parse(
          (await db.execute(buildPeopleHistoryQuery(m.ids.plant, input)))
            .rows[0]
        );
        const row = data.rows[0]!;
        assert.ok(
          row.content.length <= 500,
          "Public fact boundary must not cut this page again"
        );
        assert.match(row.created_at, /14:15/);
        reconstructed += row.content;
        if (row.content_next_offset === null) break;
        contentOffset = row.content_next_offset;
      }
      assert.equal(reconstructed, "😀".repeat(700) + "FINAL EVIDENCE");
      const foreign = peopleHistoryQuerySchema.parse({
        resource: { kind: "notes" },
        recordIds: [historyId],
        result: { mode: "list" },
      });
      assert.equal(
        history.parse(
          (
            await db.execute(
              buildPeopleHistoryQuery(m.ids["foreign-plant"], foreign)
            )
          ).rows[0]
        ).rows.length,
        0
      );
      const { intelligenceFilteredQuery, intelligenceQuerySchema } =
        await import("@/lib/evry/capabilities/queries/content-platform");
      const { contentFacts } =
        await import("@/lib/evry/capabilities/queries/content-core");
      const assessmentId = "90000000-0000-4000-8003-000000000001";
      store.sql(
        `insert into plant_assessments(id,church_id,phase,rubric_version,fact_snapshot,status) values ('${assessmentId}','${m.ids.plant}',2,'fixture',jsonb_build_object('marker',repeat('😀',6200)||'FINAL REPORT EVIDENCE'),'complete');`
      );
      const reportRow = z.object({ facts: z.record(z.string(), z.unknown()) });
      let snapshot = "";
      let offset = 0;
      for (let page = 0; page < 10; page++) {
        const data = reportRow.parse(
          (
            await db.execute(
              intelligenceFilteredQuery(
                m.ids.plant,
                intelligenceQuerySchema.parse({
                  resource: "assessments",
                  assessmentIds: [assessmentId],
                  includeFactSnapshot: true,
                  contentOffset: offset,
                })
              )
            )
          ).rows[0]
        );
        snapshot += contentFacts(data.facts)
          .filter((fact) => fact.label.startsWith("Fact snapshot"))
          .map((fact) => fact.value)
          .join("");
        const next = z
          .object({ value: z.number().nullable(), modelOnly: z.literal(true) })
          .parse(data.facts["Next content offset"]);
        if (next.value === null) break;
        offset = next.value;
      }
      assert.equal(
        z.object({ marker: z.string() }).parse(JSON.parse(snapshot)).marker,
        "😀".repeat(6200) + "FINAL REPORT EVIDENCE"
      );

      const { seedHistoricalFixture } =
        await import("@/lib/evry/eve/evals/fixtures/historical");
      seedHistoricalFixture({ ...m, caseId: "wiki-03" }, store);
      store.sql(
        `update wiki_articles set phase=3 where church_id in ('${m.ids.plant}','${m.ids["foreign-plant"]}');`
      );
      const { wikiSearchQuery, wikiSearchSchema } =
        await import("@/lib/evry/capabilities/queries/content-wiki");
      const articles = await wikiSearchQuery(
        m.ids.plant,
        m.ids.actor,
        wikiSearchSchema.parse({ phases: [3] }),
        null
      );
      assert.deepEqual(
        articles.map((row) => row.id).sort(),
        [m.ids["wiki-vision"], m.ids["wiki-orientation"]].sort()
      );
    } finally {
      if (previous.database === undefined) delete process.env.DATABASE_URL;
      else process.env.DATABASE_URL = previous.database;
      neonConfig.fetchEndpoint = previous.endpoint;
      await stack.cleanup();
    }
  }
);
