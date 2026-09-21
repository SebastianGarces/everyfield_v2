import assert from "node:assert/strict";
import { test } from "node:test";
import { PgDialect } from "drizzle-orm/pg-core";
import { z } from "zod";
import {
  meetingsQueryShape,
  meetingsQueryStatement,
} from "./operations-meetings";

const schema = z.strictObject(meetingsQueryShape);
const plant = "10000000-0000-4000-8000-000000000001";
const now = new Date("2026-09-20T16:00:00.001Z");
const dialect = new PgDialect();

test("meeting timing is relative to the trusted instant and church timezone, not a day boundary", () => {
  for (const timing of ["upcoming", "past"] as const) {
    const query = dialect.sqlToQuery(
      meetingsQueryStatement(
        schema.parse({ where: { all: [{ timing }] }, query: { mode: "list" } }),
        plant,
        now,
        "America/New_York"
      )
    );
    assert.match(
      query.sql,
      timing === "upcoming"
        ? /m\.datetime >= \(\$\d+::timestamptz at time zone \$\d+\)/
        : /m\.datetime < \(\$\d+::timestamptz at time zone \$\d+\)/
    );
    assert.ok(query.params.includes(now.toISOString()));
    assert.ok(query.params.includes("America/New_York"));
    assert.ok(!query.params.includes("cancelled"));
    assert.ok(!query.params.includes("completed"));
  }
});

test("timing composes with independent status and date filters", () => {
  const query = dialect.sqlToQuery(
    meetingsQueryStatement(
      schema.parse({
        where: {
          all: [
            {
              timing: "upcoming",
              statuses: ["planning", "ready"],
              date: { kind: "relative", period: "today" },
            },
          ],
        },
        query: { mode: "count" },
      }),
      plant,
      now,
      "America/New_York"
    )
  );
  assert.match(query.sql, /m\.datetime::date/);
  assert.match(query.sql, /m\.datetime >=/);
  assert.ok(query.params.includes("2026-09-20"));
  assert.ok(query.params.includes("planning"));
  assert.ok(query.params.includes("ready"));
});

test("models cannot supply the relative clock, timezone or tenant", () => {
  for (const override of [
    { now: "2099-01-01T00:00:00Z" },
    { timeZone: "UTC" },
    { churchId: plant },
  ]) {
    assert.equal(
      schema.safeParse({
        where: { all: [{ timing: "upcoming", ...override }] },
        query: { mode: "list" },
      }).success,
      false
    );
    assert.equal(
      schema.safeParse({
        where: { all: [{ timing: "upcoming" }] },
        query: { mode: "list" },
        ...override,
      }).success,
      false
    );
  }
  assert.equal(
    schema.safeParse({
      where: { all: [{ timing: "soon" }] },
      query: { mode: "list" },
    }).success,
    false
  );
});
