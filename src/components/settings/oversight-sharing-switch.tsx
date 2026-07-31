"use client";

import { useOptimistic, useTransition } from "react";
import { toast } from "sonner";

import { setOversightSharingAction } from "@/app/(dashboard)/settings/sharing/actions";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";

// ============================================================================
// The single sharing toggle (N-026).
//
// Presentation only — the server hands down the copy (from
// `OVERSIGHT_SHARING_TOGGLE` in `src/lib/notifications/categories.ts`, the same
// constant the gate lives next to) and the stored value. This component never
// decides what sharing means or what it is called.
//
// State is `useOptimistic` over the prop, per
// memory/contracts/data-patterns.md: the switch moves under the finger and the
// action reconciles. A failed write surfaces as a toast and the optimistic
// value falls back to server truth on its own, so a save that did not happen
// never looks like one that did — which for a CONSENT control is the difference
// between a bug and a broken promise.
// ============================================================================

export interface OversightSharingSwitchProps {
  enabled: boolean;
  label: string;
  summary: string;
  detail: readonly string[];
}

export function OversightSharingSwitch({
  enabled,
  label,
  summary,
  detail,
}: OversightSharingSwitchProps) {
  const [, startTransition] = useTransition();
  const [optimistic, setOptimistic] = useOptimistic(enabled);

  const change = (next: boolean) => {
    startTransition(async () => {
      setOptimistic(next);

      const result = await setOversightSharingAction(next);
      if (!result.success) {
        toast.error(result.error);
      }
    });
  };

  return (
    <div className="bg-card rounded-lg border">
      <div className="flex flex-col gap-4 px-4 py-4 sm:flex-row sm:items-start sm:gap-6">
        <div className="min-w-0 flex-1 space-y-1">
          <Label
            htmlFor="oversight-sharing"
            className="cursor-pointer text-sm font-medium"
          >
            {label}
          </Label>
          <p
            id="oversight-sharing-summary"
            data-testid="oversight-sharing-summary"
            className="text-muted-foreground text-sm text-pretty"
          >
            {summary}
          </p>
        </div>

        <Switch
          id="oversight-sharing"
          data-testid="oversight-sharing-switch"
          className="cursor-pointer"
          checked={optimistic}
          aria-describedby="oversight-sharing-summary oversight-sharing-detail"
          onCheckedChange={change}
        />
      </div>

      <ul
        id="oversight-sharing-detail"
        data-testid="oversight-sharing-detail"
        className="text-muted-foreground list-disc space-y-1.5 border-t px-4 py-4 pl-8 text-sm"
      >
        {detail.map((line) => (
          <li key={line} className="text-pretty">
            {line}
          </li>
        ))}
      </ul>
    </div>
  );
}
