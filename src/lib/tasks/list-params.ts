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
import type { z } from "zod";

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
 *
 * THE SCHEMA SUPPLIES THE TYPE, and there is no cast anywhere in this module —
 * which is the whole point of the module. It was written as a hand-rolled
 * structural stand-in (`{ safeParse(value: unknown): { success: boolean;
 * data?: unknown } }`) that threw the parsed type away, so the survivors had to
 * be asserted `as T[]` and `T` came entirely from the call site: with the
 * caller naming it, `parseEnumParam<TaskPriority>(params.status,
 * taskStatusSchema)` compiled and silently mistyped the filter. Typing the
 * parameter `z.ZodType<T>` and threading `safeParse`'s own output through means
 * the schema and the element type cannot disagree — and every caller infers `T`
 * rather than promising it.
 */
function parseEnumParam<T extends string>(
  raw: SearchParamValue,
  schema: z.ZodType<T>
): T[] | undefined {
  if (raw === undefined) return undefined;

  const values = [raw].flat().flatMap((value) => {
    const parsed = schema.safeParse(value);
    return parsed.success ? [parsed.data] : [];
  });

  return values.length > 0 ? [...new Set(values)] : undefined;
}

/** Everything `/tasks` reads out of its URL, with nothing taken on trust. */
export function parseTaskListSearchParams(params: {
  [key: string]: SearchParamValue;
}): TaskListSearchParams {
  return {
    view: params.view === "all" ? "all" : "my_tasks",
    showCompleted: params.completed === "true",
    status: parseEnumParam(params.status, taskStatusSchema),
    priority: parseEnumParam(params.priority, taskPrioritySchema),
    category: parseEnumParam(params.category, taskCategorySchema),
    cursor: typeof params.cursor === "string" ? params.cursor : undefined,
  };
}
