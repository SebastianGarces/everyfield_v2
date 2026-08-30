import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { test } from "node:test";

test("Task effects claim against one current seated plant tenancy", () => {
  const source = readFileSync(
    path.join(
      process.cwd(),
      "src/lib/evry/capabilities/tasks/atomic-effect.ts"
    ),
    "utf8"
  );

  assert.match(
    source,
    /select 1 from users current_actor[\s\S]*current_actor\.id = \$\{input\.execution\.actorUserId\}[\s\S]*current_actor\.church_id = \$\{input\.execution\.plantId\}[\s\S]*current_actor\.sending_church_id is null[\s\S]*current_actor\.sending_network_id is null[\s\S]*current_actor\.seat is not null[\s\S]*adminRequired[\s\S]*current_actor\.seat in \('owner', 'admin'\)/
  );
});
