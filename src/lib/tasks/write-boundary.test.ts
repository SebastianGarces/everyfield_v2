import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { test } from "node:test";

import { stripComments } from "@/lib/testing/source-span";

function source(relativePath: string): string {
  return stripComments(
    readFileSync(path.join(process.cwd(), relativePath), "utf8")
  );
}

test("the Task insert boundary reports authorization separately from landed rows", () => {
  const boundary = source("src/lib/tasks/write-boundary.ts");

  assert.match(
    boundary,
    /\{ authorized: false; inserted: \[\] \}\s*\|\s*\{ authorized: true; inserted: Task\[\] \}/
  );
  assert.match(boundary, /left join landed on true/);
  assert.match(
    boundary,
    /creator\.id = p\.created_by_id[\s\S]*creator\.church_id = p\.church_id[\s\S]*creator\.sending_church_id is null[\s\S]*creator\.sending_network_id is null/
  );
});

test("every Task insert caller refuses authorization denial explicitly", () => {
  const callers = [
    ["src/lib/tasks/import.ts", 1],
    ["src/lib/tasks/events.ts", 1],
    ["src/lib/tasks/service.ts", 3],
  ] as const;

  for (const [file, expectedCalls] of callers) {
    const text = source(file);
    assert.equal(
      text.match(/await insertExactTenantTasks\(/g)?.length ?? 0,
      expectedCalls,
      `${file} gained or lost a boundary call; classify its denial semantics here`
    );
    assert.equal(
      text.match(/if \(!write\.authorized\)/g)?.length ?? 0,
      expectedCalls,
      `${file} can treat authorization denial like a benign empty insert`
    );
  }
});
