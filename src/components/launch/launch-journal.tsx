// ============================================================================
// The DATE journal (LS-002/LS-009) — how this Sunday came to be this Sunday.
//
// It lives inside the date card's edit surface rather than as a section of its
// own. The reason is that the rows only ever answer an administrative question
// — who moved the day, when, and from what — which is the question somebody is
// already asking when they have opened the date control. As a top-level section
// headed "History" it promised the plant's story and delivered a date audit;
// the plant's story is the History tab (`launch-history.tsx`).
//
// It carries the DATE half of `launch_events` only. Outcome rows are the same
// table but a different subject, and they render in the History tab —
// `isLaunchDateEvent` owns the split.
//
// A SERVER component: no state, no handlers, and — importantly — no clock. Every
// timestamp is formatted through `src/lib/datetime.ts`, pinned to
// `APP_TIME_ZONE`, so the server's markup and the hydrated markup are the same
// string (memory/invariants.md → Date & Time Rendering).
//
// The rows are append-only history. There is no edit control here and there is
// not meant to be one.
// ============================================================================

import {
  formatLaunchDay,
  journalEntryLabel,
  launchDateEvents,
} from "@/components/launch/presentation";
import { Badge } from "@/components/ui/badge";
import { formatDateTime } from "@/lib/datetime";
import type { LaunchJournalEntry } from "@/lib/launch/journal";

export function LaunchJournal({ entries }: { entries: LaunchJournalEntry[] }) {
  const dateEntries = launchDateEvents(entries);
  if (dateEntries.length === 0) return null;

  return (
    <section aria-labelledby="launch-date-history-heading">
      <h3
        id="launch-date-history-heading"
        className="text-sm font-medium tracking-tight"
      >
        Date history
      </h3>
      <ol className="mt-3 space-y-3">
        {/* Newest first for reading; the query returns the story in order. */}
        {[...dateEntries].reverse().map((entry) => (
          <li key={entry.id} className="flex flex-wrap items-baseline gap-x-2">
            <Badge variant="outline">{journalEntryLabel(entry)}</Badge>
            <span className="text-sm">
              {/* An arrow means the day CHANGED. A row that carries the same
                  date on both sides — the first scheduling has no previous day
                  at all — would read "Sep 20 → Sep 20" and suggest a move that
                  never happened. */}
              {entry.previousTargetDate &&
              entry.targetDate &&
              entry.previousTargetDate !== entry.targetDate ? (
                <>
                  {formatLaunchDay(entry.previousTargetDate, "short")} →{" "}
                  <span className="font-medium">
                    {formatLaunchDay(entry.targetDate, "short")}
                  </span>
                </>
              ) : entry.targetDate ? (
                <span className="font-medium">
                  {formatLaunchDay(entry.targetDate, "short")}
                </span>
              ) : (
                "No date recorded"
              )}
            </span>
            <span className="text-muted-foreground text-xs">
              {/* One string: the separators around the actor's name are
                  content, and JSX text nodes between expression containers are
                  at the mercy of the compiler's whitespace trimming — which is
                  how "0 of 9milestones" shipped. */}
              {`${formatDateTime(entry.createdAt, "short")}${entry.actorName ? ` · ${entry.actorName}` : ""}`}
            </span>
            {entry.note && (
              <p className="text-muted-foreground w-full text-sm">
                {entry.note}
              </p>
            )}
          </li>
        ))}
      </ol>
    </section>
  );
}
