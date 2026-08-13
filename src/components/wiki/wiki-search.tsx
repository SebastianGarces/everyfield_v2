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
// From the module that DEFINES it, never the `@/lib/wiki` barrel: the barrel
// reaches `@/db` through every other wiki module, and this is a `"use client"`
// component (`search-request.ts` says so for the same reason).
import type { SearchResult } from "@/lib/wiki/search";
import { wikiHref } from "@/lib/wiki/href";
import {
  SEARCH_UNAVAILABLE_MESSAGE,
  runWikiSearch,
} from "@/lib/wiki/search-request";
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

/**
 * What the list is showing — ONE state, not four booleans (#411 round 4).
 *
 * `WikiSearchOutcome` already models the answer as a union, and this component
 * used to decompose it back into four independent flags (`results`,
 * `isSearching`, `hasSearched`, `isUnavailable`), of which only four of the
 * sixteen combinations were legal. The cost landed in the render: five guards
 * that each had to repeat every earlier guard's negation, and one of them
 * (the results list) that did not — correct only because two setters happened
 * to sit in the same React batch. Holding the union makes the illegal states
 * unrepresentable and the arms mutually exclusive by construction.
 *
 * `searchWikiArticles` refuses by throwing (it mints an actor above everything
 * else, and a failed read rethrows too), and the dialog used to await it with
 * no rejection handling inside an async `setTimeout`: an unhandled rejection,
 * and a "Searching…" spinner that never settled because every line below the
 * `await` was skipped. `runWikiSearch` turns every request into an outcome,
 * and `"unavailable"` is that outcome as the reader sees it
 * (`src/lib/wiki/search-request.ts`).
 */
type View =
  | { kind: "idle" }
  | { kind: "searching" }
  | { kind: "unavailable" }
  | { kind: "results"; rows: SearchResult[] };

/**
 * The two outcome sentences, spelled once.
 *
 * Each is rendered twice — visibly in its arm, and inside the live region
 * below — so they are constants rather than two literals that can drift.
 */
const SEARCHING_MESSAGE = "Searching...";
const NO_RESULTS_MESSAGE = "No articles found.";

/**
 * What a screen reader is told, derived from the ONE state that decides it.
 *
 * The dialog used to put `role="status"` on the arms themselves (#411 round 5).
 * A live region is only announced when text changes INSIDE a region that was
 * already in the DOM, and those arms are mutually exclusive: every transition
 * detached one region and mounted another, so nothing was ever an update to a
 * live region — and the results arm carried no region at all, which left the
 * whole dialog with none once rows rendered. The refusal message this component
 * exists to make legible could therefore never be announced.
 *
 * One region, mounted for the life of the list, whose text is a function of
 * `view` — the same "the union holds the state" reframing already applied to
 * the render. `role="status"` is `aria-live="polite"` plus `aria-atomic="true"`,
 * so the whole sentence is read on each change.
 */
function announcementFor(view: View): string {
  switch (view.kind) {
    case "idle":
      return "";
    case "searching":
      return SEARCHING_MESSAGE;
    case "unavailable":
      return SEARCH_UNAVAILABLE_MESSAGE;
    case "results":
      return view.rows.length === 0
        ? NO_RESULTS_MESSAGE
        : `${view.rows.length} ${view.rows.length === 1 ? "article" : "articles"} found.`;
  }
}

