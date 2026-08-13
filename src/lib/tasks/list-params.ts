/**
 * WHAT `/tasks?…` MEANS, PARSED RATHER THAN CAST (#411).
 *
 * The page used to read its filters like this:
 *
 *     const status = statusParam ? ([statusParam].flat() as TaskStatus[]) : …
 *
 * A `searchParams` value is whatever is in the address bar, so that cast was a
 * promise about a string the page had never looked at. `listTasks` puts the
 * array straight into `inArray(tasks.status, status)` and `tasks.status` is a
 * text column under a CHECK constraint over the four legal values, so
 * `/tasks?status=bogus` reached Postgres, was refused, and — `/tasks` has no
 * error boundary — rendered the route's own failure. The same held for
 * `priority` and `category`. A typo in a shared link, or a stale bookmark from
 * before an enum value was renamed, was a broken page.
 *
 * So every list parameter is PARSED here, through the same zod enums the write
 * schemas use, and an unrecognised value is DROPPED rather than refused: a
 * filter is a view of a list, and the honest answer to "show me tasks whose
 * status is bogus" is the unfiltered list, not an error. A param that drops to
 * nothing is `undefined`, which is exactly "no filter" to `listTasks`.
 *
 * Pure and db-free, so the page's whole reading of the URL is testable without
 * a session or a database.
 */

import type { TaskCategory, TaskPriority, TaskStatus } from "@/db/schema";
import {
  taskCategorySchema,
  taskPrioritySchema,
  taskStatusSchema,
} from "@/lib/validations/tasks";

/** What Next hands a page: one value, several, or none. */
export type SearchParamValue = string | string[] | undefined;

export interface TaskListSearchParams {
  /** `"my_tasks"` unless the URL says `all`. */
  view: "all" | "my_tasks";
  showCompleted: boolean;
  status?: TaskStatus[];
  priority?: TaskPriority[];
  category?: TaskCategory[];
  cursor?: string;
}

/**
 * The recognised members of one repeated param, or `undefined` for "no filter".
 *
 * Duplicates are collapsed so `?status=blocked&status=blocked` is one predicate,
 * and order follows the URL, which is the order a reader would expect the chips
 * to be in.
 */
function parseEnumParam<T extends string>(
  raw: SearchParamValue,
  schema: { safeParse(value: unknown): { success: boolean; data?: unknown } }
): T[] | undefined {
  if (raw === undefined) return undefined;

  const values = [raw].flat().filter((value): value is string => {
    return schema.safeParse(value).success;
  });

  return values.length > 0 ? ([...new Set(values)] as T[]) : undefined;
}

/** Everything `/tasks` reads out of its URL, with nothing taken on trust. */
export function parseTaskListSearchParams(params: {
  [key: string]: SearchParamValue;
}): TaskListSearchParams {
  return {
    view: params.view === "all" ? "all" : "my_tasks",
    showCompleted: params.completed === "true",
    status: parseEnumParam<TaskStatus>(params.status, taskStatusSchema),
    priority: parseEnumParam<TaskPriority>(params.priority, taskPrioritySchema),
    category: parseEnumParam<TaskCategory>(params.category, taskCategorySchema),
    cursor: typeof params.cursor === "string" ? params.cursor : undefined,
  };
}
