/**
 * WHAT `/people?…` MEANS, PARSED IN ONE PLACE (#320).
 *
 * The page read these inline and cast the repeated ones (`as PersonStatus[]`,
 * `as PersonSource[]`) — the mistake `src/lib/tasks/list-params.ts` was written
 * to stop, and now the same mistake had a second reader: "Load more" has to
 * apply the SAME filters the page applied, or the appended rows are a different
 * query's answer. So the URL is read once, here, and both the page and the
 * load-more action call this.
 *
 * An unrecognised value is DROPPED rather than refused: a filter is a view of a
 * list, and the honest answer to "show me people whose status is bogus" is the
 * unfiltered list, not `/people` rendering its own failure — `persons.status`
 * is a text column under a CHECK constraint, so a bad value reached Postgres.
 *
 * Pure and db-free, so the page's whole reading of the URL is testable without
 * a session or a database.
 */

import type { PersonSource, PersonStatus } from "@/db/schema";
import {
  personSourceSchema,
  personStatusSchema,
} from "@/lib/validations/people";
import type { z } from "zod";

/** What Next hands a page: one value, several, or none. */
export type SearchParamValue = string | string[] | undefined;

/** The URL shape both the page and the load-more action read. */
export type PeopleListSearchParams = Record<string, SearchParamValue>;

export type PeopleView = "list" | "pipeline";

export interface PeopleListParams {
  view: PeopleView;
  cursor?: string;
  search?: string;
  status?: PersonStatus[];
  source?: PersonSource[];
  tagIds?: string[];
}

/** The recognised members of one repeated param, or `undefined` for "no filter". */
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

/** Everything `/people` reads out of its URL, with nothing taken on trust. */
export function parsePeopleListSearchParams(
  params: PeopleListSearchParams
): PeopleListParams {
  const tagParam = params.tag;
  const tagIds = tagParam ? [tagParam].flat() : undefined;

  return {
    view: params.view === "pipeline" ? "pipeline" : "list",
    cursor: typeof params.cursor === "string" ? params.cursor : undefined,
    search: typeof params.search === "string" ? params.search : undefined,
    status: parseEnumParam(params.status, personStatusSchema),
    source: parseEnumParam(params.source, personSourceSchema),
    tagIds: tagIds && tagIds.length > 0 ? tagIds : undefined,
  };
}

/** How many people one page of `/people` shows. */
export const PEOPLE_PAGE_SIZE = 24;
