"use client";

import * as React from "react";
import * as ProgressPrimitive from "@radix-ui/react-progress";

import { cn } from "@/lib/utils";

/** Radix's own fallback when `max` is absent or invalid. */
const DEFAULT_MAX = 100;

/**
 * Radix decides `data-state`, `aria-valuenow` and `aria-valuetext` from the
 * `value`/`max` it receives, and treats an out-of-range value as invalid:
 * indeterminate, plus a console.error. Ruling on #149 (PR #174): out-of-range
 * values clamp instead — 105% renders a full bar announcing 100, a negative
 * value renders empty announcing 0 — because an empty, unannounced bar reads
 * as the opposite of the truth. Only a non-numeric value is indeterminate.
 * The clamped value is what gets forwarded, so the indicator's fill can never
 * disagree with the state the root reports.
 */
function isValidMax(max: number | undefined): max is number {
  return typeof max === "number" && !Number.isNaN(max) && max > 0;
}

function toClampedValue(
  value: number | null | undefined,
  max: number
): number | null {
  if (typeof value !== "number" || Number.isNaN(value)) return null;
  return Math.min(Math.max(value, 0), max);
}

function Progress({
  className,
  value,
  max,
  ...props
}: React.ComponentProps<typeof ProgressPrimitive.Root>) {
  const resolvedMax = isValidMax(max) ? max : DEFAULT_MAX;
  // `null` means indeterminate — no fill, and no aria-valuenow from Radix.
  const clampedValue = toClampedValue(value, resolvedMax);
  const percentage =
    clampedValue === null ? null : (clampedValue / resolvedMax) * 100;

  return (
    <ProgressPrimitive.Root
      data-slot="progress"
      // Forwarding these is what gives the root `aria-valuenow` and a real
      // `data-state` (loading/complete) instead of a permanent
      // `indeterminate`. They are destructured above, so the spread below
      // cannot supply them. The clamped value goes to Radix — the raw one
      // would trip its range check and force indeterminate.
      value={clampedValue}
      max={max}
      className={cn(
        "bg-primary/20 relative h-2 w-full overflow-hidden rounded-full",
        className
      )}
      {...props}
    >
      <ProgressPrimitive.Indicator
        data-slot="progress-indicator"
        className="bg-primary h-full w-full flex-1 transition-all"
        style={{ transform: `translateX(-${100 - (percentage ?? 0)}%)` }}
      />
    </ProgressPrimitive.Root>
  );
}

export { Progress };
