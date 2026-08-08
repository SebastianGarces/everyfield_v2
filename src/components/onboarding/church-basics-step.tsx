"use client";

import { useState, useTransition } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { createChurchBasics } from "@/app/(dashboard)/dashboard/actions";
import {
  CHURCH_TEXT_MAX,
  type ChurchBasicsFieldErrors,
} from "@/lib/validations/onboarding";

type Props = {
  /** Called once the church row exists. The flow advances to step 2. */
  onCreated: () => void;
};

/**
 * Step 1 of onboarding (OB-001 + OB-002).
 *
 * The name is the only required field; city, state/region and country are each
 * independently optional, so the form never blocks on a planter who has not
 * settled on a location. Submitting creates the church immediately.
 *
 * The inputs are controlled because `<form action={fn}>` resets an uncontrolled
 * form once the action settles — which on a validation error would wipe the
 * name the planter just typed and hand them an error about a field that is now
 * empty. Controlled values are the planter's own keystrokes, not server data,
 * so this is not the "server data in useState" anti-pattern.
 */
export function ChurchBasicsStep({ onCreated }: Props) {
  const [pending, startTransition] = useTransition();
  const [formError, setFormError] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<ChurchBasicsFieldErrors>({});
  const [values, setValues] = useState({
    name: "",
    city: "",
    stateRegion: "",
    country: "",
  });

  function setField(field: keyof typeof values, value: string) {
    setValues((current) => ({ ...current, [field]: value }));
  }

  function handleSubmit(formData: FormData) {
    setFormError(null);
    setFieldErrors({});

    startTransition(async () => {
      const result = await createChurchBasics(formData);

      if (result.status === "created") {
        onCreated();
        return;
      }

      setFormError(result.error ?? null);
      setFieldErrors(result.fieldErrors ?? {});
    });
  }

  return (
    <form action={handleSubmit} className="space-y-5">
      {formError && (
        <p
          role="alert"
          className="bg-destructive/10 text-destructive rounded-md p-3 text-sm"
        >
          {formError}
        </p>
      )}

      <div className="space-y-2">
        <Label htmlFor="church-name">
          Church plant name{" "}
          <span className="text-destructive" aria-hidden="true">
            *
          </span>
        </Label>
        <Input
          id="church-name"
          name="name"
          type="text"
          required
          maxLength={CHURCH_TEXT_MAX}
          autoComplete="organization"
          placeholder="e.g., Grace Community Church"
          value={values.name}
          onChange={(event) => setField("name", event.target.value)}
          aria-invalid={!!fieldErrors.name}
          aria-describedby={fieldErrors.name ? "church-name-error" : undefined}
        />
        {fieldErrors.name && (
          <p id="church-name-error" className="text-destructive text-sm">
            {fieldErrors.name}
          </p>
        )}
      </div>

      <fieldset className="space-y-4">
        <legend className="text-sm font-medium">
          Where is it?{" "}
          <span className="text-muted-foreground font-normal">(optional)</span>
        </legend>
        <p className="text-muted-foreground -mt-2 text-sm">
          Fill in whatever you know. You can add or change any of this later.
        </p>

        <div className="grid gap-4 sm:grid-cols-2">
          <LocationField
            id="church-city"
            name="city"
            label="City"
            autoComplete="address-level2"
            placeholder="e.g., Austin"
            value={values.city}
            error={fieldErrors.city}
            onChange={(value) => setField("city", value)}
          />
          <LocationField
            id="church-state-region"
            name="stateRegion"
            label="State or region"
            autoComplete="address-level1"
            placeholder="e.g., Texas"
            value={values.stateRegion}
            error={fieldErrors.stateRegion}
            onChange={(value) => setField("stateRegion", value)}
          />
        </div>

        <LocationField
          id="church-country"
          name="country"
          label="Country"
          autoComplete="country-name"
          placeholder="e.g., United States"
          value={values.country}
          error={fieldErrors.country}
          onChange={(value) => setField("country", value)}
        />
      </fieldset>

      <div className="flex justify-end">
        <Button type="submit" className="cursor-pointer" disabled={pending}>
          {pending ? "Creating…" : "Create church plant"}
        </Button>
      </div>
    </form>
  );
}

function LocationField({
  id,
  name,
  label,
  placeholder,
  autoComplete,
  value,
  error,
  onChange,
}: {
  id: string;
  name: string;
  label: string;
  placeholder: string;
  autoComplete: string;
  value: string;
  error?: string;
  onChange: (value: string) => void;
}) {
  return (
    <div className="space-y-2">
      <Label htmlFor={id}>{label}</Label>
      <Input
        id={id}
        name={name}
        type="text"
        maxLength={CHURCH_TEXT_MAX}
        autoComplete={autoComplete}
        placeholder={placeholder}
        value={value}
        onChange={(event) => onChange(event.target.value)}
        aria-invalid={!!error}
        aria-describedby={error ? `${id}-error` : undefined}
      />
      {error && (
        <p id={`${id}-error`} className="text-destructive text-sm">
          {error}
        </p>
      )}
    </div>
  );
}
