"use client";

// ============================================================================
// AgendaBuilder — the meeting's running order (VM-013)
//
// The whole agenda is saved as one array on every change (see `setMeetingAgenda`
// in lib/meetings/service.ts): add, remove, retime and reorder are all "the
// running order is now this", so a reorder can never land half-applied.
//
// Two deliberate shapes here:
//
//  1. The rows are NOT held in component state. The sections arrive as props
//     from the server and `useOptimistic` shows the next array instantly while
//     the action lands — the house pattern (memory/contracts/data-patterns.md).
//     The only `useState` is the "add a section" form, which is form input.
//
//  2. The title and minutes fields are UNCONTROLLED (`defaultValue` + a commit
//     on blur). A controlled field would need the typed characters in state,
//     which is server data in `useState` by another name; and a field that
//     posted on every keystroke would write the agenda dozens of times per
//     rename. Rows are keyed by section id, so a reorder moves each field's
//     DOM node — and the text inside it — along with its row.
//
//  3. A section row is one line only from `sm` up. The minutes field and the
//     three icon buttons are already at their floor and cannot shrink, so on a
//     phone-width single line the name — the only flexible child — collapses to
//     a couple of dozen pixels and becomes unreadable. Below `sm` the row
//     stacks: the name takes the full row, the timing and the controls sit
//     under it.
//
// It imports nothing from `lib/meetings/service.ts`: that module pulls in the
// database client, and this is a client component. EVERY piece of agenda policy
// — the section type, the template type, the three bounds, the clamp, the total
// and the template→section mint — comes from `lib/meetings/agenda.ts`, which
// imports nothing but an erased type and is the ONE place that policy is
// written. Nothing here restates it: no `120` in a `maxLength`, no hand-rolled
// sum over `minutes`, and not one section id minted in this file — both paths
// that produce a section call `sectionsFromTemplates`, so this file contains no
// `crypto.randomUUID()` at all.
// Restating policy and keeping the two copies in agreement by hand is exactly
// what agenda.ts exists to end. WHICH default this meeting gets is decided by
// `defaultAgendaTemplatesForType` on the server and still arrives as a prop.
// ============================================================================

import { useOptimistic, useState, useTransition } from "react";
import {
  ArrowDown,
  ArrowUp,
  Clock,
  ListOrdered,
  Loader2,
  Plus,
  Trash2,
} from "lucide-react";
import { toast } from "sonner";

import { useCan } from "@/components/shared/viewer-capabilities";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  agendaTotalMinutes,
  clampAgendaMinutes,
  sectionsFromTemplates,
  MAX_AGENDA_SECTIONS,
  MAX_SECTION_MINUTES,
  MAX_SECTION_TITLE_LENGTH,
  type AgendaSection,
  type AgendaSaveResult,
  type AgendaSectionTemplate,
} from "@/lib/meetings/agenda";

export interface AgendaBuilderProps {
  meetingId: string;
  /** The stored running order, in order. Empty means "no agenda yet". */
  sections: AgendaSection[];
  /**
   * The running order this meeting type starts from, offered from the empty
   * state. Omit it (or pass an empty array) and the empty state simply invites
   * the first section instead.
   */
  defaultSections?: readonly AgendaSectionTemplate[];
  /** Replaces the whole running order. Mints its own actor server-side. */
  saveAction: (
    meetingId: string,
    sections: AgendaSection[]
  ) => Promise<AgendaSaveResult>;
}

/**
 * "1h 30m", "45m", "2h". Zero reads as "0m", never as an empty string — a
 * total of nothing is still a total, and a blank there looks like a bug.
 */
export function formatAgendaDuration(totalMinutes: number): string {
  const safe = Math.max(0, Math.round(totalMinutes));
  const hours = Math.floor(safe / 60);
  const minutes = safe % 60;

  if (hours === 0) return `${minutes}m`;
  if (minutes === 0) return `${hours}h`;
  return `${hours}h ${minutes}m`;
}

