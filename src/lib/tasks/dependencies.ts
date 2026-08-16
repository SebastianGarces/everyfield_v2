import { db } from "@/db";
import { taskDependencies, tasks, type TaskStatus } from "@/db/schema";
import { and, eq, inArray, isNull, ne, notInArray, sql } from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";

// ============================================================================
// Task dependencies (T-015)
//
// A task may name one or more prerequisites. Blocked-ness is DERIVED: a task
// is blocked while any live prerequisite is not `complete`. Completing the
// last one clears the badge on the next render — nothing writes `status`.
//
// Cycles are refused at write time. Church scope is the insert itself: the
// row is selected from both task ends joined on church_id, so a foreign
// church's id inserts nothing.
// ============================================================================

export const DEPENDENCY_CYCLE_ERROR =
  "That would create a cycle — a task cannot wait on itself, even through other tasks.";

export const DEPENDENCY_CROSS_CHURCH_ERROR =
  "A task can only wait on another task in the same church.";

export const DEPENDENCY_SELF_ERROR = "A task cannot wait on itself.";

export const DEPENDENCY_TASK_MISSING_ERROR = "Task not found";

export interface DependencyEdge {
  taskId: string;
  prerequisiteTaskId: string;
}

export interface PrerequisiteRef {
  id: string;
  title: string;
  status: TaskStatus;
}

export interface PrerequisiteCandidate {
  id: string;
  title: string;
  status: TaskStatus;
}

/**
 * True if adding `taskId → prerequisiteTaskId` (task waits on prerequisite)
 * would close a cycle, including a self-loop.
 *
 * Walks the graph of existing edges plus the candidate. A→B already stored
 * and B→A proposed is the two-node case; longer chains are the same walk.
 */
export function wouldCreateCycle(
  existing: readonly DependencyEdge[],
  taskId: string,
  prerequisiteTaskId: string
): boolean {
  if (taskId === prerequisiteTaskId) return true;
  return hasCycle([...existing, { taskId, prerequisiteTaskId }]);
}

/**
 * True if the directed graph `task → prerequisite` contains a cycle.
 */
export function hasCycle(edges: readonly DependencyEdge[]): boolean {
  const prereqsOf = new Map<string, string[]>();
  const nodes = new Set<string>();

  for (const edge of edges) {
    nodes.add(edge.taskId);
    nodes.add(edge.prerequisiteTaskId);
    const list = prereqsOf.get(edge.taskId);
    if (list) list.push(edge.prerequisiteTaskId);
    else prereqsOf.set(edge.taskId, [edge.prerequisiteTaskId]);
  }

  const visiting = new Set<string>();
  const visited = new Set<string>();

  function dfs(node: string): boolean {
    if (visiting.has(node)) return true;
    if (visited.has(node)) return false;
    visiting.add(node);
    for (const next of prereqsOf.get(node) ?? []) {
      if (dfs(next)) return true;
    }
    visiting.delete(node);
    visited.add(node);
    return false;
  }

  for (const node of nodes) {
    if (dfs(node)) return true;
  }
  return false;
}

const dependentTask = alias(tasks, "dependent");
const prerequisiteTask = alias(tasks, "prerequisite");

function requestedIdValues(uniqueIds: readonly string[]) {
  return sql.join(
    uniqueIds.map((id) => sql`(${id}::uuid)`),
    sql`, `
  );
}

/**
 * True when every requested id is a live top-level task in `churchId`.
 *
 * Inner-joins the requested ids onto live top-level same-church tasks, so a
 * missing, deleted, subtask, or cross-church id shortens the count. Shared by
 * the insert…select and dropStale: a short set must write NOTHING.
 */
function allRequestedAreLiveTopLevel(
  churchId: string,
  uniqueIds: readonly string[]
) {
  return sql`(
    select count(*)::int
    from (values ${requestedIdValues(uniqueIds)}) as requested(id)
    inner join ${tasks}
      on ${tasks.id} = requested.id
     and ${eq(tasks.churchId, churchId)}
     and ${isNull(tasks.deletedAt)}
     and ${isNull(tasks.parentTaskId)}
  ) = ${uniqueIds.length}`;
}

/**
 * The INSERT that writes the desired edges. Exported so tests can pin the
 * rendered SQL: it is an `insert … select` joining both task rows on
 * church_id, inner-joining every requested id as a live top-level same-church
 * task, and emitting rows only when that count equals the requested set.
 *
 * drizzle's insert-from-select emits every insertable column in table order,
 * so the select names them all.
 */
