import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { test } from "node:test";

import { PgDialect } from "drizzle-orm/pg-core";

import { db } from "@/db";
import { users } from "@/db/schema";

import { exactTaskAssigneeJoin } from "./assignees";

const source = (repoPath: string) =>
  readFileSync(path.join(process.cwd(), repoPath), "utf8");

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

test("every Task assignee selector, projection, owner, and writer uses the exact boundary", () => {
  const requiredConsumers = [
    ["src/app/(dashboard)/tasks/new/page.tsx", "exactTaskAssigneeJoin"],
    ["src/app/(dashboard)/tasks/[id]/page.tsx", "exactTaskAssigneeJoin"],
    ["src/lib/evry/capabilities/tasks/reads.ts", "exactTaskAssigneeJoin"],
    ["src/lib/evry/capabilities/tasks/resolver.ts", "isExactTaskAssignee"],
    ["src/lib/tasks/events.ts", "exactTaskAssigneeJoin"],
    ["src/lib/tasks/follow-up-ownership.ts", "exactTaskAssigneeConditions"],
    ["src/lib/tasks/follow-up-ownership.ts", "exactTaskAssigneeJoin"],
    ["src/lib/tasks/notifications.ts", "exactTaskAssigneeJoin"],
    ["src/lib/tasks/service.ts", "assertExactTaskAssignee"],
    ["src/lib/tasks/service.ts", "exactTaskAssigneeJoin"],
  ] as const;

  for (const [file, boundary] of requiredConsumers) {
    assert.ok(
      source(file).includes(boundary),
      `${file} does not consume ${boundary}`
    );
  }

  const service = source("src/lib/tasks/service.ts");
  assert.equal(
    (service.match(/exactTaskAssigneeJoin\(churchId\)/g) ?? []).length,
    3,
    "detail, list, and checklist projections must all hide malformed assignees"
  );
  assert.ok(
    (service.match(/assertExactTaskAssignee/g) ?? []).length >= 5,
    "create, update, recurrence parent, and recurrence children must all guard writes"
  );

  const atomic = source("src/lib/evry/capabilities/tasks/atomic-effect.ts");
  assert.equal(
    (atomic.match(/assignee\.sending_church_id is null/g) ?? []).length,
    2,
    "generic and follow-up atomic assignee checks both need church neutrality"
  );
  assert.equal(
    (atomic.match(/assignee\.sending_network_id is null/g) ?? []).length,
    2,
    "generic and follow-up atomic assignee checks both need network neutrality"
  );
});
