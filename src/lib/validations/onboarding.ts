import { z } from "zod";

import { extractFieldErrors } from "./utils";

/**
 * F12 / OB-001 + OB-002 — validation for the onboarding flow's step 1.
 *
 * Step 1 is the ONLY required step, and inside it only the name is required.
 * The three location fields are individually optional (OB-002), so each one
 * normalises "" to `null` rather than to an empty string: an empty string in
 * the column would read as "the planter said their city is blank", and every
 * later surface (settings, SEND reporting, merge fields) would have to know
 * about two flavours of absent. One flavour — NULL — is the contract.
 */

/** Matches `churches.name` and every other varchar(255) on the table. */
export const CHURCH_TEXT_MAX = 255;

const churchNameSchema = z
  .string()
  .trim()
  .min(1, "Please enter a name for your church plant")
  .max(CHURCH_TEXT_MAX, "Church name must be 255 characters or less");

/**
 * An optional free-text location part. Trims, enforces the column width, and
 * collapses blank input to `null` (see the module note above).
 */
function optionalLocationField(label: string) {
  return z
    .string()
    .trim()
    .max(CHURCH_TEXT_MAX, `${label} must be 255 characters or less`)
    .transform((value) => (value.length === 0 ? null : value));
}

export const churchBasicsSchema = z.object({
  name: churchNameSchema,
  city: optionalLocationField("City"),
  stateRegion: optionalLocationField("State or region"),
  country: optionalLocationField("Country"),
});

export type ChurchBasicsInput = z.infer<typeof churchBasicsSchema>;

/**
 * Reads step 1's fields off a `FormData`. Missing keys become "" so that a
 * client that omits an untouched optional input is treated the same as one
 * that submits it empty — both mean "not provided".
 */
export function churchBasicsFromFormData(formData: FormData) {
  const read = (key: string) => {
    const value = formData.get(key);
    return typeof value === "string" ? value : "";
  };

  return churchBasicsSchema.safeParse({
    name: read("name"),
    city: read("city"),
    stateRegion: read("stateRegion"),
    country: read("country"),
  });
}

/**
 * Step 1's per-field errors, in the `useActionState` shape the flow renders.
 *
 * Declared here rather than next to the action because a `"use server"` module
 * is an auth surface, not a place to keep shared shapes
 * (`memory/invariants.md` → Authentication); the action re-exports the type for
 * the form component that already imports it from there.
 */
export type ChurchBasicsFieldErrors = {
  name?: string;
  city?: string;
  stateRegion?: string;
  country?: string;
};

export type ChurchBasicsParse =
  | { ok: true; values: ChurchBasicsInput }
  | { ok: false; fieldErrors: ChurchBasicsFieldErrors };

/**
 * The whole of step 1's boundary: read the form, validate it, and hand back
 * either the values to write or the errors to render. One function so the
 * write path never sees an unvalidated field and never has to remember how a
 * `ZodError` becomes field errors.
 */
export function parseChurchBasics(formData: FormData): ChurchBasicsParse {
  const parsed = churchBasicsFromFormData(formData);

  if (!parsed.success) {
    return {
      ok: false,
      fieldErrors: extractFieldErrors<ChurchBasicsFieldErrors>(parsed.error),
    };
  }

  return { ok: true, values: parsed.data };
}
