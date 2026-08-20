/**
 * A KEYSET PAGINATION WALK, IN MEMORY (#320).
 *
 * Both list surfaces page the same way: order by `(key, id)`, remember the last
 * row's id, and ask for everything strictly after that pair. The bug this was
 * written for is what happens when the ORDER and the CURSOR describe different
 * keys — rows get skipped at every page boundary and others come back twice —
 * so the check that matters is a walk over a fixture where the answer is known.
 *
 * This runs the walk against an array using the SAME key function the query's
 * `ORDER BY` uses, which is what makes it a test of the composition rather than
 * of a mock: the key comes from the service's own sort registry.
 *
 * Not a database. The SQL half is pinned separately, by asserting the rendered
 * cursor predicate contains the rendered sort expression — together the two say
 * "the query orders by K and pages by K, and paging by K does not skip".
 */

export interface KeysetRow {
  id: string;
}

export type SortDirection = "asc" | "desc";

/** Order rows the way `ORDER BY key <dir>, id <dir>` does. */
export function orderByKeyset<T extends KeysetRow>(
  rows: T[],
  key: (row: T) => string,
  direction: SortDirection = "asc"
): T[] {
  const sign = direction === "desc" ? -1 : 1;
  return [...rows].sort((a, b) => {
    const ka = key(a);
    const kb = key(b);
    if (ka !== kb) return ka < kb ? -sign : sign;
    if (a.id === b.id) return 0;
    return a.id < b.id ? -sign : sign;
  });
}

/**
 * One page of the walk: the rows strictly after `cursor`, and the id to ask
 * with next (null when the set is exhausted).
 */
export function keysetPage<T extends KeysetRow>(
  rows: T[],
  key: (row: T) => string,
  limit: number,
  cursor: string | null = null,
  direction: SortDirection = "asc"
): { rows: T[]; nextCursor: string | null } {
  const ordered = orderByKeyset(rows, key, direction);
  const start = cursor ? ordered.findIndex((row) => row.id === cursor) + 1 : 0;

  // One extra, exactly as the query does, so "is there a next page" is answered
  // by a row and not by a count.
  const window = ordered.slice(start, start + limit + 1);
  const hasMore = window.length > limit;
  const page = hasMore ? window.slice(0, limit) : window;

  return {
    rows: page,
    nextCursor: hasMore ? (page.at(-1)?.id ?? null) : null,
  };
}
