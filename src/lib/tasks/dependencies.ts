import { db } from "@/db";
import { taskDependencies, tasks, type TaskStatus } from "@/db/schema";
import { and, eq, inArray, isNull, ne, sql } from "drizzle-orm";
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

/**
 * The INSERT that writes one edge. Exported so tests can pin the rendered
 * SQL: it is an `insert … select` joining both task rows on church_id, so a
 * missing, deleted, or cross-church prerequisite inserts zero rows.
 *
 * drizzle's insert-from-select emits every insertable column in table order,
 * so the select names them all.
 */
export function buildAddDependencyStatement(
  churchId: string,
  taskId: string,
  prerequisiteTaskId: string
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
          prerequisiteTask,
          eq(prerequisiteTask.churchId, dependentTask.churchId)
        )
        .where(
          and(
            eq(dependentTask.id, taskId),
            eq(prerequisiteTask.id, prerequisiteTaskId),
            eq(dependentTask.churchId, churchId),
            isNull(dependentTask.deletedAt),
            isNull(prerequisiteTask.deletedAt)
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
    .where(eq(taskDependencies.churchId, churchId));
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

  if (uniqueIds.length > 0) {
    const found = await db
      .select({ id: tasks.id })
      .from(tasks)
      .where(
        and(
          eq(tasks.churchId, churchId),
          inArray(tasks.id, uniqueIds),
          isNull(tasks.deletedAt)
        )
      );
    if (found.length !== uniqueIds.length) {
      throw new Error(DEPENDENCY_CROSS_CHURCH_ERROR);
    }
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

  const deleteExisting = db
    .delete(taskDependencies)
    .where(
      and(
        eq(taskDependencies.churchId, churchId),
        eq(taskDependencies.taskId, taskId)
      )
    );

  if (uniqueIds.length === 0) {
    await deleteExisting;
    return;
  }

  const inserts = uniqueIds.map((prerequisiteTaskId) =>
    buildAddDependencyStatement(churchId, taskId, prerequisiteTaskId)
  );

  // Delete then insert, one batch: neon-http has no interactive transaction,
  // and `db.batch` is all-or-nothing for errors. A 0-row insert is not an
  // error — the church-scoped SELECT above is what makes that case a refusal
  // before we get here. The insert…select is still the tenancy guard.
  await db.batch([deleteExisting, ...inserts]);
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
    .innerJoin(tasks, eq(tasks.id, taskDependencies.prerequisiteTaskId))
    .where(
      and(
        eq(taskDependencies.churchId, churchId),
        eq(taskDependencies.taskId, taskId),
        eq(tasks.churchId, churchId),
        isNull(tasks.deletedAt)
      )
    )
    .orderBy(tasks.title, tasks.id);
}

export async function listPrerequisiteCandidates(
  churchId: string,
  excludeTaskId?: string
): Promise<PrerequisiteCandidate[]> {
  const conditions = [eq(tasks.churchId, churchId), isNull(tasks.deletedAt)];
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
 */
export async function blockedTaskIdsAmong(
  churchId: string,
  taskIds: readonly string[]
): Promise<Set<string>> {
  if (taskIds.length === 0) return new Set();

  const rows = await db
    .selectDistinct({ taskId: taskDependencies.taskId })
    .from(taskDependencies)
    .innerJoin(tasks, eq(tasks.id, taskDependencies.prerequisiteTaskId))
    .where(
      and(
        eq(taskDependencies.churchId, churchId),
        inArray(taskDependencies.taskId, [...taskIds]),
        eq(tasks.churchId, churchId),
        isNull(tasks.deletedAt),
        ne(tasks.status, "complete")
      )
    );

  return new Set(rows.map((row) => row.taskId));
}
