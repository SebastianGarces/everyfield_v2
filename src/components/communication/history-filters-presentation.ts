import { parseCommunicationFilters } from "@/lib/validations/communication";

/**
 * What the filter controls should display, derived from the URL.
 *
 * The history page is server-rendered from `parseCommunicationFilters`, which
 * drops values it cannot honour (a hand-edited `?channel=nonsense` widens the
 * result set instead of erroring). If the controls read the RAW query string
 * they contradict that: the Select renders an unknown value (blank trigger) and
 * a Clear button offers to clear a filter that was never applied. Deriving both
 * sides from the same parse is the only way they can agree.
 */
export interface HistoryFilterState {
  /** Select value for the channel control — `"all"` when no channel is applied. */
  channel: string;
  /** Select value for the status control — `"all"` when no status is applied. */
  status: string;
  /** Search term the server actually queried with (trimmed), or `""`. */
  search: string;
  /** True only when at least one filter survived validation. */
  hasFilters: boolean;
}

/**
 * Narrow raw URL search params to the effective filter state the server used.
 *
 * `URLSearchParams.get` returns the first value for a repeated key, matching
 * the server's own first-wins collapsing of Next.js `searchParams` arrays.
 */
export function deriveHistoryFilterState(
  searchParams: URLSearchParams
): HistoryFilterState {
  const filters = parseCommunicationFilters({
    channel: searchParams.get("channel") ?? undefined,
    status: searchParams.get("status") ?? undefined,
    search: searchParams.get("search") ?? undefined,
  });

  return {
    channel: filters.channel ?? "all",
    status: filters.status ?? "all",
    search: filters.search ?? "",
    hasFilters: Boolean(filters.channel || filters.status || filters.search),
  };
}
