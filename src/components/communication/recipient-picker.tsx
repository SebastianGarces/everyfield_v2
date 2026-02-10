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

interface Recipient {
  id: string;
  firstName: string;
  lastName: string;
  email: string | null;
}

interface RecipientPickerProps {
  selected: Recipient[];
  onChange: (recipients: Recipient[]) => void;
  /** Whether to show meeting-specific groups */
  showMeetingGroups?: boolean;
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
  showMeetingGroups,
}: RecipientPickerProps) {
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<Recipient[]>([]);
  const [searching, setSearching] = useState(false);
  const [loadingGroup, setLoadingGroup] = useState<string | null>(null);

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

  const handleQuickGroup = async (groupId: string) => {
    setLoadingGroup(groupId);
    try {
      const { ids } = await resolveGroupAction(groupId);
      if (ids.length === 0) return;

      // Fetch person details for these IDs
      const people = await searchPeopleAction("");
      const selectedIds = new Set(selected.map((r) => r.id));
      const groupIds = new Set(ids);

      const newPeople = people.filter(
        (p) => groupIds.has(p.id) && !selectedIds.has(p.id)
      );

      if (newPeople.length > 0) {
        onChange([...selected, ...newPeople]);
      }
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
            variant="outline"
            size="sm"
            className="cursor-pointer"
            onClick={() => handleQuickGroup(group.id)}
            disabled={loadingGroup === group.id}
          >
            <Users className="mr-1 h-3 w-3" />
            {loadingGroup === group.id ? "Loading..." : group.label}
          </Button>
        ))}
      </div>

      {/* Search input */}
      <div className="relative">
        <Search className="text-muted-foreground absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2" />
        <Input
          placeholder="Search people by name or email..."
          value={query}
          onChange={(e) => handleSearch(e.target.value)}
          className="pl-10"
        />
      </div>

      {/* Search results dropdown */}
      {results.length > 0 && (
        <div className="max-h-48 overflow-auto rounded-md border bg-white shadow-sm">
          {results.map((person) => (
            <button
              key={person.id}
              className="flex w-full cursor-pointer items-center gap-2 px-3 py-2 text-left text-sm hover:bg-gray-50"
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

      {/* Selected recipients */}
      {selected.length > 0 && (
        <div className="space-y-2">
          <p className="text-muted-foreground text-sm">
            {selected.length} recipient{selected.length !== 1 ? "s" : ""}{" "}
            selected
          </p>
          <div className="flex flex-wrap gap-1.5">
            {selected.slice(0, 20).map((person) => (
              <Badge
                key={person.id}
                variant="secondary"
                className="gap-1 py-1"
              >
                {person.firstName} {person.lastName}
                <button
                  className="cursor-pointer rounded-full p-0.5 hover:bg-gray-300"
                  onClick={() => removeRecipient(person.id)}
                >
                  <X className="h-3 w-3" />
                </button>
              </Badge>
            ))}
            {selected.length > 20 && (
              <Badge variant="secondary">
                +{selected.length - 20} more
              </Badge>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
