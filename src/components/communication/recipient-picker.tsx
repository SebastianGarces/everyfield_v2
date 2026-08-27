"use client";

import { useState, useCallback } from "react";
import { X, Users, Search } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  searchPeopleAction,
  resolveGroupAction,
} from "@/app/(dashboard)/communication/actions";
import type { RecipientTeamOption } from "@/lib/communication/recipient-groups";

interface Recipient {
  id: string;
  firstName: string;
  lastName: string;
  email: string | null;
}

interface RecipientPickerProps {
  selected: Recipient[];
  onChange: (recipients: Recipient[]) => void;
  /** Ministry teams offered alongside the status groups (MT-015). */
  teams?: RecipientTeamOption[];
}

const quickGroups = [
  { id: "core_group", label: "Core Group" },
  { id: "prospects", label: "All Prospects" },
  { id: "launch_team", label: "Launch Team" },
  { id: "leaders", label: "Leaders" },
];

export function RecipientPicker({
  selected,
  onChange,
  teams = [],
}: RecipientPickerProps) {
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<Recipient[]>([]);
  const [searching, setSearching] = useState(false);
  const [loadingGroup, setLoadingGroup] = useState<string | null>(null);
  // UI state only: what the last quick-select resolved to, so a group that
  // resolves to nobody says so instead of appearing to do nothing.
  const [notice, setNotice] = useState<string | null>(null);

  const handleSearch = useCallback(
    async (value: string) => {
      setQuery(value);
      if (value.length < 2) {
        setResults([]);
        return;
      }
      setSearching(true);
      try {
        const people = await searchPeopleAction(value);
        // Filter out already selected
        const selectedIds = new Set(selected.map((r) => r.id));
        setResults(people.filter((p) => !selectedIds.has(p.id)));
      } catch {
        setResults([]);
      } finally {
        setSearching(false);
      }
    },
    [selected]
  );

  const addRecipient = (person: Recipient) => {
    if (!selected.find((r) => r.id === person.id)) {
      onChange([...selected, person]);
    }
    setQuery("");
    setResults([]);
  };

  const removeRecipient = (id: string) => {
    onChange(selected.filter((r) => r.id !== id));
  };

  /**
   * Add everyone a group resolves to. The server returns the whole people, so
   * the selection is the resolved membership itself — not a page of a search.
   */
  const handleQuickGroup = async (groupId: string, label: string) => {
    setLoadingGroup(groupId);
    setNotice(null);
    try {
      const { people } = await resolveGroupAction(groupId);

      if (people.length === 0) {
        setNotice(`${label} has no active members to add.`);
        return;
      }

      const selectedIds = new Set(selected.map((r) => r.id));
      const newPeople = people.filter((p) => !selectedIds.has(p.id));

      if (newPeople.length > 0) {
        onChange([...selected, ...newPeople]);
      }
      setNotice(
        newPeople.length === 0
          ? `${label} was already selected — ${people.length} recipient${people.length === 1 ? "" : "s"}.`
          : `Added ${newPeople.length} recipient${newPeople.length === 1 ? "" : "s"} from ${label}.`
      );
    } finally {
      setLoadingGroup(null);
    }
  };

  return (
    <div className="space-y-3">
      <label className="text-sm font-medium">Recipients</label>

      {/* Quick select groups */}
      <div className="flex flex-wrap gap-2">
        {quickGroups.map((group) => (
          <Button
            key={group.id}
            type="button"
            variant="outline"
            size="sm"
            className="cursor-pointer"
            onClick={() => handleQuickGroup(group.id, group.label)}
            disabled={loadingGroup === group.id}
          >
            <Users className="mr-1 h-3 w-3" />
            {loadingGroup === group.id ? "Loading..." : group.label}
          </Button>
        ))}
      </div>

      {/* Ministry teams (MT-015) */}
      {teams.length > 0 && (
        <div className="space-y-2">
          <p className="text-muted-foreground text-xs font-medium">
            Ministry teams
          </p>
          <div
            className="flex flex-wrap gap-2"
            data-testid="team-quick-selects"
          >
            {teams.map((team) => {
              const selector = team.selector;
              return (
                <Button
                  key={team.id}
                  type="button"
                  variant="outline"
                  size="sm"
                  className="cursor-pointer"
                  data-testid={`team-quick-select-${team.id}`}
                  onClick={() => handleQuickGroup(selector, team.name)}
                  disabled={loadingGroup === selector}
                >
                  <Users className="mr-1 h-3 w-3" />
                  {loadingGroup === selector ? "Loading..." : team.name}
                  <span className="text-muted-foreground ml-1 tabular-nums">
                    {team.memberCount}
                  </span>
                </Button>
              );
            })}
          </div>
        </div>
      )}

      {/* Search input */}
      <div className="relative">
        <Search className="text-muted-foreground absolute top-1/2 left-3 h-4 w-4 -translate-y-1/2" />
        <Input
          placeholder="Search people by name or email..."
          aria-label="Search people by name or email"
          value={query}
          onChange={(e) => handleSearch(e.target.value)}
          className="pl-10"
        />
      </div>

      {/* Search results dropdown */}
      {results.length > 0 && (
        <div className="bg-popover max-h-48 overflow-auto rounded-md border shadow-sm">
          {results.map((person) => (
            <button
              key={person.id}
              type="button"
              className="hover:bg-accent flex w-full cursor-pointer items-center gap-2 px-3 py-2 text-left text-sm"
              onClick={() => addRecipient(person)}
            >
              <span className="font-medium">
                {person.firstName} {person.lastName}
              </span>
              {person.email && (
                <span className="text-muted-foreground">{person.email}</span>
              )}
            </button>
          ))}
        </div>
      )}

      {searching && (
        <p className="text-muted-foreground text-sm">Searching...</p>
      )}

      <p aria-live="polite" className="text-muted-foreground min-h-5 text-sm">
        {notice}
      </p>

      {/* Selected recipients */}
      {selected.length > 0 && (
        <div className="space-y-2">
          <p
            className="text-muted-foreground text-sm"
            data-testid="selected-count"
          >
            {selected.length} recipient{selected.length !== 1 ? "s" : ""}{" "}
            selected
          </p>
          <div
            aria-label="Selected recipients"
            className="max-h-48 overflow-y-auto"
            data-testid="selected-recipients"
            role="region"
          >
            <div className="flex flex-wrap gap-1.5">
              {selected.map((person) => (
                <Badge
                  key={person.id}
                  variant="secondary"
                  className="gap-1 py-1"
                >
                  {person.firstName} {person.lastName}
                  <button
                    type="button"
                    aria-label={`Remove ${person.firstName} ${person.lastName}`}
                    className="hover:bg-muted-foreground/25 cursor-pointer rounded-full p-0.5"
                    onClick={() => removeRecipient(person.id)}
                  >
                    <X className="h-3 w-3" />
                  </button>
                </Badge>
              ))}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