export function buildAddDependencyStatement(
  churchId: string,
  taskId: string,
  prerequisiteTaskIds: readonly string[]
) {
  return db
    .insert(taskDependencies)
    .select((qb) =>
      qb
        .select({
          id: sql`gen_random_uuid()`,
          churchId: dependentTask.churchId,
          taskId: dependentTask.id,
          prerequisiteTaskId: prerequisiteTask.id,
          createdAt: sql`now()`,
        })
        .from(dependentTask)
        .innerJoin(
          sql`(values ${requestedIdValues(prerequisiteTaskIds)}) as requested(id)`,
          sql`true`
        )
        .innerJoin(
          prerequisiteTask,
          and(
            eq(prerequisiteTask.churchId, dependentTask.churchId),
            sql`${prerequisiteTask.id} = requested.id`
          )
        )
        .where(
          and(
            eq(dependentTask.id, taskId),
            eq(dependentTask.churchId, churchId),
            isNull(dependentTask.deletedAt),
            isNull(prerequisiteTask.deletedAt),
            isNull(prerequisiteTask.parentTaskId),
            allRequestedAreLiveTopLevel(churchId, prerequisiteTaskIds)
          )
        )
        .getSQL()
    )
    .onConflictDoNothing({
      target: [taskDependencies.taskId, taskDependencies.prerequisiteTaskId],
    })
    .returning({
      taskId: taskDependencies.taskId,
      prerequisiteTaskId: taskDependencies.prerequisiteTaskId,
      churchId: taskDependencies.churchId,
    });
}

async function loadChurchEdges(churchId: string): Promise<DependencyEdge[]> {
  return db
    .select({
      taskId: taskDependencies.taskId,
      prerequisiteTaskId: taskDependencies.prerequisiteTaskId,
    })
    .from(taskDependencies)
    .innerJoin(
      dependentTask,
      and(
        eq(dependentTask.id, taskDependencies.taskId),
        eq(dependentTask.churchId, taskDependencies.churchId)
      )
    )
    .innerJoin(
      prerequisiteTask,
      and(
        eq(prerequisiteTask.id, taskDependencies.prerequisiteTaskId),
        eq(prerequisiteTask.churchId, taskDependencies.churchId)
      )
    )
    .where(
      and(
        eq(taskDependencies.churchId, churchId),
        isNull(dependentTask.deletedAt),
        isNull(prerequisiteTask.deletedAt)
      )
    );
}

async function assertTaskInChurch(
  churchId: string,
  taskId: string
): Promise<void> {
  const [row] = await db
    .select({ id: tasks.id })
    .from(tasks)
    .where(
      and(
        eq(tasks.churchId, churchId),
        eq(tasks.id, taskId),
        isNull(tasks.deletedAt)
      )
    )
    .limit(1);

  if (!row) throw new Error(DEPENDENCY_TASK_MISSING_ERROR);
}

/**
 * Replace the prerequisite set of `taskId` with `prerequisiteTaskIds`.
 *
 * Empty means "wait on nothing". Duplicates are dropped. A self-id, a cycle,
 * or an id that is not a live task in this church is a refusal and writes
 * nothing.
 */
