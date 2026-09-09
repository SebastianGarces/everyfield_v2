"use client";

import { useEffect, useState, useTransition } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { useDebouncedCallback } from "use-debounce";
import {
  parsePeopleListQuery,
  peopleListQueryWith,
} from "@/lib/people/list-params";
import {
  reconcilePeopleToolbarDraft,
  type PeopleToolbarDraft,
} from "./people-toolbar-draft";
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
  const router = useRouter();
  const committedQuery = useSearchParams().toString();
  const [, startTransition] = useTransition();
  const [draft, setDraft] = useState<PeopleToolbarDraft>({
    query: committedQuery,
    value: parsePeopleListQuery(committedQuery).search ?? "",
    submitted: [],
    navigation: 0,
  });
  if (draft.query !== committedQuery) {
    setDraft(
      reconcilePeopleToolbarDraft(
        draft,
        committedQuery,
        parsePeopleListQuery(committedQuery).search ?? ""
      )
    );
  }
  // Every control composes from the latest intent, even before the server acknowledges it.
  const query = draft.submitted.at(-1) ?? committedQuery;
  const handleSearch = useDebouncedCallback((term: string) => {
    const destination = peopleListQueryWith(query, { search: term }).toString();
    setDraft((current) => ({
      ...current,
      submitted: [...current.submitted, destination],
    }));
    startTransition(() => router.replace(`?${destination}`));
  }, 300);
  const navigate = (destination: string) => {
    handleSearch.cancel();
    setDraft((current) => ({
      ...current,
      value: parsePeopleListQuery(destination).search ?? "",
      submitted: [...current.submitted, destination],
    }));
    router.push(`?${destination}`);
  };
  useEffect(
    () => () => handleSearch.cancel(),
    [draft.navigation, handleSearch]
  );
  useEffect(() => {
    const onPopState = () => {
      handleSearch.cancel();
      setDraft((current) => ({
        ...current,
        value: parsePeopleListQuery(current.query).search ?? "",
        submitted: [],
      }));
    };
    window.addEventListener("popstate", onPopState);
    return () => window.removeEventListener("popstate", onPopState);
  }, [handleSearch]);

  return (
    <div className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
      <div className="flex flex-1 flex-col gap-4 md:flex-row md:items-center">
        {view === "list" && (
          <>
            <PeopleSearch
              value={draft.value}
              onChange={(value) => {
                setDraft((current) => ({ ...current, value }));
                handleSearch(value);
              }}
            />
            <PeopleFilters
              availableTags={availableTags}
              query={query}
              navigate={navigate}
            />
          </>
        )}
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <ViewToggle currentView={view} query={query} navigate={navigate} />
        <div className="text-muted-foreground text-sm font-medium tabular-nums">
          {total} total
        </div>
      </div>
    </div>
  );
}
