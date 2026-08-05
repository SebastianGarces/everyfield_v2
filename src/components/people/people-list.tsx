import { Button } from "@/components/ui/button";
import { Person } from "@/lib/people/types";
import { Users } from "lucide-react";
import Link from "next/link";
import { PersonCard } from "./person-card";

interface PeopleListProps {
  people: Person[];
  total: number;
  nextCursor: string | null;
  /** Render every card, and this list's own call to action, as inert markup
   *  instead of links — for presentational embeds (the marketing page), where
   *  nothing may be clickable, focusable or prefetchable. Passed straight
   *  through to each `PersonCard`. Absent, as in the app, unchanged. */
  linkStatic?: boolean;
}

export function PeopleList({
  people,
  total,
  nextCursor,
  linkStatic,
}: PeopleListProps) {
  if (people.length === 0) {
    return (
      <div className="animate-in fade-in-50 flex min-h-[400px] flex-col items-center justify-center rounded-lg border border-dashed p-8 text-center">
        <div className="bg-muted flex h-20 w-20 items-center justify-center rounded-full">
          <Users className="text-muted-foreground h-10 w-10" />
        </div>
        <h3 className="mt-4 text-lg font-medium">No people found</h3>
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
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
        {people.map((person) => (
          <PersonCard key={person.id} person={person} linkStatic={linkStatic} />
        ))}
      </div>

      {nextCursor && (
        <div className="flex justify-center pt-4">
          <Button variant="outline" disabled>
            Load more (Pagination coming soon)
          </Button>
        </div>
      )}

      <div className="text-muted-foreground text-center text-xs">
        Showing {people.length} of {total} people
      </div>
    </div>
  );
}
