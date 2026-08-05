// ============================================================================
// TrainingMatrix — who has completed which training, as a grid (people × programs).
//
// Presentational. It reads no data, calls no action and holds no state: it is
// handed the programs and the per-person completion rows that the ministry-teams
// read layer already projected (lib/ministry-teams/service.ts,
// `getTrainingMatrix`), and it draws them.
//
// It was lifted verbatim out of components/ministry-teams/training-tab.tsx so
// the same table can be rendered from a fixture — the marketing page shows the
// real component rather than a screenshot of it (issue #296). The interactive
// host keeps the "Add Program" dialog, the server actions and the click that
// marks a cell complete; nothing in this file is a client component.
//
// The one place interactivity reaches into the grid is an *incomplete* cell,
// which in the app is a button that marks the training done. That is injected
// as `incompleteCell` rather than lived here, so this file stays server-safe
// and free of event handlers. Without it — the fixture case — the cell renders
// the same marker as a static span, which is pixel-identical to the button at
// rest.
//
// The prop types are structural on purpose: they are the narrowest shape this
// table actually reads, so a fixture does not have to fabricate whole database
// rows. `TrainingProgram` and `TrainingMatrixRow` both satisfy them.
// ============================================================================

import type { ReactNode } from "react";
import { Check, X } from "lucide-react";

import { Badge } from "@/components/ui/badge";

/** A training program, as far as the grid's header is concerned. */
export interface TrainingMatrixProgram {
  id: string;
  name: string;
  isRequired: boolean;
}

/** One person's row: their name, and which programs they have completed. */
export interface TrainingMatrixPerson {
  personId: string;
  personName: string;
  /** Keyed by program id. */
  completions: Record<string, boolean>;
}

interface TrainingMatrixProps {
  programs: TrainingMatrixProgram[];
  matrix: TrainingMatrixPerson[];
  /**
   * Renders the contents of a cell where the person has NOT completed the
   * program. The app passes a button that fires the mark-complete action;
   * omitting it renders an inert marker.
   */
  incompleteCell?: (cell: { personId: string; programId: string }) => ReactNode;
}

/**
 * The marker for an incomplete cell. Exported so the button the app injects
 * through `incompleteCell` draws the exact same glyph this file would.
 */
export function TrainingMatrixIncompleteMarker() {
  return <X className="text-muted-foreground/30 h-5 w-5" />;
}

export function TrainingMatrix({
  programs,
  matrix,
  incompleteCell,
}: TrainingMatrixProps) {
  return (
    <div className="overflow-x-auto rounded-lg border">
      <table className="w-full text-sm">
        <thead>
          <tr className="bg-muted/50 border-b">
            <th className="px-4 py-3 text-left font-medium">Team Member</th>
            {programs.map((program) => (
              <th
                key={program.id}
                className="px-3 py-3 text-center font-medium"
              >
                <div className="flex flex-col items-center gap-1">
                  <span className="max-w-[120px] truncate">{program.name}</span>
                  {program.isRequired && (
                    <Badge variant="outline" className="text-[10px]">
                      Required
                    </Badge>
                  )}
                </div>
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {matrix.map((row) => (
            <tr key={row.personId} className="border-b last:border-b-0">
              <td className="px-4 py-3 font-medium">{row.personName}</td>
              {programs.map((program) => {
                const isComplete = row.completions[program.id];
                return (
                  <td key={program.id} className="px-3 py-3 text-center">
                    {isComplete ? (
                      <div className="flex items-center justify-center">
                        <Check className="h-5 w-5 text-green-500" />
                      </div>
                    ) : incompleteCell ? (
                      incompleteCell({
                        personId: row.personId,
                        programId: program.id,
                      })
                    ) : (
                      // Same box as the button the app injects, minus the
                      // affordances — so a read-only render sits identically.
                      <span className="inline-flex items-center justify-center rounded p-1">
                        <TrainingMatrixIncompleteMarker />
                      </span>
                    )}
                  </td>
                );
              })}
            </tr>
          ))}
          {matrix.length === 0 && (
            <tr>
              <td
                colSpan={programs.length + 1}
                className="text-muted-foreground px-4 py-8 text-center"
              >
                No team members assigned yet. Assign members on the Members &
                Roles tab.
              </td>
            </tr>
          )}
        </tbody>
      </table>
    </div>
  );
}
