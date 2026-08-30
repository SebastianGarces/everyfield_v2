import assert from "node:assert/strict";
import { test } from "node:test";

import { PgDialect } from "drizzle-orm/pg-core";

import { db } from "@/db";
import { tasks, users } from "@/db/schema";

import { exactTaskAssigneeJoin, taskAssigneeIsAvailable } from "./assignees";

test("the reusable assignee predicate encodes exactly one plant tenancy", () => {
  const query = db
    .select({ id: users.id })
    .from(users)
    .where(exactTaskAssigneeJoin("00000000-0000-4000-8000-000000000001"));
  const { sql } = new PgDialect().sqlToQuery(query.getSQL());

  assert.match(sql, /"users"\."church_id" = \$1/);
  assert.match(sql, /"users"\."sending_church_id" is null/);
  assert.match(sql, /"users"\."sending_network_id" is null/);
});

test("the mutation predicate admits unassigned or exact-plant rows only", () => {
  const query = db
    .select({ id: tasks.id })
    .from(tasks)
    .where(
      taskAssigneeIsAvailable(
        "00000000-0000-4000-8000-000000000001",
        tasks.assignedToId
      )
    );
  const { sql } = new PgDialect().sqlToQuery(query.getSQL());

  assert.match(sql, /"tasks"\."assigned_to_id" is null/);
  assert.match(sql, /exists \(select/);
  assert.match(sql, /"exact_task_assignee"\."id" = "tasks"\."assigned_to_id"/);
  assert.match(sql, /"exact_task_assignee"\."church_id" = \$1/);
  assert.match(sql, /"exact_task_assignee"\."sending_church_id" is null/);
  assert.match(sql, /"exact_task_assignee"\."sending_network_id" is null/);
});