export function AgendaBuilder({
  meetingId,
  sections,
  defaultSections,
  saveAction,
}: AgendaBuilderProps) {
  // AS-020. Every path out of this card lands on `saveAgendaAction` —
  // `meetings.write` — so a Member reads the running order and edits none of
  // it: the name and length fields become text, and the reorder, remove, add
  // and "start from the standard agenda" controls are absent. The order and the
  // totals are the READ, and they stay.
  const canWrite = useCan("meetings.write");
  const [isPending, startTransition] = useTransition();
  const [optimisticSections, setOptimisticSections] = useOptimistic(
    sections,
    (_current, next: AgendaSection[]) => next
  );
  const [newTitle, setNewTitle] = useState("");
  const [newMinutes, setNewMinutes] = useState("10");

  const totalMinutes = agendaTotalMinutes(optimisticSections);
  const isFull = optimisticSections.length >= MAX_AGENDA_SECTIONS;

  const commit = (next: AgendaSection[]) => {
    startTransition(async () => {
      setOptimisticSections(next);
      const result = await saveAction(meetingId, next);
      if (!result.success) {
        toast.error(result.error);
      }
    });
  };

  const handleUseDefault = () => {
    if (!defaultSections || defaultSections.length === 0) return;
    commit(sectionsFromTemplates(defaultSections));
  };

  const handleAdd = (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();

    const title = newTitle.trim();
    if (!title) {
      toast.error("Give the section a name.");
      return;
    }
    if (isFull) {
      toast.error(`An agenda holds at most ${MAX_AGENDA_SECTIONS} sections.`);
      return;
    }

    // A typed row is a one-element template: same id mint, same clamp, one
    // implementation. Nothing in this file mints a section id of its own.
    commit([
      ...optimisticSections,
      ...sectionsFromTemplates([{ title, minutes: Number(newMinutes) }]),
    ]);
    setNewTitle("");
    setNewMinutes("10");
  };

  const handleRename = (section: AgendaSection, raw: string) => {
    const title = raw.trim();
    if (title === section.title) return;
    if (!title) {
      toast.error("A section needs a name.");
      return;
    }

    commit(
      optimisticSections.map((current) =>
        current.id === section.id ? { ...current, title } : current
      )
    );
  };

  const handleRetime = (section: AgendaSection, raw: string) => {
    const minutes = clampAgendaMinutes(Number(raw));
    if (minutes === section.minutes) return;

    commit(
      optimisticSections.map((current) =>
        current.id === section.id ? { ...current, minutes } : current
      )
    );
  };

  const handleMove = (index: number, direction: -1 | 1) => {
    const target = index + direction;
    if (target < 0 || target >= optimisticSections.length) return;

    const next = [...optimisticSections];
    const [moved] = next.splice(index, 1);
    next.splice(target, 0, moved);
    commit(next);
  };

  const handleRemove = (section: AgendaSection) => {
    commit(optimisticSections.filter((current) => current.id !== section.id));
  };

  return (
    <Card data-testid="agenda-builder">
      <CardHeader>
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="space-y-1">
            <CardTitle className="flex items-center gap-2">
              <ListOrdered className="text-muted-foreground h-4 w-4" />
              Agenda
            </CardTitle>
            <CardDescription>
              The running order for this meeting, and how long each part gets.
            </CardDescription>
          </div>
          {optimisticSections.length > 0 && (
            <div
              className="text-muted-foreground flex items-center gap-2 text-sm"
              data-testid="agenda-summary"
            >
              {isPending ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
              ) : (
                <Clock className="h-3.5 w-3.5" />
              )}
              <span>
                {optimisticSections.length}{" "}
                {optimisticSections.length === 1 ? "section" : "sections"}
              </span>
              <span aria-hidden="true">·</span>
              <span className="text-foreground font-medium tabular-nums">
                <span className="sr-only">Total length </span>
                <span data-testid="agenda-total">
                  {formatAgendaDuration(totalMinutes)}
                </span>{" "}
                total
              </span>
            </div>
          )}
        </div>
      </CardHeader>

      <CardContent className="space-y-4">
        {optimisticSections.length === 0 ? (
          <div
            className="border-muted-foreground/25 rounded-lg border border-dashed px-6 py-10 text-center"
            data-testid="agenda-empty"
          >
            <ListOrdered
              className="text-muted-foreground/60 mx-auto h-8 w-8"
              aria-hidden="true"
            />
            <p className="mt-3 text-sm font-medium">No agenda yet</p>
            <p className="text-muted-foreground mx-auto mt-1 max-w-sm text-sm">
              {canWrite
                ? "Plan the running order so everyone in the room knows what happens next — and how long it gets."
                : "Your plant's admins set the running order. It shows up here once they do."}
            </p>
            {canWrite && defaultSections && defaultSections.length > 0 && (
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={handleUseDefault}
                disabled={isPending}
                className="mt-4 cursor-pointer"
                data-testid="agenda-use-default"
              >
                <Plus className="mr-2 h-4 w-4" />
                Start from the standard agenda
              </Button>
            )}
          </div>
        ) : (
          <ol className="space-y-2">
            {optimisticSections.map((section, index) => (
              <li
                key={section.id}
                className="bg-muted/40 flex flex-col gap-2 rounded-md border p-3 sm:flex-row sm:items-center sm:gap-3"
                data-testid="agenda-section"
              >
                {/* Below `sm` this pair stacks — see note 3 at the top. */}
                <div className="flex min-w-0 flex-1 items-center gap-3">
                  <span className="text-muted-foreground w-5 shrink-0 text-center text-sm tabular-nums">
                    {index + 1}
                  </span>

                  <div className="min-w-0 flex-1">
                    {canWrite ? (
                      <>
                        <Label
                          htmlFor={`agenda-title-${section.id}`}
                          className="sr-only"
                        >
                          Section {index + 1} name
                        </Label>
                        <Input
                          id={`agenda-title-${section.id}`}
                          defaultValue={section.title}
                          disabled={isPending}
                          maxLength={MAX_SECTION_TITLE_LENGTH}
                          data-testid="agenda-section-title"
                          onBlur={(event) =>
                            handleRename(section, event.target.value)
                          }
                          onKeyDown={(event) => {
                            if (event.key === "Enter") {
                              event.preventDefault();
                              event.currentTarget.blur();
                            }
                          }}
                        />
                      </>
                    ) : (
                      <p
                        className="truncate text-sm font-medium"
                        data-testid="agenda-section-title"
                      >
                        {section.title}
                      </p>
                    )}
                  </div>
                </div>

                <div className="flex flex-wrap items-center justify-between gap-2 sm:justify-end sm:gap-3">
                  <div className="flex shrink-0 items-center gap-1.5">
                    {canWrite ? (
                      <>
                        <Label
                          htmlFor={`agenda-minutes-${section.id}`}
                          className="sr-only"
                        >
                          Section {index + 1} length in minutes
                        </Label>
                        <Input
                          id={`agenda-minutes-${section.id}`}
                          type="number"
                          inputMode="numeric"
                          min={0}
                          max={MAX_SECTION_MINUTES}
                          defaultValue={section.minutes}
                          disabled={isPending}
                          className="w-20 tabular-nums"
                          data-testid="agenda-section-minutes"
                          onBlur={(event) => {
                            const clamped = clampAgendaMinutes(
                              Number(event.target.value)
                            );
                            // Show what was actually stored, not what was typed.
                            event.target.value = String(clamped);
                            handleRetime(section, event.target.value);
                          }}
                          onKeyDown={(event) => {
                            if (event.key === "Enter") {
                              event.preventDefault();
                              event.currentTarget.blur();
                            }
                          }}
                        />
                      </>
                    ) : (
                      <span
                        className="text-muted-foreground text-sm tabular-nums"
                        data-testid="agenda-section-minutes"
                      >
                        {section.minutes}
                      </span>
                    )}
                    <span className="text-muted-foreground text-sm">min</span>
                  </div>

                  {canWrite && (
                    <div className="flex shrink-0 items-center gap-1">
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon"
                        disabled={isPending || index === 0}
                        onClick={() => handleMove(index, -1)}
                        aria-label={`Move ${section.title} up`}
                        className="cursor-pointer"
                        data-testid="agenda-move-up"
                      >
                        <ArrowUp className="h-4 w-4" />
                      </Button>
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon"
                        disabled={
                          isPending || index === optimisticSections.length - 1
                        }
                        onClick={() => handleMove(index, 1)}
                        aria-label={`Move ${section.title} down`}
                        className="cursor-pointer"
                        data-testid="agenda-move-down"
                      >
                        <ArrowDown className="h-4 w-4" />
                      </Button>
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon"
                        disabled={isPending}
                        onClick={() => handleRemove(section)}
                        aria-label={`Remove ${section.title}`}
                        className="text-muted-foreground hover:text-destructive cursor-pointer"
                        data-testid="agenda-remove"
                      >
                        <Trash2 className="h-4 w-4" />
                      </Button>
                    </div>
                  )}
                </div>
              </li>
            ))}
          </ol>
        )}

        {canWrite && (
          <form
            onSubmit={handleAdd}
            className="flex flex-wrap items-end gap-2 border-t pt-4"
          >
            <div className="min-w-40 flex-1">
              <Label htmlFor="agenda-new-title" className="sr-only">
                New section name
              </Label>
              <Input
                id="agenda-new-title"
                value={newTitle}
                onChange={(event) => setNewTitle(event.target.value)}
                placeholder="Add a section — Welcome, Worship, Q&A…"
                maxLength={MAX_SECTION_TITLE_LENGTH}
                disabled={isPending || isFull}
                data-testid="agenda-add-title"
              />
            </div>
            <div className="flex items-center gap-1.5">
              <Label htmlFor="agenda-new-minutes" className="sr-only">
                New section length in minutes
              </Label>
              <Input
                id="agenda-new-minutes"
                type="number"
                inputMode="numeric"
                min={0}
                max={MAX_SECTION_MINUTES}
                value={newMinutes}
                onChange={(event) => setNewMinutes(event.target.value)}
                className="w-20 tabular-nums"
                disabled={isPending || isFull}
                data-testid="agenda-add-minutes"
              />
              <span className="text-muted-foreground text-sm">min</span>
            </div>
            <Button
              type="submit"
              variant="outline"
              disabled={isPending || isFull}
              className="cursor-pointer"
              data-testid="agenda-add-submit"
            >
              <Plus className="mr-2 h-4 w-4" />
              Add section
            </Button>
          </form>
        )}
      </CardContent>
    </Card>
  );
}
