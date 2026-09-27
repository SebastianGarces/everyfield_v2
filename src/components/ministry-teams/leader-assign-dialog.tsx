"use client";

import { useEffect, useId, useState } from "react";
import { useDebounce } from "use-debounce";
import {
  assignTeamLeaderAction,
  searchLeaderCandidatesAction,
} from "@/app/(dashboard)/teams/actions";
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
import { Label } from "@/components/ui/label";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import type { LeaderCandidate } from "@/lib/ministry-teams/leader-candidates";

export function LeaderAssignDialog({
  teamId,
  leaderId,
  leaderName,
}: {
  teamId: string;
  leaderId: string | null;
  leaderName: string | null;
}) {
  const id = useId();
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [debouncedQuery] = useDebounce(query.trim(), 250);
  const [people, setPeople] = useState<LeaderCandidate[]>([]);
  const [selected, setSelected] = useState<LeaderCandidate | null>(null);
  const [searching, setSearching] = useState(false);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    if (!open) return;
    let current = true;
    setSearching(true);
    searchLeaderCandidatesAction(debouncedQuery)
      .then((result) => {
        if (!current) return;
        if (result.success) {
          setPeople(result.data);
          setError(null);
        } else {
          setPeople([]);
          setError(result.error);
        }
      })
      .catch(() => {
        if (current)
          setError("Could not load people. Close and reopen to retry.");
      })
      .finally(() => {
        if (current) setSearching(false);
      });
    return () => {
      current = false;
    };
  }, [open, debouncedQuery]);

  async function confirm(event: React.FormEvent) {
    event.preventDefault();
    if (!selected) {
      setError("Choose a person to appoint as leader.");
      return;
    }
    setError(null);
    setPending(true);
    try {
      const result = await assignTeamLeaderAction(teamId, selected.id);
      if (result.success) setOpen(false);
      else setError(result.error);
    } catch {
      setError(
        "Could not appoint the leader. Your selection is saved here. Try again."
      );
    } finally {
      setPending(false);
    }
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(value) => {
        if (pending) return;
        setOpen(value);
        setQuery("");
        setSelected(null);
        setError(null);
      }}
    >
      <DialogTrigger asChild>
        <Button variant="outline" size="sm">
          Appoint leader
        </Button>
      </DialogTrigger>
      <DialogContent className="max-h-[85dvh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Appoint team leader</DialogTitle>
          <DialogDescription>
            {leaderName
              ? `Current leader: ${leaderName}. `
              : "No leader is appointed. "}
            An explicit appointment stays in place when team roles change.
            Contacts without an account are eligible; linked accounts need a
            current plant seat.
          </DialogDescription>
        </DialogHeader>
        <form onSubmit={confirm} className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor={`${id}-search`}>Search people</Label>
            <Input
              id={`${id}-search`}
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              disabled={pending}
            />
          </div>
          <p role="status" className="text-muted-foreground text-sm">
            {searching
              ? "Searching…"
              : people.length === 50
                ? "Showing 50 eligible people. Search to narrow the list."
                : `${people.length} eligible people`}
          </p>
          <RadioGroup
            aria-label="Eligible team leaders"
            value={selected?.id ?? ""}
            onValueChange={(value) =>
              setSelected(people.find((person) => person.id === value) ?? null)
            }
            disabled={pending}
            className="max-h-64 overflow-y-auto"
          >
            {people.map((person) => (
              <Label
                key={person.id}
                htmlFor={`${id}-${person.id}`}
                className="flex cursor-pointer items-center gap-3 rounded-md border p-3"
              >
                <RadioGroupItem id={`${id}-${person.id}`} value={person.id} />
                <span>
                  {person.firstName} {person.lastName}
                  {person.id === leaderId ? " · Current leader" : ""}
                </span>
              </Label>
            ))}
          </RadioGroup>
          {selected && (
            <p className="text-sm">
              Appoint{" "}
              <strong>
                {selected.firstName} {selected.lastName}
              </strong>{" "}
              as team leader.
            </p>
          )}
          {error && (
            <p role="alert" className="text-destructive text-sm">
              {error}
            </p>
          )}
          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              disabled={pending}
              onClick={() => setOpen(false)}
            >
              Cancel
            </Button>
            <Button type="submit" disabled={pending}>
              {pending ? "Appointing…" : "Confirm appointment"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
