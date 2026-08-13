"use client";

// ============================================================================
// SignalToggles — manual self-attestations the system cannot observe (PE-005).
//
// Client component. Renders a curated set of boolean self-attestations (values
// documented, financial base in place, systems tested, …) the planter toggles.
// Each toggle wires to the EXISTING attestation action
// (src/app/(dashboard)/phase/signals-actions.ts → setManualSignalAction), which
// upserts plant_signals and marks the plant dirty so the attestation feeds the
// next assessment. Optimistic: the switch flips immediately and reverts on
// server failure.
// ============================================================================

import { useOptimistic, useTransition } from "react";
import { toast } from "sonner";

import { setManualSignalAction } from "@/app/(dashboard)/phase/signals-actions";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
// The ONE declaration of the manual-signal vocabulary. This card used to hold a
// second copy of the keys, which is how a toggle and its phase gate drift apart
// with nothing failing.
import {
  MANUAL_SIGNALS,
  type ManualSignal,
} from "@/lib/phase-engine/manual-signals";

interface SignalTogglesProps {
  /** Current attested boolean values keyed by signal key (server-provided). */
  initialValues?: Record<string, boolean>;
}

export function SignalToggles({ initialValues = {} }: SignalTogglesProps) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>Self-attestation</CardTitle>
        <CardDescription>
          Confirm the things the system can&apos;t see. Your answers feed the
          next assessment.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {MANUAL_SIGNALS.map((signal) => (
          <SignalToggle
            key={signal.key}
            signal={signal}
            attested={initialValues[signal.key] ?? false}
          />
        ))}
      </CardContent>
    </Card>
  );
}

/**
 * ONE switch, whose state is `useOptimistic` OVER THE SERVER PROP — never
 * `useState` seeded from it (memory/invariants.md → Client/Server Data
 * Synchronization; the reference shape is
 * `components/settings/oversight-sharing-switch.tsx`).
 *
 * The old `useState(initialChecked)` was server data in local state, and it went
 * stale in the way that state always does: `setManualSignalAction` calls
 * `revalidatePath("/phase")`, so a second tab, a re-run assessment, or the
 * planter's own reload re-rendered this card with a NEW `initialValues` that the
 * mounted `useState` ignored. It also carried a hand-rolled rollback — remember
 * the previous value, put it back on failure — which `useOptimistic` gets for
 * free by falling back to server truth when the transition settles.
 */
function SignalToggle({
  signal,
  attested,
}: {
  signal: ManualSignal;
  attested: boolean;
}) {
  const [isPending, startTransition] = useTransition();
  const [checked, setOptimisticChecked] = useOptimistic(attested);

  function handleChange(next: boolean) {
    startTransition(async () => {
      setOptimisticChecked(next);

      const result = await setManualSignalAction({
        signalKey: signal.key,
        value: next,
      });

      if (!result.success) {
        // No rollback to write: the optimistic value reverts to `attested` when
        // this transition settles, and the server never changed.
        toast.error(result.error);
        return;
      }

      toast.success(next ? "Marked complete" : "Marked incomplete");
    });
  }

  return (
    <div className="flex items-start justify-between gap-4">
      <div className="space-y-0.5">
        <Label htmlFor={`signal-${signal.key}`} className="cursor-pointer">
          {signal.label}
        </Label>
        <p className="text-muted-foreground text-xs">{signal.description}</p>
      </div>
      <Switch
        id={`signal-${signal.key}`}
        className="cursor-pointer"
        checked={checked}
        disabled={isPending}
        onCheckedChange={handleChange}
        aria-label={signal.label}
      />
    </div>
  );
}
