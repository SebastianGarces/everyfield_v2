import assert from "node:assert/strict";
import test from "node:test";

import {
  discoverTaskPageReadOperations,
  discoverTaskPageSources,
  TASKS_DISCOVERED_READ_EXCLUSIONS,
  taskReadIdentity,
} from "./tasks-source-discovery";

test("Task page discovery walks every authenticated route recursively", () => {
  assert.deepEqual(discoverTaskPageSources(), [
    "src/app/(dashboard)/tasks/[id]/page.tsx",
    "src/app/(dashboard)/tasks/new/page.tsx",
    "src/app/(dashboard)/tasks/page.tsx",
    "src/app/(dashboard)/tasks/templates/page.tsx",
  ]);
});

test("Task read exclusions are discovered boundary or query-helper calls", () => {
  const discovered = new Set(discoverTaskPageReadOperations());
  const identities = TASKS_DISCOVERED_READ_EXCLUSIONS.map(
    ({ identity }) => identity
  );
  assert.equal(new Set(identities).size, identities.length);
  for (const identity of identities)
    assert.equal(discovered.has(identity), true);
  assert.equal(identities.length, 7);
});

test("Task page discovery reports every awaited imported operation", () => {
  const read = taskReadIdentity;
  assert.deepEqual(discoverTaskPageReadOperations(), [
    read("src/app/(dashboard)/tasks/[id]/page.tsx", "db.select"),
    read("src/app/(dashboard)/tasks/[id]/page.tsx", "eq"),
    read("src/app/(dashboard)/tasks/[id]/page.tsx", "getTask"),
    read("src/app/(dashboard)/tasks/[id]/page.tsx", "listFollowUpAssignees"),
    read(
      "src/app/(dashboard)/tasks/[id]/page.tsx",
      "listPrerequisiteCandidates"
    ),
    read("src/app/(dashboard)/tasks/[id]/page.tsx", "listSubtasks"),
    read("src/app/(dashboard)/tasks/[id]/page.tsx", "listTaskPrerequisites"),
    read("src/app/(dashboard)/tasks/[id]/page.tsx", "verifySession"),
    read("src/app/(dashboard)/tasks/new/page.tsx", "db.select"),
    read("src/app/(dashboard)/tasks/new/page.tsx", "eq"),
    read("src/app/(dashboard)/tasks/new/page.tsx", "listFollowUpAssignees"),
    read(
      "src/app/(dashboard)/tasks/new/page.tsx",
      "listPrerequisiteCandidates"
    ),
    read("src/app/(dashboard)/tasks/new/page.tsx", "verifySession"),
    read("src/app/(dashboard)/tasks/page.tsx", "getTaskCounts"),
    read("src/app/(dashboard)/tasks/page.tsx", "listFollowUpAssignees"),
    read("src/app/(dashboard)/tasks/page.tsx", "listFollowUpContacts"),
    read("src/app/(dashboard)/tasks/page.tsx", "listOpenFollowUpTasks"),
    read("src/app/(dashboard)/tasks/page.tsx", "readTaskListPage"),
    read("src/app/(dashboard)/tasks/page.tsx", "taskListScope"),
    read("src/app/(dashboard)/tasks/page.tsx", "verifySession"),
    read(
      "src/app/(dashboard)/tasks/templates/page.tsx",
      "getCurrentUserChurch"
    ),
    read("src/app/(dashboard)/tasks/templates/page.tsx", "verifySession"),
  ]);
});
