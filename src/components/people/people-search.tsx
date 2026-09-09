"use client";

import { Search } from "lucide-react";
import { useRouter, useSearchParams } from "next/navigation";
import { useEffect, useState, useTransition, type RefObject } from "react";
import { useDebouncedCallback } from "use-debounce";
import {
  reconcilePeopleSearchDraft,
  type PeopleSearchDraft,
} from "./people-search-draft";

import { Input } from "@/components/ui/input";
import {
  parsePeopleListQuery,
  peopleListQueryWith,
} from "@/lib/people/list-params";

export function PeopleSearch({
  cancelSearchRef,
}: {
  cancelSearchRef: RefObject<(() => void) | null>;
}) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [, startTransition] = useTransition();
  const query = searchParams.toString();
  const search = parsePeopleListQuery(query).search ?? "";
  const [draft, setDraft] = useState<PeopleSearchDraft>({
    query,
    value: search,
    submitted: [],
    navigation: 0,
  });
  // Keep only the unsubmitted edit locally. A navigation owns the next value.
  if (draft.query !== query)
    setDraft(reconcilePeopleSearchDraft(draft, query, search));

  const handleSearch = useDebouncedCallback((term: string) => {
    const params = peopleListQueryWith(query, { search: term });
    setDraft((current) => ({
      ...current,
      submitted: [...current.submitted, params.toString()],
    }));

    startTransition(() => {
      router.replace(`?${params.toString()}`);
    });
  }, 300);

  // A queued keystroke must not overwrite Back/Forward or a filter navigation.
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
    cancelSearchRef.current = onPopState;
    window.addEventListener("popstate", onPopState);
    return () => {
      cancelSearchRef.current = null;
      window.removeEventListener("popstate", onPopState);
    };
  }, [handleSearch, cancelSearchRef]);

  return (
    <div className="relative w-full md:w-[300px]">
      <Search className="text-muted-foreground absolute top-2.5 left-2.5 h-4 w-4" />
      <Input
        type="search"
        aria-label="Search people"
        placeholder="Search people..."
        className="bg-background w-full pl-8"
        value={draft.value}
        onChange={(e) => {
          setDraft((current) => ({ ...current, value: e.target.value }));
          handleSearch(e.target.value);
        }}
      />
    </div>
  );
}
