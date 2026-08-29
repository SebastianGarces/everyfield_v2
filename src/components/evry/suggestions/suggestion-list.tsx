"use client";

import type { EligibleEvrySuggestion } from "./types";

export function EvrySuggestionList({
  suggestions,
  onSelect,
}: {
  suggestions: readonly EligibleEvrySuggestion[];
  onSelect: (suggestion: EligibleEvrySuggestion) => void;
}) {
  if (suggestions.length === 0) return null;

  return (
    <div className="w-full space-y-2" aria-labelledby="evry-suggestions-label">
      <p
        id="evry-suggestions-label"
        className="text-muted-foreground text-left text-xs font-medium tracking-wide uppercase"
      >
        Example requests
      </p>
      <div className="flex flex-wrap gap-2">
        {suggestions.map((suggestion) => (
          <button
            key={suggestion.id}
            type="button"
            onClick={() => onSelect(suggestion)}
            className="border-border bg-background hover:bg-muted focus-visible:ring-ring min-h-10 max-w-full cursor-pointer rounded-lg border px-3 py-2 text-left text-sm leading-snug [overflow-wrap:anywhere] focus-visible:ring-2 focus-visible:outline-none active:scale-[0.96]"
          >
            {suggestion.request}
          </button>
        ))}
      </div>
    </div>
  );
}
