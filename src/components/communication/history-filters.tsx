"use client";

import { Search, X } from "lucide-react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useCallback, useMemo, useRef, useTransition } from "react";
import { useDebouncedCallback } from "use-debounce";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import type {
  CommunicationChannel,
  CommunicationStatus,
} from "@/db/schema/communication";
import {
  communicationChannels,
  communicationStatuses,
} from "@/db/schema/communication";

import type { HistoryFilterSelection } from "./history-filters-presentation";
import {
  ALL_FILTER_VALUE,
  buildHistoryFilterHref,
  deriveHistoryFilterState,
  toChannelFilter,
  toStatusFilter,
} from "./history-filters-presentation";

// Keyed by the union, not by `string`: a renamed or typo'd option is a compile
// error here instead of a control that renders its own raw value as a label.
const CHANNEL_LABELS: Record<CommunicationChannel, string> = {
  email: "Email",
  sms: "SMS",
  both: "Email + SMS",
};

const STATUS_LABELS: Record<CommunicationStatus, string> = {
  draft: "Draft",
  scheduled: "Scheduled",
  sending: "Sending",
  sent: "Sent",
  failed: "Failed",
};

/**
 * Message history filters. All state lives in the URL so the server component
 * re-queries on every change and the view stays shareable.
 */
export function HistoryFilters() {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const [isPending, startTransition] = useTransition();
  // The search box is uncontrolled (typing must not wait on a server round
  // trip), so clearing filters has to reset it by hand.
  const searchInputRef = useRef<HTMLInputElement>(null);

  // Narrow the URL through the SAME schema the page's server component uses,
  // so a value the server refused to honour never shows up as a selected
  // filter or as something to clear.
  const {
    channel: currentChannel,
    status: currentStatus,
    search: currentSearch,
    hasFilters,
  } = useMemo(() => deriveHistoryFilterState(searchParams), [searchParams]);

  // The pushed URL is REBUILT from the validated state above, never copied from
  // the incoming search params — junk the server already dropped must not ride
  // along into a copied or bookmarked link, so the URL self-heals on the first
  // interaction. Same fields, same order as the server's own `pageHref`.
  const pushFilters = useCallback(
    (patch: Partial<HistoryFilterSelection>) => {
      const href = buildHistoryFilterHref(pathname, {
        channel: currentChannel,
        status: currentStatus,
        search: currentSearch,
        ...patch,
      });
      startTransition(() => {
        router.push(href);
      });
    },
    [currentChannel, currentSearch, currentStatus, pathname, router]
  );

  const handleSearch = useDebouncedCallback((term: string) => {
    pushFilters({ search: term });
  }, 300);

  const clearFilters = useCallback(() => {
    handleSearch.cancel();
    if (searchInputRef.current) searchInputRef.current.value = "";
    pushFilters({
      channel: ALL_FILTER_VALUE,
      status: ALL_FILTER_VALUE,
      search: "",
    });
  }, [handleSearch, pushFilters]);

  return (
    <div
      className="flex flex-wrap items-center gap-2"
      data-testid="history-filters"
      data-pending={isPending ? "true" : "false"}
    >
      <div className="relative w-full sm:w-[260px]">
        <Search
          className="text-muted-foreground pointer-events-none absolute top-2.5 left-2.5 h-4 w-4"
          aria-hidden="true"
        />
        <Input
          type="search"
          aria-label="Search messages"
          placeholder="Search subject or body..."
          className="bg-background h-9 w-full pl-8"
          data-testid="history-search"
          ref={searchInputRef}
          defaultValue={currentSearch}
          onChange={(event) => handleSearch(event.target.value)}
        />
      </div>

      <Select
        value={currentChannel}
        onValueChange={(value) =>
          pushFilters({ channel: toChannelFilter(value) })
        }
      >
        <SelectTrigger
          aria-label="Filter by channel"
          data-testid="history-channel-filter"
          className="h-9 w-[150px] cursor-pointer text-sm"
        >
          <SelectValue placeholder="Channel" />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value={ALL_FILTER_VALUE} className="cursor-pointer">
            All channels
          </SelectItem>
          {communicationChannels.map((channel) => (
            <SelectItem
              key={channel}
              value={channel}
              className="cursor-pointer"
            >
              {CHANNEL_LABELS[channel]}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>

      <Select
        value={currentStatus}
        onValueChange={(value) =>
          pushFilters({ status: toStatusFilter(value) })
        }
      >
        <SelectTrigger
          aria-label="Filter by status"
          data-testid="history-status-filter"
          className="h-9 w-[150px] cursor-pointer text-sm"
        >
          <SelectValue placeholder="Status" />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value={ALL_FILTER_VALUE} className="cursor-pointer">
            All statuses
          </SelectItem>
          {communicationStatuses.map((status) => (
            <SelectItem key={status} value={status} className="cursor-pointer">
              {STATUS_LABELS[status]}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>

      {hasFilters && (
        <Button
          variant="ghost"
          size="sm"
          data-testid="history-clear-filters"
          className="h-9 cursor-pointer gap-1 text-sm"
          onClick={clearFilters}
        >
          <X className="h-3.5 w-3.5" aria-hidden="true" />
          Clear
        </Button>
      )}
    </div>
  );
}
