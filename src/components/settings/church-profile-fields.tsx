"use client";

import { useRef } from "react";

import { setChurchProfileFieldAction } from "@/app/(dashboard)/settings/actions";
import {
  commitOnEnter,
  FieldSaveStatus,
  revertOnEscape,
  useFieldSave,
} from "@/components/settings/field-save";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import type {
  ChurchProfileField,
  ChurchProfileFieldSpec,
} from "@/lib/churches/profile";

// ============================================================================
// The church's name and address (CS-006 / CS-015, #618).
//
// PRESENTATION ONLY, like the controls beside it: the server hands down the
// stored values AND the field list, so this module imports nothing from
// `@/lib/churches/profile` but its TYPES (erased at build). That keeps the
// parser — and zod with it — out of the browser bundle, and it means there is
// no second copy of the field list to drift from the one the action parses.
//
// The save machine, and the argument for uncontrolled inputs, live in
// `./field-save.tsx` — shared with the inactivity pair rather than written
// twice.
//
// ----------------------------------------------------------------------------
// THE FAILURE IS INLINE AND THERE IS NO TOAST
// ----------------------------------------------------------------------------
//
// CS-015: "a failed save names the field, not the form". The zone and digest
// selects use `toast.error`, which is right for a SELECT — the value visibly
// reverts and the control has no wrong state to sit in. A text field does: the
// planter's own words are still in the box, and the reason has to be beside
// them, not in a corner that has already faded.
// ============================================================================

export interface ChurchProfileFieldsProps {
  /** The registry, in render order. Passed down so the client never imports it. */
  fields: readonly (ChurchProfileFieldSpec & { id: ChurchProfileField })[];
  /**
   * The stored values, straight off the church row.
   *
   * A total `Record` on purpose — it is the last link in the chain that makes
   * "a new field is one schema arm and then whatever stops compiling" true
   * (see `@/lib/churches/profile`).
   */
  values: Readonly<Record<ChurchProfileField, string | null>>;
}

export function ChurchProfileFields({
  fields,
  values,
}: ChurchProfileFieldsProps) {
  return (
    <div className="bg-card space-y-3 rounded-lg border px-4 py-4">
      <div className="space-y-1">
        <h3 id="church-profile-heading" className="text-sm font-medium">
          Name and address
        </h3>
        <p className="text-muted-foreground text-sm text-pretty">
          Where this plant is, and what to call it. Each field saves on its own
          when you click away. Only the name is required — leave anything else
          blank until you know it.
        </p>
      </div>

      <div
        role="group"
        aria-labelledby="church-profile-heading"
        className="grid gap-4 sm:grid-cols-2"
      >
        {fields.map((field) => (
          <ProfileFieldRow
            key={field.id}
            field={field}
            value={values[field.id]}
          />
        ))}
      </div>
    </div>
  );
}

function ProfileFieldRow({
  field,
  value,
}: {
  field: ChurchProfileFieldSpec & { id: ChurchProfileField };
  value: string | null;
}) {
  const input = useRef<HTMLInputElement>(null);
  const stored = value ?? "";

  const { state, commit } = useFieldSave({
    isDirty: () => (input.current?.value.trim() ?? stored) !== stored,
    save: () =>
      setChurchProfileFieldAction({
        field: field.id,
        value: input.current?.value.trim() ?? stored,
      }),
  });

  const inputId = `church-profile-${field.id}`;
  const statusId = `${inputId}-status`;

  return (
    <div className={field.span === "full" ? "sm:col-span-2" : undefined}>
      <div className="space-y-1.5">
        <Label htmlFor={inputId} className="cursor-pointer">
          {field.label}
          {field.required ? (
            // `aria-hidden` because native `required` already announces the
            // state — the asterisk would say it twice — and the block's own
            // sentence above explains which field it marks.
            <span className="text-destructive" aria-hidden="true">
              *
            </span>
          ) : null}
        </Label>

        <Input
          id={inputId}
          ref={input}
          name={field.id}
          defaultValue={stored}
          placeholder={field.placeholder}
          autoComplete={field.autoComplete}
          required={field.required}
          // NO `maxLength`: better-accessibility → forms says accept free text
          // and validate after, rather than blocking typing at the ceiling. The
          // parser refuses anything past the column width and says so.
          //
          // `undefined`, never `false` — the attribute is REMOVED once the
          // field is valid again, which is what `aria-invalid` means and what
          // the Input's `aria-invalid:` ring styles key off.
          aria-invalid={state.status === "failed" ? true : undefined}
          aria-describedby={statusId}
          className="w-full max-w-md"
          onBlur={commit}
          onKeyDown={(event) => {
            commitOnEnter(event);
            revertOnEscape(event, stored);
          }}
        />

        <FieldSaveStatus id={statusId} state={state} />
      </div>
    </div>
  );
}
