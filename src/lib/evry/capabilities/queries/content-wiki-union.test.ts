import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { setTimeout } from "node:timers/promises";
import { test } from "node:test";
import { type SQL } from "drizzle-orm";
import { getTableConfig, PgDialect } from "drizzle-orm/pg-core";
import { z } from "zod";
import { wikiArticles, wikiProgress } from "@/db/schema";
import { wikiSearchPageQuery, wikiSearchSchema } from "./content-wiki";

const plant = "10000000-0000-4000-8000-000000000001";
const foreign = "10000000-0000-4000-8000-000000000002";
const viewer = "20000000-0000-4000-8000-000000000001";
const otherViewer = "20000000-0000-4000-8000-000000000002";
const articleId = (n: number) =>
  `30000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const dialect = new PgDialect();
const pageSchema = z.object({
  total: z.number(),
  rows: z.array(
    z.object({
      id: z.string(),
      slug: z.string(),
      queries: z.array(z.string()),
      ts_headline: z.string(),
    })
  ),
});

test("wiki union counts distinct articles before one shared page", () => {
  const statement = dialect.sqlToQuery(
    wikiSearchPageQuery(
      plant,
      viewer,
      wikiSearchSchema.parse({ queries: ["orientation", "checklist"] })
    )
  );
  assert.match(statement.sql, /select distinct on \(id\)/);
  assert.match(statement.sql, /count\(\*\)::int from articles/);
  assert.equal((statement.sql.match(/ limit /g) ?? []).length, 1);
  assert.equal((statement.sql.match(/ offset /g) ?? []).length, 1);
  assert.match(statement.sql, /jsonb_agg\(distinct query_provenance/);
  assert.match(
    statement.sql,
    /"wiki_articles"\."updated_at" at time zone 'UTC' as "updated_at"/,
    "JSON search revisions carry an explicit offset, matching UTC driver decoding"
  );
});

test(
  "PostgreSQL wiki phrase union preserves unique counts, paging, visibility and provenance",
  { skip: process.env.EVRY_WIKI_UNION_PROOF !== "1", timeout: 90_000 },
  async () => {
    // This suite owns its container and never reads a configured database URL.
    const container = `evry-wiki-union-${randomUUID()}`;
    const docker = (args: string[], input?: string) =>
      execFileSync("docker", args, {
        encoding: "utf8",
        input,
        stdio: ["pipe", "pipe", "pipe"],
      });
    const postgres = (statement: string) =>
      docker(
        [
          "exec",
          "-i",
          container,
          "psql",
          "-X",
          "-q",
          "-A",
          "-t",
          "-v",
          "ON_ERROR_STOP=1",
          "-h",
          "127.0.0.1",
          "-U",
          "postgres",
        ],
        statement
      );
    const literal = (value: unknown): string => {
      if (value === null) return "null";
      if (typeof value === "number" || typeof value === "boolean")
        return String(value);
      if (typeof value === "string") return `'${value.replaceAll("'", "''")}'`;
      throw new Error("Unexpected wiki SQL fixture parameter");
    };
    const execute = (statement: SQL) => {
      const compiled = dialect.sqlToQuery(statement);
      const expanded = compiled.sql.replace(/\$(\d+)/g, (_, n) =>
        literal(compiled.params[Number(n) - 1])
      );
      return pageSchema.parse(
        JSON.parse(
          postgres(`select row_to_json(answer) from (${expanded}) answer;`)
        )
      );
    };
    docker([
      "run",
      "--rm",
      "-d",
      "--name",
      container,
      "-e",
      "POSTGRES_HOST_AUTH_METHOD=trust",
      "postgres:16-alpine",
    ]);
    try {
      let ready = false;
      for (let attempt = 0; attempt < 100; attempt++) {
        try {
          postgres("select 1;");
          ready = true;
          break;
        } catch {
          await setTimeout(100);
        }
      }
      assert.ok(ready, "Disposable wiki PostgreSQL did not become ready");
      // Copy the queried tables' real column names/types, omitting unrelated FKs.
      for (const table of [wikiArticles, wikiProgress]) {
        const config = getTableConfig(table);
        const columns = config.columns.map((column) => {
          const raw = column.getSQLType();
          const type =
            /^(uuid|text|varchar|boolean|integer|jsonb?|timestamp)/.test(raw)
              ? raw
              : "text";
          return `"${column.name}" ${type}`;
        });
        postgres(`create table "${config.name}" (${columns.join(",")});`);
      }
      const insert = (
        n: number,
        church: string | null,
        slug: string,
        status = "published",
        content = "Orientation checklist",
        phase = 2
      ) => {
        postgres(`insert into wiki_articles(id,church_id,slug,title,content,status,content_type,phase,updated_at)
          values(${literal(articleId(n))},${literal(church)},${literal(slug)},${literal(content)},${literal(content)},${literal(status)},'guide',${phase},'2026-09-21');`);
      };
      for (let n = 1; n <= 6; n++) insert(n, plant, `article-${n}`);
      insert(7, null, "overridden");
      insert(8, plant, "overridden", "published", "Unrelated local content");
      insert(9, null, "draft-override");
      insert(10, plant, "draft-override", "draft");
      insert(11, foreign, "foreign");
      insert(12, plant, "draft", "draft");
      insert(
        13,
        plant,
        "different-phase",
        "published",
        "Orientation checklist",
        3
      );
      postgres(`insert into wiki_progress(user_id,article_slug,status) values
        ('${viewer}','article-1','completed'),
        ('${otherViewer}','article-2','completed');`);

      const read = (input: unknown) =>
        execute(
          wikiSearchPageQuery(plant, viewer, wikiSearchSchema.parse(input))
        );
      const queries = ["orientation", "checklist"];
      const complete = read({ queries, phases: [2], limit: 30 });
      assert.equal(complete.total, 7);
      assert.equal(complete.rows.length, 7);
      assert.deepEqual(
        new Set(complete.rows.map((row) => row.id)),
        new Set([1, 2, 3, 4, 5, 6, 9].map(articleId))
      );
      for (const row of complete.rows) {
        assert.deepEqual(row.queries, ["checklist", "orientation"]);
        assert.match(row.ts_headline, /Orientation checklist/i);
      }
      const paged = [];
      for (const offset of [0, 2, 4, 6]) {
        const page = read({ queries, phases: [2], limit: 2, offset });
        assert.equal(page.total, 7);
        assert.equal(page.rows.length, offset === 6 ? 1 : 2);
        assert.deepEqual(
          page,
          read({ queries, phases: [2], limit: 2, offset })
        );
        paged.push(...page.rows.map((row) => row.id));
      }
      assert.deepEqual(
        paged,
        complete.rows.map((row) => row.id)
      );
      assert.equal(new Set(paged).size, 7);
      assert.deepEqual(read({ queries, phases: [2], offset: 8 }).rows, []);
      assert.equal(read({ queries, phases: [2], offset: 8 }).total, 7);
      assert.deepEqual(
        read({ queries: ["orientation", "orientation"], phases: [2] }).rows.map(
          (row) => row.queries
        ),
        Array.from({ length: 7 }, () => ["orientation"])
      );
      const unread = read({
        queries,
        phases: [2],
        readingStatuses: ["not_started"],
      });
      assert.equal(unread.total, 6);
      assert.ok(!unread.rows.some((row) => row.id === articleId(1)));
      assert.ok(unread.rows.some((row) => row.id === articleId(2)));
      const browse = read({ phases: [2] });
      assert.equal(browse.total, 8);
      assert.ok(browse.rows.some((row) => row.id === articleId(8)));
      assert.ok(
        browse.rows.every((row) => row.queries[0] === "Browse visible articles")
      );
      assert.deepEqual(read({ queries: ["nonexistentterm"] }), {
        total: 0,
        rows: [],
      });
    } finally {
      docker(["rm", "-f", container]);
    }
  }
);
