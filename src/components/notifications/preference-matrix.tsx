"use client";

import { useMemo, useOptimistic, useTransition } from "react";
import { toast } from "sonner";

import {
  setDigestCadenceAction,
  setNotificationPreferenceAction,
} from "@/app/(dashboard)/settings/actions";
import { Badge } from "@/components/ui/badge";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import type { DigestCadence } from "@/lib/notifications/categories";
import type {
  PreferenceCellView,
  PreferenceMatrixView,
} from "@/lib/notifications/preferences";
import { cn } from "@/lib/utils";
// ⚠️ PROTOTYPE — DISPOSABLE. Delete with the ruling on PR #369; see the module
// header of the file below for what to strip.
import {
  INELIGIBLE_ROLE_LABEL,
  useOversightEligibilityVariant,
} from "./oversight-eligibility-prototype";

// ============================================================================
// Screen 2 — the category × channel matrix (N-006).
//
// Presentation only. The server built the whole view model
// (`buildPreferenceMatrixView` in `@/lib/notifications/preferences`) — the rows
// from the code-defined category registry, the columns from the channel tuple,
// every cell already resolved against the user's stored rows. So this component
// never decides what a category is called, what its default is, or whether a
// cell is on: it renders what it was handed and reports what was clicked.
//
// Nothing here is hardcoded to today's six categories or two channels. Both
// come out of `view` and are mapped over, which is what makes adding a seventh
// category a change to the registry alone.
//
// Both imports from the preferences module are TYPES, so they are erased and
// bring none of the Drizzle table graph into the client bundle — the same
// division `notification-feed.tsx` keeps for Screen 1.
//
// That includes the cadence area: for an oversight recipient the server sends a
// `fixed` variant — an explanation instead of a selector — because the only
// digest they receive is fixed daily by N-025 and a control that cannot change
// what they receive is not a control (#254). Which variant arrives is the
// server's decision; this component just renders the one it was given.
//
// State: `useOptimistic` over the props, per memory/contracts/data-patterns.md.
// The switch moves the instant it is pressed, the action reconciles, and its
// `refresh()` re-renders this tree — including the layout's unread bell, which
// an `in_app` change moves too (N-005 is applied at read time). Server data is
// never copied into `useState`; the optimistic baseline is recomputed from
// `view` on every render.
//
// A failed write surfaces as a toast — and that works only because the actions
// RETURN their failures. A server action that throws rejects the promise awaited
// below, and the rejection unwinds the transition without ever reaching
// `toast.error`; before #236 the user saw the control snap back and nothing
// else. Both action bodies are now wrapped, so an expired session on a tab left
// open reads as a sentence rather than as a mis-click.
//
// The snap-back itself needs no undo here: `useOptimistic` drops back to the
// props when the transition ends, so a save that did not happen never leaves the
// control looking like one that did.
//
// The same #254 principle reaches the ROWS as well as the cadence area: a row
// the reader is never served (`row.eligible`, decided on the server against the
// delivery allow-list) is not a control they can usefully be offered. WHAT is
// ruled; HOW it is presented is not, so four presentations ship together behind
// the prototype switcher and every block that does it is marked
// `⚠️ PROTOTYPE — DISPOSABLE`. `row.eligible` and `view.ineligibleNote` are NOT
// prototype scaffolding and survive the ruling — only the branch on the variant
// goes.
// ============================================================================

export interface PreferenceMatrixProps {
  view: PreferenceMatrixView;
}

interface MatrixState {
  /** Keyed by `"category:channel"`. */
  cells: Record<string, boolean>;
  /** `null` when this reader has no cadence to choose — see the header. */
  cadence: DigestCadence | null;
}

type MatrixAction =
  | { type: "cell"; key: string; enabled: boolean }
  | { type: "cadence"; cadence: DigestCadence };

function applyMatrixAction(
  state: MatrixState,
  action: MatrixAction
): MatrixState {
  if (action.type === "cadence") {
    return { ...state, cadence: action.cadence };
  }

  return {
    ...state,
    cells: { ...state.cells, [action.key]: action.enabled },
  };
}

