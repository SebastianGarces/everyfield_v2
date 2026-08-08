// ============================================================================
// The History tab — what the plant has actually DONE (LS-003/LS-004/LS-006).
//
// This is the section that used to be headed "History" and showed a date audit
// instead. What a team wants from a launch history is the work: who closed
// which milestone and when, with the outcome being recorded — or corrected —
// interleaved in the same column, because they happened in one timeline.
//
// The date journal is NOT here. Scheduling, moving and postponing are the
// planter's administrative record and sit inside the date card's edit surface,
// where the control that produces them lives (`launch-journal.tsx`).
//
// A SERVER component: no state, no handlers, no clock. Every timestamp is
// formatted through `src/lib/datetime.ts`, pinned to `APP_TIME_ZONE`
// (memory/invariants.md → Date & Time Rendering).
//
// EVERY VIEWER SEES IT, planter and team member alike. Completion follows
// normal task rules (LS-007), so the record of who completed what is the
// plant's, not the planter's.
// ============================================================================

import { CircleCheck, PartyPopper } from "lucide-react";

import type { LaunchHistoryEntry } from "@/components/launch/presentation";
import { formatDateTime } from "@/lib/datetime";

export function LaunchHistory({ entries }: { entries: LaunchHistoryEntry[] }) {
  if (entries.length === 0) {
    return (
      <div className="bg-card rounded-xl border border-dashed p-6 text-center shadow-sm">
        <p className="font-medium">Nothing has happened yet</p>
        <p className="text-muted-foreground mt-1 text-sm">
          Close a milestone on the Tasks tab and it shows up here, with who
          closed it and when.
        </p>
      </div>
    );
  }

  return (
    <div className="bg-card rounded-xl border shadow-sm">
      <ol className="divide-y">
        {entries.map((entry) => (
          <li key={entry.key} className="flex items-start gap-3 px-6 py-4">
            {entry.kind === "milestone" ? (
              <CircleCheck
                className="mt-0.5 h-4 w-4 shrink-0 text-green-600 dark:text-green-500"
                aria-hidden="true"
              />
            ) : (
              <PartyPopper
                className="text-primary mt-0.5 h-4 w-4 shrink-0"
                aria-hidden="true"
              />
            )}

            <div className="min-w-0 flex-1">
              <p className="font-medium">
                {entry.kind === "milestone" ? entry.title : entry.label}
              </p>
              <p className="text-muted-foreground mt-0.5 text-xs">
                {/* ONE string rather than several JSX children: the separators
                    and the words around the name are content, and JSX text
                    nodes between expression containers are at the mercy of the
                    compiler's whitespace trimming — which is how "0 of
                    9milestones" shipped. */}
                {`${entry.kind === "milestone" ? "Completed" : "Recorded"}${
                  entry.actorName ? ` by ${entry.actorName}` : ""
                } · ${formatDateTime(entry.at, "short")}`}
              </p>
              {entry.kind === "outcome" && entry.note && (
                <p className="mt-1 text-sm whitespace-pre-line">{entry.note}</p>
              )}
            </div>
          </li>
        ))}
      </ol>
    </div>
  );
}
