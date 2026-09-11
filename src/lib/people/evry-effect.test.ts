import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { test } from "node:test";

test("People effects atomically require one exact admin-plus plant tenancy", () => {
  const source = readFileSync(
    path.join(process.cwd(), "src/lib/people/evry-effect.ts"),
    "utf8"
  );

  assert.match(
    source,
    /join users actor[\s\S]*actor\.id = a\.actor_user_id[\s\S]*actor\.church_id = a\.church_id[\s\S]*actor\.sending_church_id is null[\s\S]*actor\.sending_network_id is null[\s\S]*actor\.seat in \('owner', 'admin'\)/
  );
  assert.match(
    source,
    /if \(!\(await actorStillHoldsPeopleWrite\(input\.execution\)\)\)[\s\S]*status: "refused"[\s\S]*input\.targetIsCurrent/
  );
});
