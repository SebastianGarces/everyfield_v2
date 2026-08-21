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

import { RotateCcw } from "lucide-react";
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
// The window lives here too, for the same reason the labels do: this module is
// import-free, so the card and the fact snapshot read one number without the
// card dragging the DB client into a browser chunk.
import {
  ATTESTATION_REAFFIRM_WINDOW_DAYS,
  MANUAL_SIGNALS,
  type ManualSignal,
} from "@/lib/phase-engine/manual-signals";

interface SignalTogglesProps {
  /** Current attested boolean values keyed by signal key (server-provided). */
  initialValues?: Record<string, boolean>;
  /**
   * Whole days since each signal was last answered, keyed by signal key
   * (#474 D2). Absent means never answered, which is not stale — it is
   * unanswered, and the switch already says so by being off.
   */
  attestedDaysAgo?: Record<string, number>;
  /** How long an answer stays fresh. Server-provided so one number rules. */
  reaffirmWindowDays?: number;
}

export function SignalToggles({
  initialValues = {},
  attestedDaysAgo = {},
  reaffirmWindowDays = ATTESTATION_REAFFIRM_WINDOW_DAYS,
}: SignalTogglesProps) {
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
            daysAgo={attestedDaysAgo[signal.key] ?? null}
            reaffirmWindowDays={reaffirmWindowDays}
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
  daysAgo,
  reaffirmWindowDays,
}: {
  signal: ManualSignal;
  attested: boolean;
  daysAgo: number | null;
  reaffirmWindowDays: number;
}) {
  const [isPending, startTransition] = useTransition();
  const [checked, setOptimisticChecked] = useOptimistic(attested);

  // THE REAFFIRM CHIP (#474 D2), and the three conditions it needs.
  //
  // The signal has to be one that PERISHES (`signal.reaffirms`, declared in the
  // vocabulary — this card may not know which keys those are); it has to be
  // ON, because an unanswered attestation is unanswered rather than stale; and
  // it has to be older than the window. A rhythm attested four months ago is
  // not evidence that the plant prays now, which is exactly Bryan's second
  // prayer question.
  const isStale =
    signal.reaffirms &&
    checked &&
    daysAgo !== null &&
    daysAgo >= reaffirmWindowDays;

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

  /**
   * Re-write the SAME value. `upsertManualSignal` stamps `attested_at` on every
   * write, so the row's value does not move and its age goes to zero — which is
   * the whole operation. Idempotent by construction: pressing it twice writes
   * the same true twice.
   */
  function handleReaffirm() {
    startTransition(async () => {
      const result = await setManualSignalAction({
        signalKey: signal.key,
        value: true,
      });

      if (!result.success) {
        toast.error(result.error);
        return;
      }

      toast.success("Confirmed — thanks");
    });
  }

  return (
    <div className="flex items-start justify-between gap-4">
      <div className="space-y-0.5">
        <Label htmlFor={`signal-${signal.key}`} className="cursor-pointer">
          {signal.label}
        </Label>
        <p className="text-muted-foreground text-xs">{signal.description}</p>
        {isStale && (
          <p className="text-muted-foreground flex flex-wrap items-center gap-2 pt-1 text-xs">
            <span>Confirmed {daysAgo} days ago.</span>
            <button
              type="button"
              onClick={handleReaffirm}
              disabled={isPending}
              className="border-border hover:bg-muted inline-flex cursor-pointer items-center gap-1 rounded-full border px-2 py-0.5 font-medium transition-colors disabled:opacity-50"
            >
              <RotateCcw className="h-3 w-3" />
              Still true
            </button>
          </p>
        )}
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
