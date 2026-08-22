"use client";

import { loadMorePeopleAction } from "@/app/(dashboard)/people/actions";
import { useCan } from "@/components/shared/viewer-capabilities";
import { Button } from "@/components/ui/button";
import type { PeopleListSearchParams } from "@/lib/people/list-params";
import { PersonForClient } from "@/lib/people/types";
import { Loader2, Users } from "lucide-react";
import Link from "next/link";
import { useState } from "react";
import { toast } from "sonner";
import { PersonCard } from "./person-card";

interface PeopleListProps {
  people: PersonForClient[];
  total: number;
  nextCursor: string | null;
  /**
   * The search params the first page was read under, so "Load more" asks for
   * the next page of the SAME query. Absent for the presentational embeds,
   * which have no button to press.
   */
  searchParams?: PeopleListSearchParams;
  /** Render every card, and this list's own call to action, as inert markup
   *  instead of links — for presentational embeds (the marketing page), where
   *  nothing may be clickable, focusable or prefetchable. Passed straight
   *  through to each `PersonCard`. Absent, as in the app, unchanged. */
  linkStatic?: boolean;
}

export function PeopleList({
  people,
  total,
  nextCursor: initialNextCursor,
  searchParams,
  linkStatic,
}: PeopleListProps) {
  // Pagination state — UI state, the shape `ActivityFeed` already uses
  // (`memory/invariants.md` → Client/Server Data Synchronization: a cursor and
  // the rows walked past it are legitimate client state; the FIRST page still
  // comes from the server on every render and is never copied in here).
  const [appended, setAppended] = useState<PersonForClient[]>([]);
  const [nextCursor, setNextCursor] = useState(initialNextCursor);
  const [isLoadingMore, setIsLoadingMore] = useState(false);

  // AS-020: the empty state's call to action ends in a `people.write` action, so
  // a plant Member keeps the FACT — nothing here — and loses the invitation to
  // fix it. `useCan` fails closed with no provider, which is what the marketing
  // embed wants: it renders a populated list and never reaches this branch.
  const canWrite = useCan("people.write");

  if (people.length === 0) {
    return (
      <div className="animate-in fade-in-50 flex min-h-[400px] flex-col items-center justify-center rounded-lg border border-dashed p-8 text-center">
        <div className="bg-muted flex h-20 w-20 items-center justify-center rounded-full">
          <Users className="text-muted-foreground h-10 w-10" />
        </div>
        <h3 className="mt-4 text-lg font-medium">No people found</h3>
        {canWrite ? (
          <>
            <p className="text-muted-foreground mt-2 max-w-sm text-sm">
              No people match your current filters. Try adjusting your search or
              filters, or add a new person.
            </p>
            <Button asChild className="mt-6">
              {linkStatic ? (
                <span>Add Person</span>
              ) : (
                <Link href="/people/new">Add Person</Link>
              )}
            </Button>
          </>
        ) : (
          <p className="text-muted-foreground mt-2 max-w-sm text-sm">
            No people match your current filters. Try adjusting your search or
            filters. Your plant&apos;s admins add people to the directory.
          </p>
        )}
      </div>
    );
  }

  const shown = [...people, ...appended];

  const handleLoadMore = async () => {
    if (!nextCursor || !searchParams) return;

    setIsLoadingMore(true);
    try {
      const result = await loadMorePeopleAction(searchParams, nextCursor);
      if (!result.success) {
        toast.error(result.error);
        return;
      }
      setAppended((prev) => [...prev, ...result.data.people]);
      setNextCursor(result.data.nextCursor);
    } catch (error) {
      console.error("Failed to load more people:", error);
      toast.error("Failed to load more people");
    } finally {
      setIsLoadingMore(false);
    }
  };

  return (
    <div className="space-y-6">
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
        {shown.map((person) => (
          <PersonCard key={person.id} person={person} linkStatic={linkStatic} />
        ))}
      </div>

      {nextCursor && !linkStatic && (
        <div className="flex justify-center pt-4">
          <Button
            variant="outline"
            className="cursor-pointer"
            onClick={handleLoadMore}
            disabled={isLoadingMore}
            data-testid="people-load-more"
          >
            {isLoadingMore && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
            {isLoadingMore ? "Loading…" : "Load more"}
          </Button>
        </div>
      )}

      <div
        className="text-muted-foreground text-center text-xs"
        data-testid="people-count"
      >
        Showing {shown.length} of {total} people
      </div>
    </div>
  );
}
