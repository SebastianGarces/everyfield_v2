"use client";

import { useOptimistic, useTransition } from "react";
import { toast } from "sonner";

import { setChurchDigestScheduleAction } from "@/app/(dashboard)/settings/actions";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  DIGEST_SEND_WEEKDAYS,
  digestSendHourLabel,
} from "@/lib/notifications/digest-content";

// ============================================================================
// WHEN the planter digest lands (N-013, #448).
//
// Presentation only. The day names and the hour labels come from
// `digest-content.ts`, beside the arithmetic that means them, so a control
// cannot offer a Sunday the period calculation reads as a Monday.
//
// ONE ACTION, TWO SELECTS, and that is the point rather than an accident: the
// day and the hour are a single wall-clock decision, and a planter who moves
// their digest from Sunday afternoon to Wednesday morning is making one change.
// Writing them separately would let a save land halfway and put the digest at
// Wednesday 4 PM for one tick — a send time nobody chose.
//
// State is `useOptimistic` over the props, per
// memory/contracts/data-patterns.md: both selects move under the finger and the
// action reconciles. A failed write surfaces as a toast and the optimistic
// value falls back to server truth on its own.
// ============================================================================

export interface ChurchDigestScheduleSelectProps {
  weekday: number;
  hour: number;
  /** The church's zone, named in the help text so "4:00 PM" is unambiguous. */
  timeZone: string;
}

const HOURS = Array.from({ length: 24 }, (_, hour) => hour);

export function ChurchDigestScheduleSelect({
  weekday,
  hour,
  timeZone,
}: ChurchDigestScheduleSelectProps) {
  const [, startTransition] = useTransition();
  const [optimistic, setOptimistic] = useOptimistic({ weekday, hour });

  const change = (next: { weekday: number; hour: number }) => {
    if (next.weekday === optimistic.weekday && next.hour === optimistic.hour) {
      return;
    }

    startTransition(async () => {
      setOptimistic(next);

      const result = await setChurchDigestScheduleAction(next);
      if (!result.success) {
        toast.error(result.error);
      }
    });
  };

  return (
    <div className="space-y-3">
      <div className="space-y-1">
        {/* A GROUP HEADING, not a label — it names the pair of selects, and the
            two `<Label>`s below name one control each. Pointing it at
            `digest-send-hour` as well made the hour's accessible name the
            concatenation "When the digest arrives At", because name
            computation joins every label associated with a control. */}
        <h3 id="digest-send-heading" className="text-sm font-medium">
          When the digest arrives
        </h3>
        <p
          id="digest-send-help"
          className="text-muted-foreground text-sm text-pretty"
        >
          Everyone on this plant who has the digest turned on gets it at this
          time, in {timeZone.replaceAll("_", " ")}. The day applies to weekly
          digests; a daily digest arrives at this hour every day. Each person
          still chooses whether they get one, and how often.
        </p>
      </div>

      <div
        role="group"
        aria-labelledby="digest-send-heading"
        className="flex flex-wrap gap-3"
      >
        <div className="min-w-40 flex-1 space-y-1.5">
          <Label
            htmlFor="digest-send-weekday"
            className="text-muted-foreground cursor-pointer text-xs font-normal"
          >
            Weekly digests land on
          </Label>
          <Select
            value={String(optimistic.weekday)}
            onValueChange={(value) =>
              change({ weekday: Number(value), hour: optimistic.hour })
            }
          >
            <SelectTrigger
              id="digest-send-weekday"
              data-testid="digest-send-weekday-select"
              aria-describedby="digest-send-help"
              className="w-full cursor-pointer"
            >
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {DIGEST_SEND_WEEKDAYS.map((day, index) => (
                <SelectItem
                  key={day}
                  value={String(index)}
                  className="cursor-pointer"
                >
                  {day}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        <div className="min-w-40 flex-1 space-y-1.5">
          <Label
            htmlFor="digest-send-hour"
            className="text-muted-foreground cursor-pointer text-xs font-normal"
          >
            At
          </Label>
          <Select
            value={String(optimistic.hour)}
            onValueChange={(value) =>
              change({ weekday: optimistic.weekday, hour: Number(value) })
            }
          >
            <SelectTrigger
              id="digest-send-hour"
              data-testid="digest-send-hour-select"
              aria-describedby="digest-send-help"
              className="w-full cursor-pointer"
            >
              <SelectValue />
            </SelectTrigger>
            <SelectContent className="max-h-80">
              {HOURS.map((value) => (
                <SelectItem
                  key={value}
                  value={String(value)}
                  className="cursor-pointer"
                >
                  {digestSendHourLabel(value)}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </div>
    </div>
  );
}
