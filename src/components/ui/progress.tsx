"use client";

import * as React from "react";
import * as ProgressPrimitive from "@radix-ui/react-progress";

import { cn } from "@/lib/utils";

/** Radix's own fallback when `max` is absent or invalid. */
const DEFAULT_MAX = 100;

/**
 * Radix decides `data-state`, `aria-valuenow` and `aria-valuetext` from the
 * `value`/`max` it receives. These two predicates mirror
 * `isValidMaxNumber`/`isValidValueNumber` inside `@radix-ui/react-progress` so
 * the indicator's fill can never disagree with the state the root reports: if
 * Radix treats the bar as indeterminate, the indicator renders empty rather
 * than claiming a percentage no assistive technology was told about.
 */
function isValidMax(max: number | undefined): max is number {
  return typeof max === "number" && !Number.isNaN(max) && max > 0;
}

function isValidValue(
  value: number | null | undefined,
  max: number
): value is number {
  return (
    typeof value === "number" &&
    !Number.isNaN(value) &&
    value >= 0 &&
    value <= max
  );
}

function Progress({
  className,
  value,
  max,
  ...props
}: React.ComponentProps<typeof ProgressPrimitive.Root>) {
  const resolvedMax = isValidMax(max) ? max : DEFAULT_MAX;
  // `null` means indeterminate — no fill, and no aria-valuenow from Radix.
  const percentage = isValidValue(value, resolvedMax)
    ? (value / resolvedMax) * 100
    : null;

  return (
    <ProgressPrimitive.Root
      data-slot="progress"
      // Forwarding these is what gives the root `aria-valuenow` and a real
      // `data-state` (loading/complete) instead of a permanent
      // `indeterminate`. They are destructured above, so the spread below
      // cannot supply them.
      value={value}
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
