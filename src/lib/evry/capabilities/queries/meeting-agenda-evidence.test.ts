import assert from "node:assert/strict";
import { test } from "node:test";
import { sql } from "drizzle-orm";
import { PgDialect } from "drizzle-orm/pg-core";
import { z } from "zod";
import { MAX_SECTION_MINUTES } from "@/lib/meetings/agenda";
import { meetingAgendaItemEvidence } from "./meeting-agenda-evidence";

const dialect = new PgDialect();
test("agenda projection keeps title and description and reads native minutes without a zero default", () => {
  const statement = dialect.sqlToQuery(meetingAgendaItemEvidence(sql`entry`));
  assert.match(statement.sql, /entry ->> 'title'/);
  assert.match(statement.sql, /entry ->> 'description'/);
  assert.match(statement.sql, /entry ->> 'minutes'/);
  assert.match(statement.sql, /duration not recorded/);
  assert.match(statement.sql, /duration unavailable/);
  assert.match(statement.sql, /' minute' else ' minutes'/);
  assert.deepEqual(statement.params, [MAX_SECTION_MINUTES]);
  assert.doesNotMatch(statement.sql, /coalesce\([^)]*minutes[^)]*,\s*0\)/);
});

test(
  "actual Postgres agenda evidence preserves order, numeric zero and missing/invalid distinctions",
  {
    skip: process.env.EVRY_EVE_AGENDA_EVIDENCE_PROOF !== "1",
    timeout: 120_000,
  },
  async () => {
    const { startFixtureStack } =
      await import("@/lib/evry/eve/evals/fixtures/stack");
    const { createFixtureStore } =
      await import("@/lib/evry/eve/evals/fixtures/store");
    const stack = await startFixtureStack(process.cwd(), { migrate: false });
    try {
      const entries = [
        { title: "Welcome", minutes: 10, description: "Meet the team" },
        { title: "Pause", minutes: 0 },
        { title: "Closing", minutes: 1 },
        { title: "Missing" },
        { title: "Null", minutes: null },
        { title: "Invalid", minutes: "soon" },
        { title: "Legacy", minutes: "20" },
        { title: "Negative", minutes: -1 },
        { title: "Too long", minutes: MAX_SECTION_MINUTES + 1 },
        { title: "Fraction", minutes: 1.5 },
        { title: "Maximum", minutes: MAX_SECTION_MINUTES },
        { title: "Wrong type", minutes: false },
        {
          name: "Legacy title",
          minutes: 2,
          description: "Keep the saved notes",
        },
      ];
      const query = dialect.sqlToQuery(
        sql`select ${meetingAgendaItemEvidence(sql`entry`)} as evidence from jsonb_array_elements(${JSON.stringify(entries)}::jsonb) with ordinality as input(entry,ordinal) order by ordinal`
      );
      const statement = query.sql.replace(
        /\$(\d+)/g,
        (_match, index: string) => {
          const value = z
            .union([z.string(), z.number()])
            .parse(query.params[Number(index) - 1]);
          return typeof value === "number"
            ? String(value)
            : `'${value.replaceAll("'", "''")}'`;
        }
      );
      assert.deepEqual(
        createFixtureStore(stack.container)
          .query(statement)
          .map((r) => r.evidence),
        [
          "Welcome (10 minutes): Meet the team",
          "Pause (0 minutes)",
          "Closing (1 minute)",
          "Missing (duration not recorded)",
          "Null (duration not recorded)",
          "Invalid (duration unavailable)",
          "Legacy (20 minutes)",
          "Negative (duration unavailable)",
          "Too long (duration unavailable)",
          "Fraction (duration unavailable)",
          `Maximum (${MAX_SECTION_MINUTES} minutes)`,
          "Wrong type (duration unavailable)",
          "Legacy title (2 minutes): Keep the saved notes",
        ]
      );
    } finally {
      await stack.cleanup();
    }
  }
);
