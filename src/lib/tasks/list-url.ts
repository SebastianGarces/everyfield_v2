// ============================================================================
// WHAT `/tasks?…` IS WRITTEN AS — the other half of `./list-params` (#660).
//
// AN IMPORT-FREE LEAF, so both halves can hold it. The view toggle is a CLIENT
// component and `./list-params` parses through the zod enums in
// `@/lib/validations/tasks`; having the toggle import the parser for one string
// helper would ship those schemas to the browser to build a query string. (It
// would not trip the bundle guard — that one walks for `src/db/index.ts`, the
// neon client, which none of this reaches — so this is weight and direction,
// not a rule.) Nothing here imports anything, which is what lets the writer and
// the reader share one definition instead of agreeing by hand.
//
// ----------------------------------------------------------------------------
// WHY THE WRITER IS A MODULE AT ALL, AND NOT SIX LINES IN THE TOGGLE
// ----------------------------------------------------------------------------
//
// Because the two halves disagreed, and nothing could see it. The toggle built
// its URL with a rule that read "an `all` means no filter, so drop the key" —
// true of `status`, `priority` and `category`, where "All" is the option
// meaning *unfiltered*, and false of `view`, where `all` is a NAMED VIEW. So
// pressing **All Tasks** pushed `/tasks` with no parameter, the parser applied
// its default, and the page came back with **My Tasks** active. The tab could
// not be selected at all (#660).
//
// The two rules now live one file apart and are round-tripped against each
// other by `list-params.test.ts`: every view this module can WRITE parses back
// to itself. A fourth view joins that assertion by being added to
// `TASK_LIST_VIEWS`, which is the one list both halves read.
// ============================================================================

/**
 * The views `/tasks` can be in.
 *
 * `assignments` is the group-by-owner view of open follow-ups (#470 AC-3); it
 * reads the same unfiltered set as `all`, so a consumer asking "whose tasks"
 * gets one answer for both.
 */
export const TASK_LIST_VIEWS = ["my_tasks", "all", "assignments"] as const;

export type TaskListView = (typeof TASK_LIST_VIEWS)[number];

/** Is this URL value one of the views? Narrowing, so no caller casts. */
export function isTaskListView(value: unknown): value is TaskListView {
  return (
    typeof value === "string" &&
    (TASK_LIST_VIEWS as readonly string[]).includes(value)
  );
}

/**
 * The query string one control's change produces, given the one on screen.
 *
 * `null` CLEARS and every other value SETS — including `"all"`. The dropped
 * special case is #660: this function used to delete the key for `"all"` too,
 * which made `?view=all` unwritable. The filter selects were never relying on
 * it — each already maps its own "All" option to `null` at the call site, which
 * is where that sentinel belongs, because it is the SELECT that has an "All"
 * option and not this function.
 *
 * The cursor always goes: a page cursor names a position in the list the
 * reader is leaving.
 */
export function taskListParamsWith(
  current: URLSearchParams | string,
  key: string,
  value: string | null
): URLSearchParams {
  const params = new URLSearchParams(current);

  if (value === null) params.delete(key);
  else params.set(key, value);

  params.delete("cursor");
  return params;
}