export function PreferenceMatrix({ view }: PreferenceMatrixProps) {
  const [, startTransition] = useTransition();

  // ⚠️ PROTOTYPE — DISPOSABLE (#369 presentation ruling). `"now"` is as built.
  const variant = useOversightEligibilityVariant();

  // Hoisted so TypeScript narrows the union once, rather than at each use.
  const digest = view.digest;

  const serverState = useMemo<MatrixState>(
    () => ({
      cells: Object.fromEntries(
        view.categories.flatMap((row) =>
          row.cells.map((cell) => [cell.key, cell.enabled] as const)
        )
      ),
      cadence: view.digest.kind === "choice" ? view.digest.cadence : null,
    }),
    [view]
  );

  const [state, apply] = useOptimistic(serverState, applyMatrixAction);

  const toggle = (cell: PreferenceCellView, enabled: boolean) => {
    startTransition(async () => {
      apply({ type: "cell", key: cell.key, enabled });

      const result = await setNotificationPreferenceAction({
        category: cell.category,
        channel: cell.channel,
        enabled,
      });

      if (!result.success) {
        toast.error(result.error);
      }
    });
  };

  const chooseCadence = (cadence: DigestCadence) => {
    startTransition(async () => {
      apply({ type: "cadence", cadence });

      const result = await setDigestCadenceAction(cadence);

      if (!result.success) {
        toast.error(result.error);
      }
    });
  };

  // Read off the OPTIMISTIC state so the hint appears and disappears with the
  // switch that causes it, rather than a round trip later.
  const digestRow = view.categories.find(
    (row) => row.category === digest.category
  );
  const digestIsOff =
    digestRow?.cells.every((cell) => state.cells[cell.key] === false) ?? false;

  return (
    <div className="bg-card rounded-lg border">
      {/* Column headers, for the eye only.
          `aria-hidden` is deliberate: every switch already carries a full
          accessible name ("Tasks — Email"), so announcing the header as well
          would read the channel twice per control and once more per row.
          Hidden on small screens too, where each switch carries its own
          VISIBLE channel label instead — a two-column table does not survive a
          phone, and a header row scrolled away from its rows is worse than
          none. */}
      <div
        aria-hidden="true"
        className="text-muted-foreground hidden items-center gap-6 border-b px-4 py-2 text-xs font-medium sm:flex"
      >
        <span className="flex-1">Category</span>
        <span className="flex">
          {view.channels.map((channel) => (
            <span key={channel.channel} className="w-20 text-center">
              {channel.label}
            </span>
          ))}
        </span>
      </div>

      <ul className="divide-y">
        {view.categories.map((row) => {
          // ⚠️ PROTOTYPE — DISPOSABLE (#369 presentation ruling) —— start.
          // The ROW-LEVEL fact is `row.eligible` and it is permanent; the three
          // branches on `variant` below are what the ruling replaces with one.
          const ineligible = !row.eligible;
          if (ineligible && variant === "a") return null;
          const inert = ineligible && variant !== "now";
          const noteId = `preference-ineligible-${row.category}`;
          // ⚠️ PROTOTYPE — DISPOSABLE —— end.

          return (
            <li
              key={row.category}
              data-testid={`preference-row-${row.category}`}
              data-eligible={row.eligible}
              className={cn(
                "flex flex-col gap-3 px-4 py-4 sm:flex-row sm:items-start sm:gap-6",
                // ⚠️ PROTOTYPE — DISPOSABLE: B greys the row it has made inert.
                inert && variant === "b" && "opacity-60"
              )}
            >
              <div className="min-w-0 flex-1 space-y-1">
                <p
                  id={`preference-category-${row.category}`}
                  className="flex items-center gap-2 text-sm font-medium"
                >
                  {row.label}
                  {/* ⚠️ PROTOTYPE — DISPOSABLE: C's token, and the whole of
                      what C says. It sits with the category name because that
                      is the thing it qualifies. */}
                  {inert && variant === "c" && (
                    <Badge
                      variant="secondary"
                      data-testid={`preference-ineligible-badge-${row.category}`}
                      className="font-normal"
                    >
                      {INELIGIBLE_ROLE_LABEL}
                    </Badge>
                  )}
                </p>
                <p className="text-muted-foreground text-sm text-pretty">
                  {row.description}
                </p>

                {/* ⚠️ PROTOTYPE — DISPOSABLE: B's one line. It is the server's
                    sentence (`view.ineligibleNote`), not the component's, so
                    the screen and the refused write say the same thing. */}
                {inert && variant === "b" && view.ineligibleNote && (
                  <p
                    id={noteId}
                    data-testid={`preference-ineligible-note-${row.category}`}
                    className="text-muted-foreground pt-1 text-xs text-pretty"
                  >
                    {view.ineligibleNote}
                  </p>
                )}

                {row.category === digest.category && (
                  <div className="pt-3">
                    {digest.kind === "choice" ? (
                      <>
                        <Label
                          htmlFor="digest-cadence"
                          className="text-muted-foreground text-xs font-medium"
                        >
                          {digest.label}
                        </Label>
                        <Select
                          value={state.cadence ?? digest.cadence}
                          onValueChange={(value) =>
                            chooseCadence(value as DigestCadence)
                          }
                        >
                          <SelectTrigger
                            id="digest-cadence"
                            size="sm"
                            data-testid="digest-cadence"
                            className="mt-1.5 cursor-pointer"
                            aria-describedby="digest-cadence-description"
                          >
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            {digest.options.map((option) => (
                              <SelectItem
                                key={option.value}
                                value={option.value}
                                data-testid={`digest-cadence-${option.value}`}
                                className="cursor-pointer"
                              >
                                {option.label}
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      </>
                    ) : null}

                    {/* The description is the same slot in both variants: for a
                        reader who chooses, it describes the choice; for a reader
                        who does not, it IS the answer — what decides the timing
                        instead of them (#254). */}
                    <p
                      id="digest-cadence-description"
                      data-testid={
                        digest.kind === "choice"
                          ? "digest-cadence-description"
                          : "digest-cadence-fixed"
                      }
                      className="text-muted-foreground mt-1.5 text-xs text-pretty"
                    >
                      {digest.description}
                    </p>
                    {digestIsOff && (
                      <p
                        data-testid="digest-off-hint"
                        className="text-muted-foreground mt-1 text-xs text-pretty"
                      >
                        Switch on a channel to start receiving it.
                      </p>
                    )}
                  </div>
                )}
              </div>

              <div
                role="group"
                aria-labelledby={`preference-category-${row.category}`}
                className="flex items-center gap-6 sm:gap-0"
              >
                {row.cells.map((cell) => {
                  const channelLabel =
                    view.channels.find((c) => c.channel === cell.channel)
                      ?.label ?? cell.channel;
                  const controlId = `preference-${cell.category}-${cell.channel}`;

                  return (
                    <div
                      key={cell.key}
                      className="flex items-center gap-2 sm:w-20 sm:justify-center sm:gap-0"
                    >
                      <Switch
                        id={controlId}
                        data-testid={`preference-toggle-${cell.category}-${cell.channel}`}
                        data-source={cell.source}
                        className="cursor-pointer"
                        aria-label={`${row.label} — ${channelLabel}`}
                        checked={state.cells[cell.key]}
                        onCheckedChange={(checked) => toggle(cell, checked)}
                        // ⚠️ PROTOTYPE — DISPOSABLE: B and C both make the
                        // switch genuinely inert rather than only looking it.
                        // An offer that still saves is the defect being ruled
                        // on, so a variant that merely greyed it would not be a
                        // candidate. B points the switch at its own reason; C
                        // carries the token in the row's accessible name.
                        disabled={inert}
                        aria-describedby={
                          inert && variant === "b" ? noteId : undefined
                        }
                      />
                      <Label
                        htmlFor={controlId}
                        className={cn(
                          "text-muted-foreground text-sm sm:hidden",
                          inert ? "cursor-default" : "cursor-pointer"
                        )}
                      >
                        {channelLabel}
                      </Label>
                    </div>
                  );
                })}
              </div>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
