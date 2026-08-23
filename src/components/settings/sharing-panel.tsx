"use client";

import { useOptimistic, useTransition } from "react";
import { toast } from "sonner";

import { setSharingToggleAction } from "@/app/(dashboard)/settings/actions";
import { SettingsBlock } from "@/components/settings/settings-block";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import type { PrivacyFeatureKey } from "@/lib/auth/access";

// ============================================================================
// The sharing panel's switches (CS-010/011/012).
//
// PRESENTATION ONLY — the server hands down the copy (from
// `@/lib/sharing/toggles` and `OVERSIGHT_SHARING_TOGGLE`, each of which sits
// beside the gate it describes) and the stored value. Nothing here decides what
// sharing means, what it is called, or who may change it.
//
// State is `useOptimistic` over the prop, per memory/contracts/data-patterns.md:
// the switch moves under the finger and the action reconciles. A failed write
// surfaces as a toast and the optimistic value falls back to server truth on its
// own, so a save that did not happen never looks like one that did — which for a
// CONSENT control is the difference between a bug and a broken promise.
//
// NO CONFIRMATION DIALOG, ruled: a toggle applies immediately. A planter closing
// something has decided; asking again reads as the product lobbying against the
// decision, and a consent control that argues with its owner is not one.
// ============================================================================

export interface SharingSwitchProps {
  feature: PrivacyFeatureKey;
  enabled: boolean;
  label: string;
  summary: string;
  /** The push toggle's long explanation. Absent on the six pull rows. */
  detail?: readonly string[];
}

export function SharingSwitch({
  feature,
  enabled,
  label,
  summary,
  detail,
}: SharingSwitchProps) {
  const [, startTransition] = useTransition();
  const [optimistic, setOptimistic] = useOptimistic(enabled);

  // The ids are derived from the feature key, so two rows on one panel cannot
  // collide on a hardcoded id and hand a label the wrong switch.
  const switchId = `sharing-${feature}`;
  const summaryId = `${switchId}-summary`;
  const detailId = `${switchId}-detail`;

  const change = (next: boolean) => {
    startTransition(async () => {
      setOptimistic(next);

      const result = await setSharingToggleAction({ feature, enabled: next });
      if (!result.success) {
        // NAMED, because there are seven of these on one screen and the one
        // that snapped back can be scrolled out of view by the time the toast
        // appears. "We could not save that setting" was unambiguous on the
        // deleted single-switch page and is not here.
        toast.error(`${label}: ${result.error}`);
      }
    });
  };

  return (
    <SettingsBlock>
      {/* ONE ROW AT EVERY WIDTH. Stacked, the switch lands under the summary
          and bottom-left, so seven blocks give the eye a control to re-find on
          every row instead of a column of them down one edge. */}
      <div className="flex items-start justify-between gap-4 sm:gap-6">
        <div className="min-w-0 flex-1 space-y-1">
          {/* `leading-snug` overrides the Label primitive's `leading-none`,
              which assumes one line. The longest of these labels is 49
              characters and wraps on a phone, and two lines at line-height 1
              touch. */}
          <Label
            htmlFor={switchId}
            className="cursor-pointer text-sm leading-snug font-medium"
          >
            {label}
          </Label>
          <p
            id={summaryId}
            data-testid={`${switchId}-summary`}
            className="text-muted-foreground text-sm text-pretty"
          >
            {summary}
          </p>
        </div>

        {/* Described by the SUMMARY alone. The push row's `detail` is six
            sentences directly below the switch and in normal reading order
            already; folding it into the accessible description reads ~150 words
            on every focus and on every state change. */}
        <Switch
          id={switchId}
          data-testid={switchId}
          className="mt-0.5 shrink-0 cursor-pointer"
          checked={optimistic}
          aria-describedby={summaryId}
          onCheckedChange={change}
        />
      </div>

      {/* A RULE INSIDE THE BLOCK, not a second compartment. The list used to
          sit in its own full-bleed panel below the row, which read as two
          stacked surfaces for one switch; the block's padding now holds both
          and the hairline only separates them. */}
      {detail ? (
        <ul
          id={detailId}
          data-testid={`${switchId}-detail`}
          className="text-muted-foreground list-disc space-y-1.5 border-t ps-4 pt-3 text-sm"
        >
          {detail.map((line) => (
            <li key={line} className="text-pretty">
              {line}
            </li>
          ))}
        </ul>
      ) : null}
    </SettingsBlock>
  );
}
