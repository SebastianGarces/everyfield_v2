"use client";

import { useId, useState, useTransition } from "react";
import { toast } from "sonner";

import { importTaskTemplateAction } from "@/app/(dashboard)/tasks/actions";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { TEMPLATE_REIMPORT_NOTE } from "@/lib/tasks/import";
import {
  taskTemplateSize,
  taskTemplatesByPhase,
  type TaskTemplate,
} from "@/lib/tasks/templates";

// ============================================================================
// T-011 / T-012 — the checklist template picker.
//
// EVERY GROUP IS OPEN. The FRD's screen draws each phase expanded, and that is
// the right call for a catalog this size: a planter comparing "Ministry Team
// Setup" with "Launch Date Planning" should not have to remember which
// accordion each one was behind. The phases stay in journey order — the one at
// the plant's own stage is MARKED rather than moved, because reordering the
// journey to put the present first hides how far along it is.
//
// NO SERVER DATA IN STATE (`memory/contracts/data-patterns.md`). The catalog is
// code, so it is imported, not fetched; the tasks it creates are read by the
// list this sits above, which reconciles through the action's `refresh()`. The
// three pieces of state here are all UI: which button is in flight, and which
// row failed and why.
// ============================================================================

/** Copy shown when the request itself failed, as opposed to a refusal. */
const IMPORT_FAILED_MESSAGE =
  "We could not import that checklist just now. Nothing was created — try again.";

function taskCountLabel(count: number): string {
  return count === 1 ? "1 task" : `${count} tasks`;
}

/**
 * How far the checklist reaches, in plain words.
 *
 * Read from the items, not typed into the copy, so a template that grows an
 * item cannot leave a stale promise behind it.
 */
function spanLabel(template: TaskTemplate): string {
  const furthest = template.items.reduce(
    (days, item) => Math.max(days, item.offsetDays),
    0
  );

  if (furthest === 0) return "all due the day you import it";
  if (furthest === 1) return "spread over the day after you import it";
  return `spread over the ${furthest} days after you import it`;
}

export function TaskTemplatePicker({
  currentPhase,
}: {
  /** The plant's phase, used to mark the group at its stage. */
  currentPhase?: number | null;
}) {
  const [pending, startTransition] = useTransition();
  const [pressedKey, setPressedKey] = useState<string | null>(null);
  const [failure, setFailure] = useState<{
    templateKey: string;
    message: string;
  } | null>(null);
  const headingId = useId();
  const errorId = useId();

  function importTemplate(template: TaskTemplate) {
    setFailure(null);
    setPressedKey(template.key);

    startTransition(async () => {
      try {
        const result = await importTaskTemplateAction(template.key);

        if (!result.success) {
          setFailure({ templateKey: template.key, message: result.error });
          return;
        }

        toast.success(
          `Added ${taskCountLabel(result.data.created)} from ${result.data.templateName}`
        );
      } catch {
        // The action rejected outright — uncaught, that rejection escapes the
        // transition callback and leaves the button stuck pending with nothing
        // on screen to explain it.
        setFailure({
          templateKey: template.key,
          message: IMPORT_FAILED_MESSAGE,
        });
      } finally {
        setPressedKey(null);
      }
    });
  }

  const groups = taskTemplatesByPhase().filter(
    (group) => group.templates.length > 0
  );

  return (
    <section aria-labelledby={headingId} className="space-y-8">
      <div className="space-y-2">
        <h2 id={headingId} className="text-lg font-medium">
          Checklist templates
        </h2>
        <p className="text-muted-foreground text-sm">
          Import a ready-made checklist and its tasks are created for your
          plant, with due dates counted from today.
        </p>
        {/* The repeat policy, said once and in words. There is no dedupe, so
            the product owes the planter this sentence before the press. */}
        <p className="text-muted-foreground text-sm">
          {TEMPLATE_REIMPORT_NOTE}
        </p>
      </div>

      {groups.map((group) => {
        const isCurrentPhase = group.phase === currentPhase;

        return (
          <div key={group.phase} className="space-y-3">
            <div className="flex flex-wrap items-center gap-2">
              <h3 className="text-sm font-medium">{group.phaseName}</h3>
              {isCurrentPhase && (
                <Badge variant="secondary">Your stage now</Badge>
              )}
            </div>

            <ul className="divide-border border-border divide-y rounded-md border">
              {group.templates.map((template) => {
                const failedHere = failure?.templateKey === template.key;
                const busy = pending && pressedKey === template.key;

                return (
                  <li
                    key={template.key}
                    className="flex flex-col gap-3 p-4 sm:flex-row sm:items-start sm:justify-between"
                  >
                    <div className="space-y-1">
                      <p className="text-sm font-medium">{template.name}</p>
                      <p className="text-muted-foreground text-sm">
                        {template.description}
                      </p>
                      <p className="text-muted-foreground text-xs">
                        {`${taskCountLabel(taskTemplateSize(template))}, ${spanLabel(template)}.`}
                      </p>
                      {/* The failure belongs to the row that failed, so it
                          renders here rather than at the top of a catalog the
                          planter may have scrolled a long way down. */}
                      {failedHere && (
                        <p
                          id={errorId}
                          role="alert"
                          className="bg-destructive/10 text-destructive rounded-md p-2 text-sm"
                        >
                          {failure.message}
                        </p>
                      )}
                    </div>

                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      className="cursor-pointer sm:w-auto"
                      onClick={() => importTemplate(template)}
                      disabled={pending}
                      aria-busy={busy}
                      aria-describedby={failedHere ? errorId : undefined}
                      // Nineteen buttons reading "Import" are nineteen
                      // identical accessible names in a screen reader's
                      // control list. The visible word starts the accessible
                      // name, so label-in-name still holds.
                      aria-label={`Import ${template.name}`}
                    >
                      {busy ? "Importing…" : "Import"}
                    </Button>
                  </li>
                );
              })}
            </ul>
          </div>
        );
      })}
    </section>
  );
}
