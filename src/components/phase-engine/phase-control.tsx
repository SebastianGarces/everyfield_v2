"use client";

// ============================================================================
// PhaseControl — current phase + readiness + soft-gated transition (PE-001/015).
//
// Client component. Shows the plant's current phase and the advisory readiness
// state (ready | approaching | not_ready | unknown), then lets the planter
// advance, regress (correct), or jump to any phase with a REQUIRED reason. The
// transition is soft-gated: never blocked on readiness (PE-001). Confirmation is
// a soft AlertDialog summarizing the move + collecting the reason; submission
// calls the EXISTING transition action
// (src/app/(dashboard)/phase/actions.ts → transitionPhaseAction).
// ============================================================================

import { Loader2 } from "lucide-react";
import { useState, useTransition } from "react";
import { toast } from "sonner";

import { transitionPhaseAction } from "@/app/(dashboard)/phase/actions";
import {
  readinessMeta,
  transitionDirectionLabel,
} from "@/components/phase-engine/focus-presentation";
import {
  AlertDialog,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { PHASES } from "@/lib/constants";
import type { PhaseReadiness } from "@/lib/phase-engine/transitions";

const MIN_PHASE = 0;
const MAX_PHASE = 6;

function phaseLabel(phase: number): string {
  return PHASES[phase as keyof typeof PHASES] ?? `Phase ${phase}`;
}

interface PhaseControlProps {
  churchId: string;
  currentPhase: number;
  readiness: PhaseReadiness;
}

export function PhaseControl({
  churchId,
  currentPhase,
  readiness,
}: PhaseControlProps) {
  const [targetPhase, setTargetPhase] = useState<number>(currentPhase);
  const [reason, setReason] = useState("");
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [isPending, startTransition] = useTransition();

  const meta = readinessMeta(readiness.state);
  const isNoop = targetPhase === currentPhase;

  function openConfirm() {
    if (isNoop) return;
    setConfirmOpen(true);
  }

  function handleConfirm() {
    if (!reason.trim()) {
      toast.error("A reason is required to change the phase");
      return;
    }

    startTransition(async () => {
      const result = await transitionPhaseAction({
        churchId,
        toPhase: targetPhase,
        reason: reason.trim(),
      });

      if (!result.success) {
        toast.error(result.error);
        return;
      }

      toast.success(`Phase updated to ${phaseLabel(result.data.toPhase)}`);
      setConfirmOpen(false);
      setReason("");
    });
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Phase control</CardTitle>
        <CardDescription>
          You decide when to move phases. Readiness below is advisory — it never
          blocks a change.
        </CardDescription>
      </CardHeader>

      <CardContent className="space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div>
            <p className="text-muted-foreground text-xs tracking-wide uppercase">
              Current phase
            </p>
            <p className="text-sm font-semibold">{phaseLabel(currentPhase)}</p>
          </div>
          <Badge variant={meta.badgeVariant}>{meta.label}</Badge>
        </div>

        {readiness.headline && (
          <div className="bg-muted/50 rounded-md border p-3">
            <p className="text-sm font-medium">{readiness.headline}</p>
            {readiness.detail && (
              <p className="text-muted-foreground mt-1 text-sm">
                {readiness.detail}
              </p>
            )}
          </div>
        )}

        <div className="space-y-2">
          <Label htmlFor="phase-target">Change phase to</Label>
          <div className="flex flex-wrap items-center gap-2">
            <Select
              value={String(targetPhase)}
              onValueChange={(value) => setTargetPhase(Number(value))}
            >
              <SelectTrigger
                id="phase-target"
                className="w-full cursor-pointer sm:w-72"
              >
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {Array.from(
                  { length: MAX_PHASE - MIN_PHASE + 1 },
                  (_, index) => MIN_PHASE + index
                ).map((phase) => (
                  <SelectItem
                    key={phase}
                    value={String(phase)}
                    className="cursor-pointer"
                  >
                    {phaseLabel(phase)}
                    {phase === currentPhase ? " (current)" : ""}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>

            <Button
              type="button"
              className="cursor-pointer"
              disabled={isNoop || isPending}
              onClick={openConfirm}
            >
              {targetPhase > currentPhase ? "Advance" : "Change phase"}
            </Button>
          </div>
          {isNoop && (
            <p className="text-muted-foreground text-xs">
              Select a different phase to change.
            </p>
          )}
        </div>
      </CardContent>

      <AlertDialog open={confirmOpen} onOpenChange={setConfirmOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Confirm phase change</AlertDialogTitle>
            <AlertDialogDescription>
              You&apos;re about to{" "}
              {transitionDirectionLabel(currentPhase, targetPhase)}{" "}
              <span className="font-medium">{phaseLabel(targetPhase)}</span>.
              Add a short reason — it&apos;s recorded with the change.
            </AlertDialogDescription>
          </AlertDialogHeader>

          <div className="space-y-2">
            <Label htmlFor="phase-reason">Reason</Label>
            <Textarea
              id="phase-reason"
              value={reason}
              onChange={(event) => setReason(event.target.value)}
              placeholder="Why are you making this change?"
              rows={3}
              maxLength={2000}
              disabled={isPending}
              className="resize-none"
            />
          </div>

          <AlertDialogFooter>
            <AlertDialogCancel className="cursor-pointer" disabled={isPending}>
              Cancel
            </AlertDialogCancel>
            <Button
              type="button"
              className="cursor-pointer"
              disabled={isPending || !reason.trim()}
              onClick={handleConfirm}
            >
              {isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              Confirm change
            </Button>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </Card>
  );
}
