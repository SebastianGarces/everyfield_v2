import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { test } from "node:test";

import { PgDialect } from "drizzle-orm/pg-core";

import { codeOf } from "@/lib/auth/server-action-surface";

import { fixtureDocument } from "./fixtures.test-helper";
import { mintEvryPlanRequestKey } from "./request-key";
import {
  confirmEvryActionPlanStatement,
  reviseEvryActionPlanStatement,
} from "./statements";

const dialect = new PgDialect();
const PLAN_ID = "10000000-0000-4000-8000-000000000001";
const ACTOR_ID = "20000000-0000-4000-8000-000000000001";
const PLANT_ID = "30000000-0000-4000-8000-000000000001";
const REPLACEMENT_ID = "40000000-0000-4000-8000-000000000001";

function render(statement: {
  getSQL: () => Parameters<PgDialect["sqlToQuery"]>[0];
}): string {
  return dialect.sqlToQuery(statement.getSQL()).sql;
}

test("confirmation is one exact-scope state CAS and confirmation insert", () => {
  const query = render(
    confirmEvryActionPlanStatement({
      planId: PLAN_ID,
      actorUserId: ACTOR_ID,
      plantId: PLANT_ID,
      fingerprint: "a".repeat(64),
      decidedAt: new Date("2026-08-28T12:00:00.000Z"),
    })
  );

  assert.match(
    query,
    /with transitioned as \(\s*update evry_action_plan_states/i
  );
  assert.match(query, /from evry_action_plans p/i);
  assert.match(query, /p\.id = \$\d+::uuid/i);
  assert.match(query, /p\.actor_user_id = \$\d+::uuid/i);
  assert.match(query, /p\.church_id = \$\d+::uuid/i);
  assert.match(query, /p\.fingerprint = \$\d+/i);
  assert.match(query, /s\.status = 'awaiting_confirmation'/i);
  assert.match(query, /s\.status = 'approved'\s+and p\.expires_at <= \$\d+/i);
  assert.match(query, /when p\.expires_at <= \$\d+ then 'expired'/i);
  assert.match(query, /insert into evry_plan_confirmations/i);
  assert.match(query, /where t\.status = 'approved'/i);
});

test("revision supersedes by exact CAS before inserting one successor", () => {
  const query = render(
    reviseEvryActionPlanStatement({
      oldPlanId: PLAN_ID,
      oldFingerprint: "a".repeat(64),
      actorUserId: ACTOR_ID,
      plantId: PLANT_ID,
      replacementId: REPLACEMENT_ID,
      replacementRequestKey: mintEvryPlanRequestKey(),
      replacementIntentFingerprint: "c".repeat(64),
      replacementFingerprint: "b".repeat(64),
      replacementDocument: fixtureDocument(),
      createdAt: new Date("2026-08-28T12:00:00.000Z"),
      expiresAt: new Date("2026-08-28T12:15:00.000Z"),
    })
  );

  const cas = query.indexOf("update evry_action_plan_states");
  const planInsert = query.indexOf("insert into evry_action_plans");
  const stateInsert = query.indexOf("insert into evry_action_plan_states");
  assert.equal(cas >= 0, true);
  assert.equal(planInsert > cas, true);
  assert.equal(stateInsert > planInsert, true);
  assert.match(query, /p\.actor_user_id = \$\d+::uuid/i);
  assert.match(query, /p\.church_id = \$\d+::uuid/i);
  assert.match(query, /p\.fingerprint = \$\d+/i);
  assert.match(
    query,
    /s\.status in \('draft', 'awaiting_confirmation', 'approved'\)/i
  );
  assert.match(query, /supersedes_plan_id/i);
});

test("only the lifecycle table has a repository mutation path", () => {
  const source = codeOf(
    path.join(process.cwd(), "src/lib/evry/plans/repository.ts")
  );

  assert.doesNotMatch(source, /update\s+evry_action_plans/i);
  assert.doesNotMatch(source, /delete\s+from\s+evry_action_plans/i);
  assert.doesNotMatch(source, /\.update\(evryActionPlans\)/);
  assert.doesNotMatch(source, /\.delete\(evryActionPlans\)/);
  assert.doesNotMatch(source, /\.update\(evryPlanConfirmations\)/);
  assert.doesNotMatch(source, /\.delete\(evryPlanConfirmations\)/);
});

test("the public plan surface exposes neither prepared nor raw persistence", () => {
  const repository = codeOf(
    path.join(process.cwd(), "src/lib/evry/plans/repository.ts")
  );
  const service = codeOf(
    path.join(process.cwd(), "src/lib/evry/plans/service.ts")
  );
  const barrel = codeOf(
    path.join(process.cwd(), "src/lib/evry/plans/index.ts")
  );

  assert.match(repository, /type PreparedEvryActionPlan =/);
  assert.doesNotMatch(repository, /export type PreparedEvryActionPlan/);
  assert.doesNotMatch(service, /createdAt:\s*Date|expiresAt:\s*Date/);
  assert.doesNotMatch(barrel, /createEvryActionPlanRecord/);
  assert.doesNotMatch(barrel, /prepareEvryActionPlan|persistEvryActionPlan/);
});

test("0065 enforces exact TTL and append-only rows in Postgres", () => {
  const migration = readFileSync(
    path.join(process.cwd(), "src/db/migrations/0065_evry_action_plans.sql"),
    "utf8"
  );

  assert.match(
    migration,
    /"expires_at" = "evry_action_plans"\."created_at" \+ interval '15 minutes'/
  );
  assert.match(
    migration,
    /CREATE TRIGGER "evry_action_plans_immutable"\s+BEFORE UPDATE OR DELETE/i
  );
  assert.match(
    migration,
    /CREATE TRIGGER "evry_plan_confirmations_immutable"\s+BEFORE UPDATE OR DELETE/i
  );
  assert.doesNotMatch(migration, /ON DELETE cascade/i);
  assert.match(
    migration,
    /evry_action_plans_actor_request_unique_idx.+"church_id","actor_user_id","request_key"/i
  );
});

test("lineage and confirmation foreign keys bind the tenant tuple", () => {
  const snapshot = JSON.parse(
    readFileSync(
      path.join(process.cwd(), "src/db/migrations/meta/0065_snapshot.json"),
      "utf8"
    )
  ) as {
    tables: Record<
      string,
      {
        foreignKeys: Record<
          string,
          {
            columnsFrom: string[];
            columnsTo: string[];
            onDelete: string;
          }
        >;
      }
    >;
  };

  const plans = snapshot.tables["public.evry_action_plans"];
  assert.deepEqual(
    plans.foreignKeys.evry_action_plans_supersedes_fk.columnsFrom,
    ["supersedes_plan_id", "church_id"]
  );
  assert.deepEqual(
    plans.foreignKeys.evry_action_plans_supersedes_fk.columnsTo,
    ["id", "church_id"]
  );
  assert.equal(
    plans.foreignKeys.evry_action_plans_supersedes_fk.onDelete,
    "no action"
  );

  const confirmation =
    snapshot.tables["public.evry_plan_confirmations"].foreignKeys
      .evry_plan_confirmations_exact_plan_fk;
  assert.deepEqual(confirmation.columnsFrom, [
    "plan_id",
    "church_id",
    "actor_user_id",
    "plan_fingerprint",
  ]);
  assert.deepEqual(confirmation.columnsTo, [
    "id",
    "church_id",
    "actor_user_id",
    "fingerprint",
  ]);
  assert.equal(confirmation.onDelete, "no action");
});
