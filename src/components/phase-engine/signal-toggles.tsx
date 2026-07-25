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

import { useState, useTransition } from "react";
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

/** A single self-attestation the planter can toggle. */
interface SignalDefinition {
  key: string;
  label: string;
  description: string;
}

/**
 * The curated self-attestations surfaced in the UI. These mirror the
 * manual-attestation signals the rubric references (values documented,
 * financial base, systems tested) — facts the system cannot observe.
 */
const SIGNAL_DEFINITIONS: SignalDefinition[] = [
  {
    key: "values_documented",
    label: "Core values documented",
    description: "Your plant's vision and values are written down and shared.",
  },
  {
    key: "financial_base_established",
    label: "Financial base in place",
    description: "Initial funding and a giving plan are established.",
  },
  {
    key: "prayer_leader_assigned",
    label: "Prayer leader assigned",
    description: "Someone owns the prayer covering for the plant.",
  },
  {
    key: "systems_tested",
    label: "Launch systems tested",
    description: "Check-in, giving, and gathering logistics have a dry run.",
  },
];

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
        {SIGNAL_DEFINITIONS.map((signal) => (
          <SignalToggle
            key={signal.key}
            signal={signal}
            initialChecked={initialValues[signal.key] ?? false}
          />
        ))}
      </CardContent>
    </Card>
  );
}

function SignalToggle({
  signal,
  initialChecked,
}: {
  signal: SignalDefinition;
  initialChecked: boolean;
}) {
  const [checked, setChecked] = useState(initialChecked);
  const [isPending, startTransition] = useTransition();

  function handleChange(next: boolean) {
    const previous = checked;
    // Optimistic flip.
    setChecked(next);

    startTransition(async () => {
      const result = await setManualSignalAction({
        signalKey: signal.key,
        value: next,
      });

      if (!result.success) {
        setChecked(previous);
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
