import assert from "node:assert/strict";
import test from "node:test";
import { TASK_LIST_READ, withTaskReadProofBoundaries } from "./reads";
import { executeAuthorizedEvryRead } from "@/lib/evry/reads/contract";
import type { EvryReadCapabilityAuthorization } from "@/lib/evry/eligibility/capabilities";
import { parseTaskListSearchParams } from "@/lib/tasks/list-params";
import { taskListScope } from "@/lib/tasks/list-page";

test("the production task read carries due-today, owner and pending filters into the real list pipeline", { skip: process.env.LIVE_DB_TESTS !== "1" }, async () => {
  const actor = {
    plantId: "30000000-0000-4000-8000-000000000001",
    userId: "20000000-0000-4000-8000-000000000001",
    seat: "owner",
  };
  const authorization = {
    actor,
    registration: { identity: TASK_LIST_READ.capabilityIdentity },
  } as EvryReadCapabilityAuthorization;
  let calls = 0;
    const artifact = await withTaskReadProofBoundaries(
      {
        async readTaskPlantTimeZone(plantId) {
          assert.equal(plantId, actor.plantId);
          return "America/New_York";
        },
        async readTaskListPage(plantId, userId, params) {
          calls++;
          assert.equal(plantId, actor.plantId);
          const parsed = parseTaskListSearchParams(params);
          assert.equal(parsed.showCompleted, false);
          assert.deepEqual(taskListScope(userId, parsed), {
            assignedToId: actor.userId,
            status: undefined,
            priority: undefined,
            category: undefined,
            dueDateFrom: "2026-09-07",
            dueDateTo: "2026-09-07",
          });
          return {
            tasks: [],
            total: 0,
            nextCursor: null,
            cursorAvailable: true,
            personNotes: {},
          };
        },
      },
      () =>
        executeAuthorizedEvryRead(
          TASK_LIST_READ,
          authorization,
          {
            literalUserText: "give me a list of tasks I have pending for today",
            pageContext: null,
            now: new Date("2026-09-08T02:00:00Z"),
          },
          {
            view: "my_tasks",
            showCompleted: false,
            status: [],
            priority: [],
            category: [],
            cursor: null,
            due: { kind: "relative", period: "today" },
          }
        )
    );
    assert.equal(calls, 1);
    assert.equal(artifact?.kind, "read");
    if (artifact?.kind === "read")
      assert.equal(artifact.title, "Tasks due today");
});

test("invalid dates fail before any read; own view cannot be widened by an assignee argument", () => {
  assert.equal(
    TASK_LIST_READ.inputSchema.safeParse({
      view: "my_tasks",
      showCompleted: false,
      status: [],
      priority: [],
      category: [],
      cursor: null,
      due: { kind: "range", from: "2026-09-10", through: "2026-09-07" },
    }).success,
    false
  );
  const scope = taskListScope(
    "self",
    parseTaskListSearchParams({
      view: "my_tasks",
      assignedToId: "20000000-0000-4000-8000-000000000002",
    })
  );
  assert.equal(scope.assignedToId, "self");
});
