"use client";

import { searchWikiArticles } from "@/app/(dashboard)/wiki/actions";
import {
  Command,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Kbd } from "@/components/ui/kbd";
import type { SearchResult } from "@/lib/wiki";
import {
  ArrowDown,
  ArrowUp,
  CornerDownLeft,
  FileText,
  Search,
} from "lucide-react";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";

interface WikiSearchProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function WikiSearch({ open, onOpenChange }: WikiSearchProps) {
  const router = useRouter();
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<SearchResult[]>([]);
  const [isSearching, setIsSearching] = useState(false);
  const [hasSearched, setHasSearched] = useState(false);
  const [isNavigating, setIsNavigating] = useState(false);
  const debounceRef = useRef<NodeJS.Timeout | null>(null);

  // Handle query changes with debounced search
  const handleQueryChange = useCallback((value: string) => {
    setQuery(value);

    // Clear previous timeout
    if (debounceRef.current) {
      clearTimeout(debounceRef.current);
    }

    if (!value.trim()) {
      setResults([]);
      setHasSearched(false);
      setIsSearching(false);
      return;
    }

    // Show searching state immediately
    setIsSearching(true);

    // Debounce search
    debounceRef.current = setTimeout(async () => {
      const searchResults = await searchWikiArticles(value);
      setResults(searchResults);
      setHasSearched(true);
      setIsSearching(false);
    }, 300);
  }, []);

  // Cleanup timeout on unmount
  useEffect(() => {
    return () => {
      if (debounceRef.current) {
        clearTimeout(debounceRef.current);
      }
    };
  }, []);

  // Handle dialog open/close - reset state on open, not close
  const handleOpenChange = useCallback(
    (newOpen: boolean) => {
      if (newOpen) {
        // Reset state when opening
        setQuery("");
        setResults([]);
        setHasSearched(false);
        setIsSearching(false);
        setIsNavigating(false);
      }
      onOpenChange(newOpen);
    },
    [onOpenChange]
  );

  const handleSelect = useCallback(
    (slug: string) => {
      // Start navigation immediately
      router.push(`/wiki/${slug}`);
      // Then hide and close
      setIsNavigating(true);
      onOpenChange(false);
    },
    [onOpenChange, router]
  );

  // Format content type for display
  const formatContentType = (type: string) => {
    const typeMap: Record<string, string> = {
      tutorial: "Tutorial",
      how_to: "How-to",
      explanation: "Explanation",
      reference: "Reference",
      overview: "Overview",
      guide: "Guide",
    };
    return typeMap[type] || type;
  };

  // Format phase for display
  const formatPhase = (phase: number | null) => {
    if (phase === null) return null;
    return `Phase ${phase}`;
  };

  // Hide dialog immediately when navigating to prevent flash
  if (isNavigating) {
    return null;
  }

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogHeader className="sr-only">
        <DialogTitle>Search Wiki</DialogTitle>
        <DialogDescription>Search for articles in the wiki</DialogDescription>
      </DialogHeader>
      <DialogContent className="overflow-hidden p-0" showCloseButton={false}>
        <Command
          shouldFilter={false}
          className="[&_[cmdk-group-heading]]:text-muted-foreground [&_[cmdk-group-heading]]:px-2 [&_[cmdk-group-heading]]:font-medium [&_[cmdk-group]]:px-2 [&_[cmdk-input]]:h-12 [&_[cmdk-item]]:px-2 [&_[cmdk-item]]:py-3"
        >
          <CommandInput
            placeholder="Search articles..."
            value={query}
            onValueChange={handleQueryChange}
          />
          <CommandList className="h-[300px] max-h-[300px]">
            {/* Loading state */}
            {isSearching && (
              <div className="text-muted-foreground flex h-full items-center justify-center text-sm">
                Searching...
              </div>
            )}

            {/* Empty state - no results */}
            {!isSearching && hasSearched && results.length === 0 && (
              <div className="text-muted-foreground flex h-full items-center justify-center text-sm">
                No articles found.
              </div>
            )}

            {/* Initial state - no query */}
            {!isSearching && !hasSearched && !query.trim() && (
              <div className="text-muted-foreground flex h-full items-center justify-center text-sm">
                Start typing to search articles...
              </div>
            )}

            {/* Results */}
            {!isSearching && results.length > 0 && (
              <CommandGroup heading={`Results (${results.length})`}>
                {results.map((result) => (
                  <CommandItem
                    key={result.id}
                    value={result.slug}
                    onSelect={() => handleSelect(result.slug)}
                    className="flex flex-col items-start gap-1 py-3"
                  >
                    <div className="flex items-center gap-2">
                      <FileText className="h-4 w-4 shrink-0" />
                      <span className="font-medium">{result.title}</span>
                    </div>
                    <div className="text-muted-foreground ml-6 flex items-center gap-2 text-xs">
                      {formatPhase(result.phase) && (
                        <>
                          <span>{formatPhase(result.phase)}</span>
                          <span>•</span>
                        </>
                      )}
                      <span>{formatContentType(result.contentType)}</span>
                      {result.readTimeMinutes && (
                        <>
                          <span>•</span>
                          <span>{result.readTimeMinutes} min read</span>
                        </>
                      )}
                    </div>
                  </CommandItem>
                ))}
              </CommandGroup>
            )}
          </CommandList>

          {/* Footer with keyboard hints */}
          <div className="text-muted-foreground flex items-center justify-between border-t px-3 py-2 text-xs">
            <div className="flex items-center gap-1">
              <Kbd>
                <ArrowUp className="size-3" />
              </Kbd>
              <Kbd>
                <ArrowDown className="size-3" />
              </Kbd>
              <span className="ml-1">Navigate</span>
            </div>
            <div className="flex items-center gap-4">
              <div className="flex items-center gap-1">
                <Kbd>
                  <CornerDownLeft className="size-3" />
                </Kbd>
                <span>Open</span>
              </div>
              <div className="flex items-center gap-1">
                <Kbd>esc</Kbd>
                <span>Close</span>
              </div>
            </div>
          </div>
        </Command>
      </DialogContent>
    </Dialog>
  );
}

/**
 * Trigger button for opening the wiki search
 * Shows search icon and keyboard shortcut
 */
export function WikiSearchTrigger() {
  const [open, setOpen] = useState(false);

  // Global keyboard shortcut (Cmd+K or Ctrl+K)
  useEffect(() => {
    const down = (e: KeyboardEvent) => {
      if (e.key === "k" && (e.metaKey || e.ctrlKey)) {
        e.preventDefault();
        setOpen((prev) => !prev);
      }
    };

    document.addEventListener("keydown", down);
    return () => document.removeEventListener("keydown", down);
  }, []);

  return (
    <>
      <button
        onClick={() => setOpen(true)}
        className="border-input bg-background text-muted-foreground hover:bg-accent hover:text-accent-foreground relative flex h-9 w-full items-center gap-2 rounded-md border px-3 text-sm"
      >
        <Search className="h-4 w-4 shrink-0" />
        <span className="flex-1 text-left">Search...</span>
        <Kbd className="hidden sm:inline-flex">⌘K</Kbd>
      </button>
      <WikiSearch open={open} onOpenChange={setOpen} />
    </>
  );
}
