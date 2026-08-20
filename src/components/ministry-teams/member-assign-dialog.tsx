"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { useDebounce } from "use-debounce";
import { Search, UserPlus, AlertTriangle } from "lucide-react";
import { toast } from "sonner";

import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Alert, AlertDescription } from "@/components/ui/alert";
import {
  assignMemberAction,
  searchTeamCandidatesAction,
} from "@/app/(dashboard)/teams/actions";
import type { PersonForClient } from "@/lib/people/types";
import { assignRefusalDelivery } from "./assign-refusal";

interface MemberAssignDialogProps {
  teamId: string;
  roleId: string;
  roleName: string;
  /** The first page of people, from the server component. */
  people: PersonForClient[];
  /**
   * Active team count per person id, resolved by the server component next to
   * the people list. Server data arrives as props, never through a client-side
   * fetch into state (memory/invariants.md → Client/Server Data
   * Synchronization); the only state here is UI state.
   */
  teamCounts: Record<string, number>;
}

export function MemberAssignDialog({
  teamId,
  roleId,
  roleName,
  people,
  teamCounts,
}: MemberAssignDialogProps) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState("");
  const [selectedPerson, setSelectedPerson] = useState<PersonForClient | null>(
    null
  );
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // SEARCH IS A SERVER READ (ruling 2026-08-12). Filtering the prefetched
  // array in the browser made everyone past the prefetch invisible: a planter
  // typing a real member's name was told "No people found". The matches — and
  // the team counts the warning below needs for them — are a search result, so
  // they live in state; the props remain the answer while the box is empty.
  const [debouncedSearch] = useDebounce(search.trim(), 250);
  const [matches, setMatches] = useState<{
    people: PersonForClient[];
    teamCounts: Record<string, number>;
  } | null>(null);
  const [searching, setSearching] = useState(false);

  useEffect(() => {
    if (debouncedSearch.length === 0) {
      setMatches(null);
      setSearching(false);
      return;
    }

    let current = true;
    setSearching(true);

    searchTeamCandidatesAction(debouncedSearch)
      .then((result) => {
        if (!current) return;
        setMatches(
          result.success ? result.data : { people: [], teamCounts: {} }
        );
      })
      .finally(() => {
        if (current) setSearching(false);
      });

    // The answer to a query the planter has already typed past is not an answer
    // any more — a slow request must not overwrite a faster later one.
    return () => {
      current = false;
    };
  }, [debouncedSearch]);

  const shownPeople = matches?.people ?? people;
  const shownCounts = matches?.teamCounts ?? teamCounts;

  const teamCount = selectedPerson ? (shownCounts[selectedPerson.id] ?? 0) : 0;

  async function handleAssign() {
    if (!selectedPerson) return;

    setLoading(true);
    setError(null);
    try {
      const result = await assignMemberAction(teamId, roleId, {
        personId: selectedPerson.id,
      });
      if (result.success) {
        setOpen(false);
        setSelectedPerson(null);
        setSearch("");
      } else {
        // #409 D1. WHERE the refusal goes is decided by `assignRefusalDelivery`
        // (`./assign-refusal.ts`), not here, because this branch is otherwise
        // untestable — see that module's header.
        //
        // The seat refusal means the page underneath is WRONG, not merely that
        // the write failed: this dialog is only ever rendered beside an OPEN
        // seat, so being told the seat is filled means somebody took it since
        // this page rendered. `router.refresh()` puts the occupant on screen.
        // But that same refresh flips the role card to its Filled arm, which
        // UNMOUNTS this dialog — so the sentence must not be inside it. It goes
        // to the root `<Toaster>` (`src/app/layout.tsx`), a sibling of the whole
        // page that no re-render below it can take down, and the refresh is NOT
        // delayed behind a dismissal: delaying it restores the stale roles tab
        // it exists to destroy.
        //
        // `router.refresh()` is legitimate here and is not the client-refresh
        // this repo's data-sync invariant forbids: nothing was written, so
        // there is no server action to call `refresh()` from next/cache in.
        const delivery = assignRefusalDelivery(result.error);
        setError(delivery.inline);
        if (delivery.toast) {
          toast.error(delivery.toast.message, {
            description: delivery.toast.description,
            duration: delivery.toast.durationMs,
          });
        }
        if (delivery.closeDialog) {
          setOpen(false);
          setSelectedPerson(null);
          setSearch("");
        }
        if (delivery.refreshRoles) router.refresh();
      }
    } finally {
      setLoading(false);
    }
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(o) => {
        setOpen(o);
        if (!o) {
          setSelectedPerson(null);
          setSearch("");
          setError(null);
        }
      }}
    >
      <DialogTrigger asChild>
        <Button variant="ghost" size="sm" className="cursor-pointer">
          <UserPlus className="mr-1 h-3.5 w-3.5" />
          Assign
        </Button>
      </DialogTrigger>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>Assign Member</DialogTitle>
          <DialogDescription>
            Assign a person to the{" "}
            <span className="font-medium">{roleName}</span> role.
          </DialogDescription>
        </DialogHeader>

        {!selectedPerson ? (
          <div className="space-y-3">
            <div className="relative">
              <Search className="text-muted-foreground absolute top-1/2 left-3 h-4 w-4 -translate-y-1/2" />
              <Input
                placeholder="Search people..."
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                className="pl-9"
              />
            </div>
            <div className="max-h-64 overflow-auto rounded-md border">
              {searching ? (
                <div className="text-muted-foreground p-4 text-center text-sm">
                  Searching…
                </div>
              ) : shownPeople.length === 0 ? (
                <div className="text-muted-foreground p-4 text-center text-sm">
                  No people found
                </div>
              ) : (
                shownPeople.map((person) => {
                  const initials =
                    `${person.firstName[0]}${person.lastName[0]}`.toUpperCase();
                  return (
                    <button
                      key={person.id}
                      type="button"
                      className="hover:bg-muted flex w-full cursor-pointer items-center gap-3 border-b p-3 text-left last:border-b-0"
                      onClick={() => setSelectedPerson(person)}
                    >
                      <Avatar className="h-8 w-8">
                        <AvatarFallback className="text-xs">
                          {initials}
                        </AvatarFallback>
                      </Avatar>
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-sm font-medium">
                          {person.firstName} {person.lastName}
                        </p>
                        {person.email && (
                          <p className="text-muted-foreground truncate text-xs">
                            {person.email}
                          </p>
                        )}
                      </div>
                      <Badge variant="outline" className="shrink-0 capitalize">
                        {person.status.replace("_", " ")}
                      </Badge>
                    </button>
                  );
                })
              )}
            </div>
          </div>
        ) : (
          <div className="space-y-4">
            <div className="flex items-center gap-3 rounded-lg border p-4">
              <Avatar className="h-10 w-10">
                <AvatarFallback>
                  {`${selectedPerson.firstName[0]}${selectedPerson.lastName[0]}`.toUpperCase()}
                </AvatarFallback>
              </Avatar>
              <div>
                <p className="font-medium">
                  {selectedPerson.firstName} {selectedPerson.lastName}
                </p>
                <p className="text-muted-foreground text-sm">
                  {selectedPerson.email ?? "No email"}
                </p>
              </div>
            </div>

            {teamCount >= 2 && (
              <Alert variant="destructive">
                <AlertTriangle className="h-4 w-4" />
                <AlertDescription>
                  This person is already on {teamCount} team
                  {teamCount !== 1 ? "s" : ""}. Consider whether additional
                  assignments are manageable.
                </AlertDescription>
              </Alert>
            )}

            {error && (
              <Alert variant="destructive">
                <AlertDescription>{error}</AlertDescription>
              </Alert>
            )}

            <Button
              variant="outline"
              size="sm"
              onClick={() => setSelectedPerson(null)}
              className="cursor-pointer"
            >
              Choose different person
            </Button>
          </div>
        )}

        <DialogFooter>
          <Button
            type="button"
            variant="outline"
            onClick={() => setOpen(false)}
            className="cursor-pointer"
          >
            Cancel
          </Button>
          {selectedPerson && (
            <Button
              onClick={handleAssign}
              disabled={loading}
              className="cursor-pointer"
            >
              {loading ? "Assigning..." : "Confirm Assignment"}
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
