"use client";

import { useMemo, useOptimistic, useTransition } from "react";
import { toast } from "sonner";

import {
  setDigestCadenceAction,
  setNotificationPreferenceAction,
} from "@/app/(dashboard)/settings/actions";
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
// State: `useOptimistic` over the props, per memory/contracts/data-patterns.md.
// The switch moves the instant it is pressed, the action reconciles, and its
// `refresh()` re-renders this tree — including the layout's unread bell, which
// an `in_app` change moves too (N-005 is applied at read time). Server data is
// never copied into `useState`; the optimistic baseline is recomputed from
// `view` on every render.
//
// A failed write surfaces as a toast and the optimistic value falls back to
// server truth on its own — the control visibly returns to where it was, so a
// save that did not happen never looks like one that did.
// ============================================================================

export interface PreferenceMatrixProps {
  view: PreferenceMatrixView;
}

interface MatrixState {
  /** Keyed by `"category:channel"`. */
  cells: Record<string, boolean>;
  cadence: DigestCadence;
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

  const serverState = useMemo<MatrixState>(
    () => ({
      cells: Object.fromEntries(
        view.categories.flatMap((row) =>
          row.cells.map((cell) => [cell.key, cell.enabled] as const)
        )
      ),
      cadence: view.digest.cadence,
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
    (row) => row.category === view.digest.category
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
        {view.categories.map((row) => (
          <li
            key={row.category}
            data-testid={`preference-row-${row.category}`}
            className="flex flex-col gap-3 px-4 py-4 sm:flex-row sm:items-start sm:gap-6"
          >
            <div className="min-w-0 flex-1 space-y-1">
              <p
                id={`preference-category-${row.category}`}
                className="text-sm font-medium"
              >
                {row.label}
              </p>
              <p className="text-muted-foreground text-sm text-pretty">
                {row.description}
              </p>

              {row.category === view.digest.category && (
                <div className="pt-3">
                  <Label
                    htmlFor="digest-cadence"
                    className="text-muted-foreground text-xs font-medium"
                  >
                    {view.digest.label}
                  </Label>
                  <Select
                    value={state.cadence}
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
                      {view.digest.options.map((option) => (
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
                  <p
                    id="digest-cadence-description"
                    data-testid="digest-cadence-description"
                    className="text-muted-foreground mt-1.5 text-xs text-pretty"
                  >
                    {view.digest.description}
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
                    />
                    <Label
                      htmlFor={controlId}
                      className="text-muted-foreground cursor-pointer text-sm sm:hidden"
                    >
                      {channelLabel}
                    </Label>
                  </div>
                );
              })}
            </div>
          </li>
        ))}
      </ul>
    </div>
  );
}
