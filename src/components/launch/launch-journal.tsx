// ============================================================================
// The date journal, read as a story (LS-002/LS-009).
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
  journalEventLabel,
} from "@/components/launch/presentation";
import { Badge } from "@/components/ui/badge";
import { formatDateTime } from "@/lib/datetime";
import type { LaunchJournalEntry } from "@/lib/launch/journal";

export function LaunchJournal({ entries }: { entries: LaunchJournalEntry[] }) {
  if (entries.length === 0) return null;

  return (
    <section className="bg-card rounded-xl border shadow-sm">
      <h2 className="border-b px-6 py-4 text-sm font-semibold tracking-wide uppercase">
        History
      </h2>
      <ol className="divide-y">
        {/* Newest first for reading; the query returns the story in order. */}
        {[...entries].reverse().map((entry) => (
          <li key={entry.id} className="px-6 py-4">
            <div className="flex flex-wrap items-center gap-2">
              <Badge variant="outline">{journalEventLabel(entry.event)}</Badge>
              <span className="text-muted-foreground text-xs">
                {formatDateTime(entry.createdAt, "short")}
                {entry.actorName ? ` · ${entry.actorName}` : ""}
              </span>
            </div>
            <p className="mt-1.5 text-sm">
              {entry.previousTargetDate && entry.targetDate ? (
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
            </p>
            {entry.note && (
              <p className="text-muted-foreground mt-1 text-sm">{entry.note}</p>
            )}
          </li>
        ))}
      </ol>
    </section>
  );
}
