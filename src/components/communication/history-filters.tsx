"use client";

import { Search, X } from "lucide-react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useCallback, useRef, useTransition } from "react";
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
import {
  communicationChannels,
  communicationStatuses,
} from "@/db/schema/communication";

const CHANNEL_LABELS: Record<string, string> = {
  email: "Email",
  sms: "SMS",
  both: "Email + SMS",
};

const STATUS_LABELS: Record<string, string> = {
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

  const pushParams = useCallback(
    (params: URLSearchParams) => {
      // Any filter change invalidates the current page offset.
      params.delete("page");
      const query = params.toString();
      startTransition(() => {
        router.push(query ? `${pathname}?${query}` : pathname);
      });
    },
    [pathname, router]
  );

  const updateParam = useCallback(
    (key: string, value: string | null) => {
      const params = new URLSearchParams(searchParams.toString());
      if (!value || value === "all") {
        params.delete(key);
      } else {
        params.set(key, value);
      }
      pushParams(params);
    },
    [pushParams, searchParams]
  );

  const handleSearch = useDebouncedCallback((term: string) => {
    updateParam("search", term.trim() || null);
  }, 300);

  const clearFilters = useCallback(() => {
    handleSearch.cancel();
    if (searchInputRef.current) searchInputRef.current.value = "";
    pushParams(new URLSearchParams());
  }, [handleSearch, pushParams]);

  const currentChannel = searchParams.get("channel") ?? "";
  const currentStatus = searchParams.get("status") ?? "";
  const currentSearch = searchParams.get("search") ?? "";
  const hasFilters = Boolean(currentChannel || currentStatus || currentSearch);

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
        value={currentChannel || "all"}
        onValueChange={(value) => updateParam("channel", value)}
      >
        <SelectTrigger
          aria-label="Filter by channel"
          data-testid="history-channel-filter"
          className="h-9 w-[150px] cursor-pointer text-sm"
        >
          <SelectValue placeholder="Channel" />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="all" className="cursor-pointer">
            All channels
          </SelectItem>
          {communicationChannels.map((channel) => (
            <SelectItem
              key={channel}
              value={channel}
              className="cursor-pointer"
            >
              {CHANNEL_LABELS[channel] ?? channel}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>

      <Select
        value={currentStatus || "all"}
        onValueChange={(value) => updateParam("status", value)}
      >
        <SelectTrigger
          aria-label="Filter by status"
          data-testid="history-status-filter"
          className="h-9 w-[150px] cursor-pointer text-sm"
        >
          <SelectValue placeholder="Status" />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="all" className="cursor-pointer">
            All statuses
          </SelectItem>
          {communicationStatuses.map((status) => (
            <SelectItem key={status} value={status} className="cursor-pointer">
              {STATUS_LABELS[status] ?? status}
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
