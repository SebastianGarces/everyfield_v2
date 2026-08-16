"use client";

import { useOptimistic, useTransition } from "react";
import { toast } from "sonner";

import { setChurchTimeZoneAction } from "@/app/(dashboard)/settings/actions";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectLabel,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { groupedTimeZones } from "@/lib/datetime";

// ============================================================================
// The church timezone control.
//
// Presentation only — the server hands down the stored IANA id. The list
// of zones is `Intl.supportedValuesOf("timeZone")` via `groupedTimeZones`
// in datetime.ts; this component never decides what a valid zone is.
//
// State is `useOptimistic` over the prop, per
// memory/contracts/data-patterns.md: the select moves under the finger and
// the action reconciles. A failed write surfaces as a toast and the
// optimistic value falls back to server truth on its own.
// ============================================================================

export interface ChurchTimeZoneSelectProps {
  timeZone: string;
}

export function ChurchTimeZoneSelect({ timeZone }: ChurchTimeZoneSelectProps) {
  const [, startTransition] = useTransition();
  const [optimistic, setOptimistic] = useOptimistic(timeZone);
  const groups = groupedTimeZones();

  const change = (next: string) => {
    if (next === optimistic) return;

    startTransition(async () => {
      setOptimistic(next);

      const result = await setChurchTimeZoneAction(next);
      if (!result.success) {
        toast.error(result.error);
      }
    });
  };

  return (
    <div className="bg-card space-y-3 rounded-lg border px-4 py-4">
      <div className="space-y-1">
        <Label htmlFor="church-time-zone" className="cursor-pointer">
          Timezone
        </Label>
        <p
          id="church-time-zone-help"
          className="text-muted-foreground text-sm text-pretty"
        >
          Dates and times for this plant — relative-day labels on meetings,
          training and membership dates, and when a message was sent — follow
          this timezone.
        </p>
      </div>

      <Select value={optimistic} onValueChange={change}>
        <SelectTrigger
          id="church-time-zone"
          data-testid="church-time-zone-select"
          aria-describedby="church-time-zone-help"
          className="w-full max-w-md cursor-pointer"
        >
          <SelectValue />
        </SelectTrigger>
        <SelectContent className="max-h-80">
          {groups.map((group) => (
            <SelectGroup key={group.region}>
              <SelectLabel>{group.region}</SelectLabel>
              {group.zones.map((zone) => (
                <SelectItem
                  key={zone.id}
                  value={zone.id}
                  className="cursor-pointer"
                >
                  {zone.label}
                </SelectItem>
              ))}
            </SelectGroup>
          ))}
        </SelectContent>
      </Select>
    </div>
  );
}