export async function setTaskPrerequisites(
  churchId: string,
  taskId: string,
  prerequisiteTaskIds: readonly string[]
): Promise<void> {
  await assertTaskInChurch(churchId, taskId);

  const uniqueIds = [...new Set(prerequisiteTaskIds)];
  if (uniqueIds.some((id) => id === taskId)) {
    throw new Error(DEPENDENCY_SELF_ERROR);
  }

  const existing = await loadChurchEdges(churchId);
  const nextGraph = [
    ...existing.filter((edge) => edge.taskId !== taskId),
    ...uniqueIds.map((prerequisiteTaskId) => ({
      taskId,
      prerequisiteTaskId,
    })),
  ];
  if (hasCycle(nextGraph)) {
    throw new Error(DEPENDENCY_CYCLE_ERROR);
  }

  // Insert the desired set FIRST and drop stale edges in the SAME batch.
  // The insert…select emits rows only when every requested id is a live
  // top-level same-church task; dropStale is gated on that same predicate,
  // so a short set writes NOTHING. Deleting first would wipe the old edges
  // and then treat a 0-row insert as success.
  const dropStale = db
    .delete(taskDependencies)
    .where(
      and(
        eq(taskDependencies.churchId, churchId),
        eq(taskDependencies.taskId, taskId),
        uniqueIds.length > 0
          ? notInArray(taskDependencies.prerequisiteTaskId, uniqueIds)
          : undefined,
        uniqueIds.length > 0
          ? allRequestedAreLiveTopLevel(churchId, uniqueIds)
          : undefined
      )
    );
  await db.batch([
    ...(uniqueIds.length > 0
      ? [buildAddDependencyStatement(churchId, taskId, uniqueIds)]
      : []),
    dropStale,
  ] as unknown as [typeof dropStale, ...(typeof dropStale)[]]);

  // A refused replace leaves the stored set unchanged. Throw only after
  // reading it — never from a mid-write rowcount, which would mean the
  // inserts had already committed.
  if (uniqueIds.length === 0) return;

  const stored = await db
    .select({ id: prerequisiteTask.id })
    .from(taskDependencies)
    .innerJoin(
      prerequisiteTask,
      and(
        eq(prerequisiteTask.id, taskDependencies.prerequisiteTaskId),
        eq(prerequisiteTask.churchId, taskDependencies.churchId)
      )
    )
    .where(
      and(
        eq(taskDependencies.churchId, churchId),
        eq(taskDependencies.taskId, taskId),
        isNull(prerequisiteTask.deletedAt),
        isNull(prerequisiteTask.parentTaskId)
      )
    );
  const storedIds = new Set(stored.map((row) => row.id));
  if (
    storedIds.size !== uniqueIds.length ||
    uniqueIds.some((id) => !storedIds.has(id))
  ) {
    throw new Error(DEPENDENCY_CROSS_CHURCH_ERROR);
  }
}

export async function listTaskPrerequisites(
  churchId: string,
  taskId: string
): Promise<PrerequisiteRef[]> {
  return db
    .select({
      id: tasks.id,
      title: tasks.title,
      status: tasks.status,
    })
    .from(taskDependencies)
    .innerJoin(
      tasks,
      and(
        eq(tasks.id, taskDependencies.prerequisiteTaskId),
        eq(tasks.churchId, taskDependencies.churchId)
      )
    )
    .where(
      and(
        eq(taskDependencies.churchId, churchId),
        eq(taskDependencies.taskId, taskId),
        isNull(tasks.deletedAt)
      )
    )
    .orderBy(tasks.title, tasks.id);
}

export async function listPrerequisiteCandidates(
  churchId: string,
  excludeTaskId?: string
): Promise<PrerequisiteCandidate[]> {
  const conditions = [
    eq(tasks.churchId, churchId),
    isNull(tasks.deletedAt),
    // A subtask is a checklist item, not a task (T-016). It does not belong
    // in a prerequisite picker.
    isNull(tasks.parentTaskId),
  ];
  if (excludeTaskId) {
    conditions.push(ne(tasks.id, excludeTaskId));
  }

  return db
    .select({
      id: tasks.id,
      title: tasks.title,
      status: tasks.status,
    })
    .from(tasks)
    .where(and(...conditions))
    .orderBy(tasks.title, tasks.id);
}

/**
 * Which of `taskIds` currently wait on an incomplete, live prerequisite.
 *
 * Exported as a builder so tests can pin the rendered SQL: church_id is in
 * the JOIN, incomplete is `status <> 'complete'`, and a soft-deleted
 * prerequisite does not block.
 */
export function blockedTaskIdsQuery(
  churchId: string,
  taskIds: readonly string[]
) {
  return db
    .selectDistinct({ taskId: taskDependencies.taskId })
    .from(taskDependencies)
    .innerJoin(
      tasks,
      and(
        eq(tasks.id, taskDependencies.prerequisiteTaskId),
        eq(tasks.churchId, taskDependencies.churchId)
      )
    )
    .where(
      and(
        eq(taskDependencies.churchId, churchId),
        inArray(taskDependencies.taskId, [...taskIds]),
        isNull(tasks.deletedAt),
        ne(tasks.status, "complete")
      )
    );
}

export async function blockedTaskIdsAmong(
  churchId: string,
  taskIds: readonly string[]
): Promise<Set<string>> {
  if (taskIds.length === 0) return new Set();
  const rows = await blockedTaskIdsQuery(churchId, taskIds);
  return new Set(rows.map((row) => row.taskId));
}