export function WikiSearch({ open, onOpenChange }: WikiSearchProps) {
  const router = useRouter();
  const [query, setQuery] = useState("");
  const [view, setView] = useState<View>({ kind: "idle" });
  const [isNavigating, setIsNavigating] = useState(false);
  const debounceRef = useRef<NodeJS.Timeout | null>(null);
  /**
   * Which search the reader is actually waiting for.
   *
   * The debounce times the REQUEST, not the response, so a slow search can land
   * after a later, faster one: type "elder", pause, then finish "eldership" and
   * the first query's rows overwrite the second's — a result list that does not
   * answer the words in the box, and clicking one opens an article the reader
   * did not search for. Each request takes a token and only the newest one is
   * allowed to write state.
   */
  const latestRequestRef = useRef(0);

  // Handle query changes with debounced search
  const handleQueryChange = useCallback((value: string) => {
    setQuery(value);

    // Clear previous timeout
    if (debounceRef.current) {
      clearTimeout(debounceRef.current);
    }

    // Anything already in flight is stale the moment the query changes,
    // including on the way back to an empty box.
    const request = ++latestRequestRef.current;

    // An empty box retires the previous outcome, failure included.
    if (!value.trim()) {
      setView({ kind: "idle" });
      return;
    }

    // Show searching state immediately
    setView({ kind: "searching" });

    // Debounce search. One assignment settles the request, so the searching
    // state cannot survive either outcome and no two states can be held at
    // once.
    debounceRef.current = setTimeout(async () => {
      const outcome = await runWikiSearch(searchWikiArticles, value);
      if (request !== latestRequestRef.current) return;

      setView(
        outcome.status === "results"
          ? { kind: "results", rows: outcome.results }
          : { kind: "unavailable" }
      );
    }, 300);
  }, []);

  // Cleanup timeout on unmount, and retire whatever is already in flight — a
  // response that arrives after the dialog closed has nothing left to write to.
  useEffect(() => {
    const requests = latestRequestRef;
    return () => {
      if (debounceRef.current) {
        clearTimeout(debounceRef.current);
      }
      requests.current += 1;
    };
  }, []);

  const handleSelect = useCallback(
    (slug: string) => {
      // Hide immediately via CSS, then close and navigate
      setIsNavigating(true);
      onOpenChange(false);
      router.push(wikiHref(slug));
    },
    [onOpenChange, router]
  );

  // When navigating, render nothing to prevent any flash
  if (isNavigating) {
    return null;
  }

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

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogHeader className="sr-only">
        <DialogTitle>Search Wiki</DialogTitle>
        <DialogDescription>Search for articles in the wiki</DialogDescription>
      </DialogHeader>
      <DialogContent className="overflow-hidden p-0" showCloseButton={false}>
        <Command
          shouldFilter={false}
          className="[&_[cmdk-group-heading]]:text-muted-foreground [&_[cmdk-group-heading]]:px-2 [&_[cmdk-group-heading]]:font-medium [&_[cmdk-group]]:px-2 [&_[cmdk-input]]:h-12 [&_[cmdk-item]]:px-2 [&_[cmdk-item]]:py-3"
        >
          {/* The dialog's ONE live region. Unconditional, so a change of
              outcome is a text change inside a region that is already there —
              which is the only thing a screen reader announces. It sits here,
              beside the listbox rather than inside it: cmdk gives
              `CommandList` `role="listbox"`, and a listbox may own only
              options and groups, so a `role="status"` child is an
              `aria-required-children` violation and is liable to be pruned by
              the very AT it exists to talk to. `Command` lives exactly as long
              as `CommandList`, so the region is no less permanent here. The
              arms inside the list below are purely visual. */}
          <div role="status" className="sr-only">
            {announcementFor(view)}
          </div>

          <CommandInput
            placeholder="Search articles..."
            value={query}
            onValueChange={handleQueryChange}
          />
          <CommandList className="h-[300px] max-h-[300px]">
            {/* Loading state */}
            {view.kind === "searching" && (
              <div className="text-muted-foreground flex h-full items-center justify-center text-sm">
                {SEARCHING_MESSAGE}
              </div>
            )}

            {/* Refused or failed — the spinner settles here rather than
                spinning forever on a rejected request. */}
            {view.kind === "unavailable" && (
              <div className="text-muted-foreground flex h-full items-center justify-center px-6 text-center text-sm text-balance">
                {SEARCH_UNAVAILABLE_MESSAGE}
              </div>
            )}

            {/* Empty state — a search that RAN and matched nothing, which is a
                different statement from the one above it. */}
            {view.kind === "results" && view.rows.length === 0 && (
              <div className="text-muted-foreground flex h-full items-center justify-center text-sm">
                {NO_RESULTS_MESSAGE}
              </div>
            )}

            {/* Initial state - no query */}
            {view.kind === "idle" && (
              <div className="text-muted-foreground flex h-full items-center justify-center text-sm">
                Start typing to search articles...
              </div>
            )}

            {/* Results */}
            {view.kind === "results" && view.rows.length > 0 && (
              <CommandGroup heading={`Results (${view.rows.length})`}>
                {view.rows.map((result) => (
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
 *
 * Uses the key pattern from React docs to reset WikiSearch state on each open:
 * https://react.dev/learn/you-might-not-need-an-effect#resetting-all-state-when-a-prop-changes
 */
export function WikiSearchTrigger() {
  const [open, setOpen] = useState(false);
  // Increment key each time we open to force fresh state in WikiSearch
  const [searchKey, setSearchKey] = useState(0);

  const handleOpen = useCallback(() => {
    setSearchKey((k) => k + 1);
    setOpen(true);
  }, []);

  const handleOpenChange = useCallback((newOpen: boolean) => {
    if (newOpen) {
      // Opening - increment key to reset WikiSearch state
      setSearchKey((k) => k + 1);
    }
    setOpen(newOpen);
  }, []);

  // Global keyboard shortcut (Cmd+K or Ctrl+K)
  useEffect(() => {
    const down = (e: KeyboardEvent) => {
      if (e.key === "k" && (e.metaKey || e.ctrlKey)) {
        e.preventDefault();
        if (!open) {
          handleOpen();
        } else {
          setOpen(false);
        }
      }
    };

    document.addEventListener("keydown", down);
    return () => document.removeEventListener("keydown", down);
  }, [open, handleOpen]);

  return (
    <>
      <button
        onClick={handleOpen}
        className="border-input bg-background text-muted-foreground hover:bg-accent hover:text-accent-foreground relative flex h-9 w-full items-center gap-2 rounded-md border px-3 text-sm"
      >
        <Search className="h-4 w-4 shrink-0" />
        <span className="flex-1 text-left">Search...</span>
        <Kbd className="hidden sm:inline-flex">⌘K</Kbd>
      </button>
      <WikiSearch key={searchKey} open={open} onOpenChange={handleOpenChange} />
    </>
  );
}
