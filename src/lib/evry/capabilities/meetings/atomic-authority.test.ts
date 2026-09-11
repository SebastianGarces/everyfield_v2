import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { test } from "node:test";

test("Meetings effects claim against one current admin-plus plant tenancy", () => {
  const source = readFileSync(
    path.join(
      process.cwd(),
      "src/lib/evry/capabilities/meetings/atomic-effect.ts"
    ),
    "utf8"
  );

  assert.match(
    source,
    /join users current_actor[\s\S]*current_actor\.id = a\.actor_user_id[\s\S]*current_actor\.church_id = a\.church_id[\s\S]*current_actor\.sending_church_id is null[\s\S]*current_actor\.sending_network_id is null[\s\S]*current_actor\.seat in \('owner', 'admin'\)/
  );
});
