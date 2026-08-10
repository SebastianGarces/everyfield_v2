import type {
  CommunicationChannel,
  CommunicationStatus,
} from "@/db/schema/communication";
import {
  communicationChannels,
  communicationStatuses,
} from "@/db/schema/communication";
import { parseCommunicationFilters } from "@/lib/validations/communication";

/**
 * The Select option that means "do not filter on this field". It is a rendered
 * option value, not a stored one, so it never reaches the URL.
 */
export const ALL_FILTER_VALUE = "all" as const;
export type AllFilterValue = typeof ALL_FILTER_VALUE;

/** Exactly the channel options the control renders — nothing else exists. */
export type HistoryChannelFilter = CommunicationChannel | AllFilterValue;
/** Exactly the status options the control renders — nothing else exists. */
export type HistoryStatusFilter = CommunicationStatus | AllFilterValue;

/**
 * The filter values the controls hold. Every field is already validated: the
 * unions admit only rendered options, and `search` is the trimmed term the
 * server queried with. Building the pushed URL from THIS (never from the raw
 * search params) is what keeps junk out of the address bar.
 */
export interface HistoryFilterSelection {
  channel: HistoryChannelFilter;
  status: HistoryStatusFilter;
  search: string;
}

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
export interface HistoryFilterState extends HistoryFilterSelection {
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
    channel: filters.channel ?? ALL_FILTER_VALUE,
    status: filters.status ?? ALL_FILTER_VALUE,
    search: filters.search ?? "",
    hasFilters: Boolean(filters.channel || filters.status || filters.search),
  };
}

function narrowOption<Option extends string>(
  value: string,
  options: readonly Option[]
): Option | AllFilterValue {
  const match = options.find((option) => option === value);
  return match ?? ALL_FILTER_VALUE;
}

/**
 * Narrow a Select payload to a channel option.
 *
 * Radix types `onValueChange` as `string`, so this is the one place the widened
 * value re-enters the union. Anything outside the rendered options degrades to
 * "all", the same answer the server gives an unknown `?channel=`.
 */
export function toChannelFilter(value: string): HistoryChannelFilter {
  return narrowOption(value, communicationChannels);
}

/** Narrow a Select payload to a status option. See `toChannelFilter`. */
export function toStatusFilter(value: string): HistoryStatusFilter {
  return narrowOption(value, communicationStatuses);
}

/**
 * Build the query string for a filter change from validated state alone.
 *
 * The write path must not copy the incoming search params: a URL carrying
 * `?channel=nonsense` is one the server already refused to honour, and echoing
 * it back would let junk ride into a copied or bookmarked link. Emitting only
 * the fields the server itself emits (see `pageHref` on the history page) makes
 * the URL self-heal on the first interaction. `page` is deliberately absent —
 * any filter change invalidates the current offset.
 */
export function buildHistoryFilterQuery(
  selection: HistoryFilterSelection
): string {
  const params = new URLSearchParams();
  if (selection.channel !== ALL_FILTER_VALUE) {
    params.set("channel", selection.channel);
  }
  if (selection.status !== ALL_FILTER_VALUE) {
    params.set("status", selection.status);
  }
  const search = selection.search.trim();
  if (search) params.set("search", search);
  return params.toString();
}

/** The href a filter change pushes: `buildHistoryFilterQuery` on a pathname. */
export function buildHistoryFilterHref(
  pathname: string,
  selection: HistoryFilterSelection
): string {
  const query = buildHistoryFilterQuery(selection);
  return query ? `${pathname}?${query}` : pathname;
}
