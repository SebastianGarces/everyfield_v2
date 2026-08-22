/**
 * ONE PAGE OF `/tasks`, READ THE SAME WAY TWICE (#320).
 *
 * `/tasks/page.tsx` and the "Load more" action both need a page of tasks plus
 * the person notes the cards on it print. Written out at both call sites, the
 * two would drift — the page's version already carries a paragraph explaining
 * why the note lookup is church-scoped, and a copy in an action is exactly
 * where that argument gets lost. So the reading lives here and both callers
 * ask for it.
 *
 * `now` is NOT read here: the page takes one instant for the whole render and
 * hands it to the cards (`memory/invariants.md` → Date & Time Rendering).
 */

import { getLatestPersonNote } from "@/lib/people/service";
import {
  parseTaskListSearchParams,
  type SearchParamValue,
} from "@/lib/tasks/list-params";
import {
  listTasks,
  type ListTasksOptions,
  type TaskListRow,
} from "@/lib/tasks/service";

/** How many tasks one page of `/tasks` shows. */
export const TASKS_PAGE_SIZE = 50;

export interface TaskListPage {
  tasks: TaskListRow[];
  total: number;
  nextCursor: string | null;
  /** `personId` → latest note, for the person-related cards on THIS page. */
  personNotes: Record<string, string>;
}

/**
 * Read one page of the task list under the filters the URL names.
 *
 * `cursor` overrides whatever the URL said: the URL's cursor is where the FIRST
 * page started, and "Load more" walks on from where the client has got to.
 */
/**
 * WHICH TASKS `/tasks?…` IS ABOUT, as `listTasks` options.
 *
 * The one place the URL becomes a filter set, because more than one reader
 * needs it and a second copy is how they drift. The list is drawn from it and
 * so are the badges above the list, which is what #613 cost: the badges were
 * scoped by church and assignee only, so `?category=follow_up` counted the
 * whole church and claimed "1 active" over a "No tasks found" list.
 *
 * Paging is NOT here — `cursor`, `limit` and the sort order belong to the
 * reader walking the rows, and mean nothing to a count.
 */
export function taskListScope(
  userId: string,
  params: { [key: string]: SearchParamValue }
): ListTasksOptions {
  const parsed = parseTaskListSearchParams(params);

  return {
    status: parsed.status,
    priority: parsed.priority,
    category: parsed.category,
    assignedToId: parsed.view === "my_tasks" ? userId : undefined,
    includeCompleted: parsed.showCompleted,
  };
}

export async function readTaskListPage(
  churchId: string,
  userId: string,
  params: { [key: string]: SearchParamValue },
  cursor?: string
): Promise<TaskListPage> {
  const parsed = parseTaskListSearchParams(params);

  const result = await listTasks(churchId, {
    ...taskListScope(userId, params),
    cursor: cursor ?? parsed.cursor,
    sortBy: "due_date",
    sortDir: "asc",
    limit: TASKS_PAGE_SIZE,
  });

  // CHURCH-SCOPED, because `related_id` is a value a client chose: the create
  // action accepts `relatedType: "person"` with any uuid, so a task pointing at
  // ANOTHER tenant's person would otherwise print that person's latest note on
  // this card. `getLatestPersonNote` takes the church and joins through the
  // person row, so a foreign id reads as "no note".
  const uniquePersonIds = [
    ...new Set(
      result.tasks
        .filter((task) => task.relatedType === "person" && task.relatedId)
        .map((task) => task.relatedId!)
    ),
  ];

  const personNotes: Record<string, string> = {};
  if (uniquePersonIds.length > 0) {
    const noteResults = await Promise.all(
      uniquePersonIds.map(async (personId) => ({
        personId,
        note: (await getLatestPersonNote(churchId, personId))?.note ?? null,
      }))
    );
    for (const { personId, note } of noteResults) {
      if (note) personNotes[personId] = note;
    }
  }

  return {
    tasks: result.tasks,
    total: result.total,
    nextCursor: result.nextCursor,
    personNotes,
  };
}
