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
 *
 * AND WHAT IT IS WRITTEN AS, in the same file (#660). The toggle used to build
 * its own URLs, with a rule that read "an `all` means no filter, so drop the
 * key" — true of `status`, `priority` and `category`, where "All" is the option
 * meaning *unfiltered*, and false of `view`, where `all` is a NAMED VIEW. So
 * pressing **All Tasks** pushed `/tasks` with no parameter, this parser applied
 * its default, and the page came back with **My Tasks** active: the tab could
 * not be selected at all. Each half was self-consistent; only together were
 * they wrong. They are one module now, round-tripped against each other in the
 * test — every view the toggle can write parses back to itself — and there is
 * one list of views for both to read.
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

/**
 * The views `/tasks` can be in — the one list the toggle renders from and the
 * parser accepts, so a view can never be writable and unreadable (#660).
 *
 * `assignments` is the group-by-owner view of open follow-ups (#470 AC-3); it
 * reads the same unfiltered set as `all`, so a consumer asking "whose tasks"
 * gets one answer for both.
 */
export const TASK_LIST_VIEWS = ["my_tasks", "all", "assignments"] as const;

export type TaskListView = (typeof TASK_LIST_VIEWS)[number];

/** The params the toggle and the filter selects may write. */
export type TaskListParamKey =
  | "view"
  | "completed"
  | "status"
  | "priority"
  | "category";

/** Is this URL value one of the views? Narrowing, so no caller casts. */
function isTaskListView(value: unknown): value is TaskListView {
  return (
    typeof value === "string" &&
    (TASK_LIST_VIEWS as readonly string[]).includes(value)
  );
}

/**
 * The query string one control's change produces, given the one on screen.
 *
 * `null` CLEARS and every other value SETS — including `"all"`. The dropped
 * special case is #660: this used to delete the key for `"all"` too, which made
 * `?view=all` unwritable. The filter selects were never relying on it — each
 * maps its own "All" option to `null` at the call site, which is where that
 * sentinel belongs, because it is the SELECT that has an "All" option.
 *
 * The cursor always goes: it names a position in the list being left.
 */
export function taskListParamsWith(
  current: URLSearchParams | string,
  key: TaskListParamKey,
  value: string | null
): URLSearchParams {
  const params = new URLSearchParams(current);

  if (value === null) params.delete(key);
  else params.set(key, value);

  params.delete("cursor");
  return params;
}

/**
 * What survives "Clear filters": the two params that are not filters.
 *
 * Here rather than in the toolbar for the reason the setter is: which keys are
 * a VIEW of the list and which are a FILTER on it is one fact, and a sixth
 * param added next round should not vanish on Clear because a component held a
 * private copy of that list.
 */
export function taskListParamsCleared(
  current: URLSearchParams | string
): URLSearchParams {
  const params = new URLSearchParams(current);
  const kept = new URLSearchParams();

  for (const key of ["view", "completed"] as const) {
    const value = params.get(key);
    if (value !== null) kept.set(key, value);
  }

  return kept;
}

export interface TaskListSearchParams {
  /** `"my_tasks"` unless the URL says one of the other `TASK_LIST_VIEWS`. */
  view: TaskListView;
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
    // The same list the toggle writes from, so a view can never be writable
    // and unreadable — which is exactly what `all` was (#660).
    view: isTaskListView(params.view) ? params.view : "my_tasks",
    showCompleted: params.completed === "true",
    status: parseEnumParam(params.status, taskStatusSchema),
    priority: parseEnumParam(params.priority, taskPrioritySchema),
    category: parseEnumParam(params.category, taskCategorySchema),
    cursor: typeof params.cursor === "string" ? params.cursor : undefined,
  };
}
