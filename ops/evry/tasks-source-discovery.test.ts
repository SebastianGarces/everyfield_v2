import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";

import {
  discoverTaskActionIdentities,
  discoverTaskActionSources,
  discoverTaskPageReadOperations,
  discoverTaskPageSources,
  TASKS_DISCOVERED_READ_EXCLUSIONS,
  taskReadIdentity,
} from "./tasks-source-discovery";

test("Task action discovery starts from every server export", () => {
  assert.deepEqual(discoverTaskActionSources(), [
    "src/app/(dashboard)/tasks/actions.ts",
    "src/app/(dashboard)/tasks/follow-up-actions.ts",
    "src/app/(dashboard)/tasks/phase-prompt-actions.ts",
  ]);
  assert.deepEqual(discoverTaskActionIdentities(), [
    "action:src/app/(dashboard)/tasks/actions.ts → addSubtaskAction",
    "action:src/app/(dashboard)/tasks/actions.ts → bulkCompleteTasksAction",
    "action:src/app/(dashboard)/tasks/actions.ts → bulkRescheduleTasksAction",
    "action:src/app/(dashboard)/tasks/actions.ts → completeTaskAction",
    "action:src/app/(dashboard)/tasks/actions.ts → createTaskAction",
    "action:src/app/(dashboard)/tasks/actions.ts → deleteTaskAction",
    "action:src/app/(dashboard)/tasks/actions.ts → importTaskTemplateAction",
    "action:src/app/(dashboard)/tasks/actions.ts → loadMoreTasksAction",
    "action:src/app/(dashboard)/tasks/actions.ts → quickAddTaskAction",
    "action:src/app/(dashboard)/tasks/actions.ts → reopenTaskAction",
    "action:src/app/(dashboard)/tasks/actions.ts → setSubtaskCompletionAction",
    "action:src/app/(dashboard)/tasks/actions.ts → updateTaskAction",
    "action:src/app/(dashboard)/tasks/actions.ts → updateTaskStatusAction",
    "action:src/app/(dashboard)/tasks/follow-up-actions.ts → assignFollowUpAction",
    "action:src/app/(dashboard)/tasks/follow-up-actions.ts → createAndAssignFollowUpAction",
    "action:src/app/(dashboard)/tasks/follow-up-actions.ts → handOffFollowUpsAction",
    "action:src/app/(dashboard)/tasks/phase-prompt-actions.ts → dismissPhaseTemplatePromptAction",
    "action:src/app/(dashboard)/tasks/phase-prompt-actions.ts → importPhaseTemplatesAction",
  ]);
});

test("Task action discovery cannot overlook a new nested server module", () => {
  const repoRoot = mkdtempSync(path.join(tmpdir(), "task-action-discovery-"));
  const nested = path.join(
    repoRoot,
    "src/app/(dashboard)/tasks/nested/new-actions.ts"
  );
  mkdirSync(path.dirname(nested), { recursive: true });
  writeFileSync(
    nested,
    '"use server";\nexport async function newlyAddedTaskAction() {}\nexport const anotherTaskAction = async () => {};\n'
  );
  try {
    assert.deepEqual(discoverTaskActionSources(repoRoot), [
      "src/app/(dashboard)/tasks/nested/new-actions.ts",
    ]);
    assert.deepEqual(discoverTaskActionIdentities(repoRoot), [
      "action:src/app/(dashboard)/tasks/nested/new-actions.ts → anotherTaskAction",
      "action:src/app/(dashboard)/tasks/nested/new-actions.ts → newlyAddedTaskAction",
    ]);
  } finally {
    rmSync(repoRoot, { recursive: true, force: true });
  }
});

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
  assert.equal(identities.length, 9);
});

test("Task RSC discovery follows delegated server-component reads", () => {
  const read = taskReadIdentity;
  assert.deepEqual(discoverTaskPageReadOperations(), [
    read("src/app/(dashboard)/tasks/[id]/page.tsx", "db.select"),
    read("src/app/(dashboard)/tasks/[id]/page.tsx", "exactTaskAssigneeJoin"),
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
    read("src/app/(dashboard)/tasks/new/page.tsx", "exactTaskAssigneeJoin"),
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
    read("src/components/tasks/phase-template-prompt.tsx", "cookies"),
    read("src/components/tasks/phase-template-prompt.tsx", "getCurrentSession"),
    read(
      "src/components/tasks/phase-template-prompt.tsx",
      "readPhaseTemplatePrompt"
    ),
  ]);
});

test("Task RSC discovery cannot falsely pass a delegated Task read", () => {
  const repoRoot = mkdtempSync(path.join(tmpdir(), "task-read-discovery-"));
  const page = path.join(repoRoot, "src/app/(dashboard)/tasks/page.tsx");
  const delegated = path.join(
    repoRoot,
    "src/components/tasks/delegated-task-read.tsx"
  );
  const taskRead = path.join(repoRoot, "src/lib/tasks/new-task-read.ts");
  mkdirSync(path.dirname(page), { recursive: true });
  mkdirSync(path.dirname(delegated), { recursive: true });
  mkdirSync(path.dirname(taskRead), { recursive: true });
  writeFileSync(
    page,
    'import { DelegatedTaskRead } from "@/components/tasks/delegated-task-read";\nexport default async function Page() { return <DelegatedTaskRead />; }\n'
  );
  writeFileSync(
    delegated,
    'import { newlyAddedTaskRead } from "@/lib/tasks/new-task-read";\nexport async function DelegatedTaskRead() { const value = await newlyAddedTaskRead(); return <p>{value}</p>; }\n'
  );
  writeFileSync(taskRead, "export async function newlyAddedTaskRead() {}\n");
  try {
    assert.deepEqual(discoverTaskPageReadOperations(repoRoot), [
      taskReadIdentity(
        "src/components/tasks/delegated-task-read.tsx",
        "newlyAddedTaskRead"
      ),
    ]);
  } finally {
    rmSync(repoRoot, { recursive: true, force: true });
  }
});
