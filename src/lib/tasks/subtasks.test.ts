import assert from "node:assert/strict";
import { test } from "node:test";

import {
  SUBTASK_DEPTH_ERROR,
  SUBTASK_HAS_CHILDREN_ERROR,
  SUBTASK_PARENT_MISSING_ERROR,
  SUBTASK_SELF_ERROR,
  checkSubtaskNesting,
} from "./service";

// ----------------------------------------------------------------------------
// Subtasks (T-016) — the nesting rule.
//
// `parent_task_id` is a self-FK, so the database will accept a chain of any
// depth. One level is an application rule, and this is where it lives. The
// cases below are the four ways to break it; each has to be refused for its
// own reason, because refusing only the obvious one leaves the others open.
// ----------------------------------------------------------------------------

const TOP_LEVEL = { id: "task-a", parentTaskId: null };
const SUBTASK = { id: "task-b", parentTaskId: "task-a" };

test("a top-level task may take subtasks", () => {
  assert.equal(checkSubtaskNesting({ child: null, parent: TOP_LEVEL }), null);
  assert.equal(
    checkSubtaskNesting({
      child: { id: "task-c", hasSubtasks: false },
      parent: TOP_LEVEL,
    }),
    null
  );
});

test("a subtask may NOT take subtasks — nesting is one level", () => {
  assert.equal(
    checkSubtaskNesting({ child: null, parent: SUBTASK }),
    SUBTASK_DEPTH_ERROR
  );
});

test("a task that already has subtasks may not become one", () => {
  // The other half of the same rule. Without it, "give B to A" is refused but
  // "give A to B" achieves the identical two-level tree.
  assert.equal(
    checkSubtaskNesting({
      child: { id: "task-c", hasSubtasks: true },
      parent: TOP_LEVEL,
    }),
    SUBTASK_HAS_CHILDREN_ERROR
  );
});

test("a task may not be its own subtask", () => {
  assert.equal(
    checkSubtaskNesting({
      child: { id: TOP_LEVEL.id, hasSubtasks: false },
      parent: TOP_LEVEL,
    }),
    SUBTASK_SELF_ERROR
  );
});

test("a parent that is not in scope reads as missing", () => {
  // The loader is church-scoped, so a parent id from another tenant — or a
  // soft-deleted one — arrives here as `null`. It must be a refusal, never a
  // silently un-parented task.
  assert.equal(
    checkSubtaskNesting({ child: null, parent: null }),
    SUBTASK_PARENT_MISSING_ERROR
  );
});

test("the self check runs before the depth check", () => {
  // A subtask asked to parent itself is refused for the reason that actually
  // explains it, rather than the incidental one.
  assert.equal(
    checkSubtaskNesting({
      child: { id: SUBTASK.id, hasSubtasks: false },
      parent: SUBTASK,
    }),
    SUBTASK_SELF_ERROR
  );
});
