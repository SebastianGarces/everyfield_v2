"use client";

import { useRef } from "react";

import { setChurchInactivityThresholdsAction } from "@/app/(dashboard)/settings/actions";
import {
  commitOnEnter,
  FieldSaveStatus,
  useFieldSave,
} from "@/components/settings/field-save";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

// ============================================================================
// How long silence runs before it is worth saying so (CS-009, #618).
//
// ONE ACTION, TWO INPUTS — the shape `ChurchDigestScheduleSelect` argued for,
// for the same reason restated: `warning` must stay below `alert`, so the two
// counts are one decision and one write.
//
// ----------------------------------------------------------------------------
// AND THEREFORE ONE COMMIT POINT, WHICH IS THE GROUP'S AND NOT EACH INPUT'S
// ----------------------------------------------------------------------------
//
// One write to the database is not the same thing as one commit in the UI, and
// getting that wrong reintroduces the exact bug the single write exists to
// prevent. Wired to each input's own blur, a planter widening 7/14 to 30/60
// types `30`, presses Tab, and is refused — "the warning day count must be
// lower than the alert day count" — while still on their way to the second box,
// at a moment when neither number is wrong and only the half-finished pair is.
//
// So the commit hangs on the GROUP, and a blur whose `relatedTarget` is still
// inside the group is not a commit at all. Tabbing between the two counts sends
// nothing; leaving the pair sends one request.
//
// `relatedTarget` is null when focus leaves the document entirely (another
// window, the URL bar), and `contains(null)` is false — so that commits, which
// is right: the planter has finished with the pair either way.
//
// Uncontrolled inputs and no server data in state — see `./field-save.tsx`,
// which owns the save machine both church controls share.
// ============================================================================

export interface ChurchInactivityThresholdsProps {
  warningDays: number;
  alertDays: number;
}

export function ChurchInactivityThresholds({
  warningDays,
  alertDays,
}: ChurchInactivityThresholdsProps) {
  const warning = useRef<HTMLInputElement>(null);
  const alert = useRef<HTMLInputElement>(null);

  const typed = () => ({
    warningDays: Number(warning.current?.value),
    alertDays: Number(alert.current?.value),
  });

  const { state, commit } = useFieldSave({
    // NUMBERS, so "07" and "7" are the same answer and neither costs a write.
    isDirty: () => {
      const next = typed();
      return next.warningDays !== warningDays || next.alertDays !== alertDays;
    },
    save: () => setChurchInactivityThresholdsAction(typed()),
  });

  const invalid = state.status === "failed" ? state.invalid : [];

  return (
    <div className="bg-card space-y-3 rounded-lg border px-4 py-4">
      <div className="space-y-1">
        {/* A GROUP HEADING, not a label — the same rule the digest pair learned
            the hard way: pointing one label at both inputs concatenates into
            each control's accessible name. */}
        <h3 id="inactivity-heading" className="text-sm font-medium">
          When a contact has gone quiet
        </h3>
        <p
          id="inactivity-help"
          className="text-muted-foreground text-sm text-pretty"
        >
          A person with no recorded activity for this many days is flagged on
          your people list — first as a warning, then as an alert. The warning
          count has to be the smaller of the two.
        </p>
      </div>

      <div
        role="group"
        aria-labelledby="inactivity-heading"
        className="flex flex-wrap gap-3"
        onBlur={(event) => {
          if (event.currentTarget.contains(event.relatedTarget)) return;
          commit();
        }}
      >
        <DayCountInput
          id="inactivity-warning-days"
          label="Warn after"
          ref={warning}
          stored={warningDays}
          // Only the count the parser actually named. A bound refusal ("365
          // days or fewer") is about ONE input, and marking the other invalid
          // tells a screen-reader user a correct value is wrong; the ORDER
          // refusal names both, because either could move to fix it.
          invalid={invalid.includes("warningDays")}
        />
        <DayCountInput
          id="inactivity-alert-days"
          label="Alert after"
          ref={alert}
          stored={alertDays}
          invalid={invalid.includes("alertDays")}
        />
      </div>

      {/* One region for the pair — they are one decision — named by BOTH
          inputs' `aria-describedby`. */}
      <FieldSaveStatus id="inactivity-status" state={state} />
    </div>
  );
}

function DayCountInput({
  id,
  label,
  ref,
  stored,
  invalid,
}: {
  id: string;
  label: string;
  ref: React.RefObject<HTMLInputElement | null>;
  stored: number;
  invalid: boolean;
}) {
  return (
    <div className="min-w-40 flex-1 space-y-1.5">
      <Label
        htmlFor={id}
        className="text-muted-foreground cursor-pointer text-xs font-normal"
      >
        {label}
      </Label>
      <div className="flex items-center gap-2">
        <Input
          id={id}
          ref={ref}
          // A true numeric quantity, so `type="number"` and its spinner are
          // right (better-accessibility → forms' input-type table).
          type="number"
          inputMode="numeric"
          min={1}
          max={365}
          step={1}
          defaultValue={stored}
          aria-invalid={invalid ? true : undefined}
          aria-describedby="inactivity-help inactivity-status"
          className="w-24"
          onKeyDown={commitOnEnter}
        />
        <span className="text-muted-foreground text-sm">days</span>
      </div>
    </div>
  );
}
