"use client";

import { useRef } from "react";
import type { PeopleView } from "@/lib/people/list-params";
import type { Tag } from "@/lib/people/types";
import { PeopleFilters } from "./people-filters";
import { PeopleSearch } from "./people-search";
import { ViewToggle } from "./view-toggle";

export function PeopleToolbar({
  view,
  availableTags,
  total,
}: {
  view: PeopleView;
  availableTags: Tag[];
  total: number;
}) {
  const cancelSearchRef = useRef<((destination?: string) => void) | null>(null);
  const beforeNavigate = (destination: string) =>
    cancelSearchRef.current?.(destination);

  return (
    <div className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
      <div className="flex flex-1 flex-col gap-4 md:flex-row md:items-center">
        {view === "list" && (
          <>
            <PeopleSearch cancelSearchRef={cancelSearchRef} />
            <PeopleFilters
              availableTags={availableTags}
              beforeNavigate={beforeNavigate}
            />
          </>
        )}
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <ViewToggle currentView={view} beforeNavigate={beforeNavigate} />
        <div className="text-muted-foreground text-sm font-medium tabular-nums">
          {total} total
        </div>
      </div>
    </div>
  );
}
