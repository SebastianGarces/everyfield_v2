"use client";

import { useMemo, useOptimistic, useTransition } from "react";
import { toast } from "sonner";

import {
  setDigestCadenceAction,
  setNotificationPreferenceAction,
} from "@/app/(dashboard)/settings/actions";
import { SettingsBlock } from "@/components/settings/settings-block";
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
// delivery allow-list) is not a control they can usefully be offered.
//
// Ruled 2026-08-09, after three presentations were built and operated on the
// preview: the rows STAY, each carrying a token and an inert pair of switches.
// Hiding them was refused — a screen that silently differs by role tells the
// reader nothing and cannot be supported — and so was greying them, which
// answers "why can't I click this?" without answering "then what do I get?".
// So the row keeps its full weight, says it is not sent, and the group says
// once what arrives instead.
//
// The token is short and the reason is a sentence, because they answer
// different questions and only one of them bears repeating five times.
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

  // The reason is a property of the GROUP, not of each row: it is the same
  // sentence for all five, so it is said ONCE — on the first row that carries
  // it — and every inert switch points its `aria-describedby` at that one
  // sentence. Five copies of it would read as a refusal notice rather than as a
  // settings screen. Which row is first is derived, never assumed: nothing here
  // depends on the ineligible rows being contiguous or on which ones they are.
  const firstIneligible =
    view.categories.find((row) => !row.eligible)?.category ?? null;
  const ineligibleNoteId = "preference-ineligible-note";

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

  const ineligibleCategories = useMemo(
    () =>
      new Set(
        view.categories
          .filter((row) => !row.eligible)
          .map((row) => row.category)
      ),
    [view]
  );

  const toggle = (cell: PreferenceCellView, enabled: boolean) => {
    // The switch is already `disabled`, so this is the second of two locks —
    // and the third is `setNotificationPreferenceAction`, which refuses the
    // same category server-side. The one that matters is the server's; this one
    // exists so that a control the user cannot reach also cannot be reached by
    // a stray programmatic `onCheckedChange`, and so the optimistic value never
    // moves for a save that is going to be refused.
    if (ineligibleCategories.has(cell.category)) return;

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
    <SettingsBlock>
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
        className="text-muted-foreground hidden items-center gap-6 border-b pb-2 text-xs font-medium sm:flex"
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
          const ineligible = !row.eligible;

          return (
            <li
              key={row.category}
              data-testid={`preference-row-${row.category}`}
              data-eligible={row.eligible}
              className="flex flex-col gap-3 py-4 first:pt-0 last:pb-0 sm:flex-row sm:items-start sm:gap-6"
            >
              <div className="min-w-0 flex-1 space-y-1">
                <p
                  id={`preference-category-${row.category}`}
                  className="flex flex-wrap items-center gap-x-2 gap-y-1 text-sm font-medium"
                >
                  {row.label}
                  {/* The token states the FACT and nothing else, in four short
                      words the eye takes in beside the category name. The
                      reason is a sentence and lives below, once; a token
                      carrying both would be a paragraph in a badge, five times
                      over. `title` repeats the reason for a reader who lands on
                      a later row — never as the ONLY place it is said, which is
                      why the sentence is on the screen as well.

                      This element is inside the `<p>` the switch group is
                      labelled by, so the group's accessible name is "Tasks Not
                      sent to you" — the token is announced with the row rather
                      than being a visual-only fact. */}
                  {ineligible && (
                    <Badge
                      variant="secondary"
                      data-testid={`preference-ineligible-badge-${row.category}`}
                      title={view.ineligibleNote ?? undefined}
                      className="font-normal"
                    >
                      Not sent to you
                    </Badge>
                  )}
                </p>
                <p className="text-muted-foreground text-sm text-pretty">
                  {row.description}
                </p>

                {/* The reason, said once for the group it covers. It is the
                    SERVER's sentence (`view.ineligibleNote`), which is also the
                    sentence `setNotificationPreferenceAction` refuses with, so
                    the screen and the endpoint cannot drift apart. */}
                {ineligible &&
                  row.category === firstIneligible &&
                  view.ineligibleNote && (
                    <p
                      id={ineligibleNoteId}
                      data-testid="preference-ineligible-note"
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
                        // An ineligible row reads OFF, whatever resolution says
                        // its coded default is. The switch answers "will this
                        // reach me?", and for these five categories the answer
                        // is no however the preference resolves — `enqueue`
                        // refuses them before a preference is ever consulted.
                        // Showing the resolved `true` beside "Not sent to you"
                        // would restate the contradiction this ruling closes:
                        // a control that looks on for something never sent.
                        //
                        // It is a rendering, not a write. No row is created, no
                        // stored value changes, and `data-source` still carries
                        // what resolution actually returned.
                        checked={ineligible ? false : state.cells[cell.key]}
                        onCheckedChange={(checked) => toggle(cell, checked)}
                        // Genuinely inert, not merely greyed: a switch that
                        // still saved would be the defect this ruling closes,
                        // one row up from the cadence control #254 retired.
                        // `disabled` also swaps the cursor to `not-allowed`
                        // through the Switch's own base classes, which is the
                        // one place `cursor-pointer` should NOT win.
                        disabled={ineligible}
                        // Points at the group's one sentence, so a screen
                        // reader on any of the ten inert switches is told what
                        // arrives instead — not just that this one is off.
                        aria-describedby={
                          ineligible ? ineligibleNoteId : undefined
                        }
                      />
                      <Label
                        htmlFor={controlId}
                        className={cn(
                          "text-muted-foreground text-sm sm:hidden",
                          ineligible ? "cursor-default" : "cursor-pointer"
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
    </SettingsBlock>
  );
}
