import { z } from "zod";

import { CHURCH_TEXT_MAX } from "@/lib/validations/onboarding";

// ============================================================================
// THE CHURCH PROFILE — what a plant Admin may edit about the plant itself
// (CS-006, CS-009, CS-015; #618).
//
// One module, read by three consumers that keep no copy of it:
//
//   * the Church section, which maps `CHURCH_PROFILE_FIELDS` and hands it to a
//     CLIENT component as a PROP — so nothing here reaches the browser bundle,
//     and nothing here may reach `@/db` either. The write helpers that do live
//     in `./settings.ts` beside the zone and digest writes;
//   * `setChurchProfileFieldAction`, which parses `churchProfileWriteSchema`;
//   * `profile.test.ts`, which holds the walk this module cannot state — that
//     nothing ELSE in `src/` writes a church-profile column.
//
// ----------------------------------------------------------------------------
// ADDING A FIELD IS ONE ENTRY, AND THE COMPILER WALKS YOU THROUGH THE REST
// ----------------------------------------------------------------------------
//
// The claim this file used to make — "a field is one entry and nothing else" —
// was not true when it was only a comment: the registry was an ANNOTATED array
// and the schema was five hand-written arms with no type relationship to it, so
// a field could be added, rendered, typed into, and refused at every save with
// zod's raw discriminator message, with `tsc` silent throughout.
//
// It is true now, and it is the compiler that makes it so. Add an entry to
// `CHURCH_PROFILE_FIELDS` and each of these fails in turn until the field is
// finished:
//
//   1. `IN_SENTENCE` is a total `Record` over the registry's ids → no refusal
//      message for the new field.
//   2. `REGISTRY_IS_TOTAL` compares the registry's literal ids against the
//      schema's arms in BOTH directions → the endpoint would refuse it.
//   3. `profilePatch` (`./settings.ts`) switches with no `default` → the write
//      names no column.
//   4. `ChurchProfileFieldsProps["values"]` is a total `Record` → the section
//      hands down no value.
//
// Step 2 is why the array is `as const satisfies` rather than annotated: an
// annotation widens every `id` to `string` and leaves that check with nothing
// to compare.
//
// ----------------------------------------------------------------------------
// WHY THE WRITE SCHEMA IS A DISCRIMINATED UNION AND NOT `{ field, value }`
// ----------------------------------------------------------------------------
//
// Because the five fields do not have one type. `name` is `NOT NULL` on the
// table and empty is a refusal; the other four are individually optional and
// empty means NULL (the OB-002 contract — one flavour of absent, never two).
// A single `{ field: enum, value: string }` schema would have to hand the write
// helper a `string | null` for every field and then re-ask "but is this the
// name?" at the statement, which is the check somebody eventually forgets.
//
// Parsed through the union, `name` narrows to `string` and the rest to
// `string | null`, so `profilePatch`'s switch needs no guard at all: a NULL
// name is not a value the write path can be handed.
// ============================================================================

// ----------------------------------------------------------------------------
// The registry — the root of the chain, and what the inputs are drawn from
// ----------------------------------------------------------------------------

export interface ChurchProfileFieldSpec {
  /** The visible `<Label>`. Sentence case (DESIGN.md → voice). */
  label: string;
  /** Shows the expected FORMAT, never a second label (DESIGN.md → inputs). */
  placeholder: string;
  /** The autofill token. The same ones `church-basics-step.tsx` already uses. */
  autoComplete: string;
  /** `name` alone. The column is `NOT NULL` and a plant with no name is not a plant. */
  required: boolean;
  /**
   * How much of the two-column grid the input takes.
   *
   * PART OF THE ENTRY rather than a lookup in the component, because it is the
   * same kind of fact as the label: how wide a value reads. A city and a region
   * are short and pair on one line; a name, a street and a country do not.
   */
  span: "full" | "half";
}

/**
 * The fields, IN THE ORDER THEY RENDER — name, then the address narrowing from
 * the street outward.
 *
 * `as const satisfies` rather than an annotation, and that is load-bearing: an
 * annotation would widen every `id` to `string` and `REGISTRY_IS_TOTAL` below
 * would have nothing to compare.
 */
export const CHURCH_PROFILE_FIELDS = [
  {
    id: "name",
    label: "Church plant name",
    placeholder: "Dayspring Church",
    autoComplete: "organization",
    required: true,
    span: "full",
  },
  {
    id: "streetAddress",
    label: "Street address",
    placeholder: "1200 Congress Ave",
    autoComplete: "street-address",
    required: false,
    span: "full",
  },
  {
    id: "city",
    label: "City",
    placeholder: "Austin",
    autoComplete: "address-level2",
    required: false,
    span: "half",
  },
  {
    id: "stateRegion",
    label: "State or region",
    placeholder: "Texas",
    autoComplete: "address-level1",
    required: false,
    span: "half",
  },
  {
    id: "country",
    label: "Country",
    placeholder: "United States",
    autoComplete: "country-name",
    required: false,
    span: "full",
  },
] as const satisfies readonly (ChurchProfileFieldSpec & { id: string })[];

/** The ids the registry actually lists, as literals. */
type RegistryFieldId = (typeof CHURCH_PROFILE_FIELDS)[number]["id"];

export const churchProfileFieldIds = CHURCH_PROFILE_FIELDS.map(
  (field) => field.id
);

// ----------------------------------------------------------------------------
// The parsers
// ----------------------------------------------------------------------------

/**
 * How each field reads INSIDE a sentence, for the parser's refusals — "Enter a
 * name for your church plant", never "Enter Church plant name".
 *
 * Separate from the registry on purpose: this is the PARSER's copy and never
 * reaches the browser, while the registry is what the inputs are drawn from. A
 * total `Record` over the registry's literal ids, so a new entry has nowhere to
 * hide.
 */
const IN_SENTENCE: Record<RegistryFieldId, string> = {
  name: "a name for your church plant",
  streetAddress: "a street address",
  city: "a city",
  stateRegion: "a state or region",
  country: "a country",
};

/** Trim, hold the column width, and phrase the ceiling positively. */
function boundedText(id: RegistryFieldId) {
  return z
    .string()
    .trim()
    .max(
      CHURCH_TEXT_MAX,
      `Use ${CHURCH_TEXT_MAX} characters or less for ${IN_SENTENCE[id]}.`
    );
}

/**
 * An optional part: empty collapses to `null`, never to `""`.
 *
 * The same rule `optionalLocationField` applies at onboarding, restated here
 * rather than imported because that one carries onboarding's own messages and
 * this one has to name the field a planter is editing right now.
 */
function optionalText(id: RegistryFieldId) {
  return boundedText(id).transform((value) =>
    value.length === 0 ? null : value
  );
}

function requiredText(id: RegistryFieldId) {
  return boundedText(id).min(1, `Enter ${IN_SENTENCE[id]}.`);
}

export const churchProfileWriteSchema = z.discriminatedUnion("field", [
  z.object({ field: z.literal("name"), value: requiredText("name") }),
  z.object({
    field: z.literal("streetAddress"),
    value: optionalText("streetAddress"),
  }),
  z.object({ field: z.literal("city"), value: optionalText("city") }),
  z.object({
    field: z.literal("stateRegion"),
    value: optionalText("stateRegion"),
  }),
  z.object({ field: z.literal("country"), value: optionalText("country") }),
]);

/** One field's new value, already trimmed and already the column's type. */
export type ChurchProfileWrite = z.infer<typeof churchProfileWriteSchema>;

/** Derived from the schema, never typed beside it — see the header. */
export type ChurchProfileField = ChurchProfileWrite["field"];

/**
 * The registry draws every field the schema accepts, and no other.
 *
 * A build error either way round: an arm with no entry is an endpoint nothing
 * offers, and an entry with no arm is an input whose every save is refused with
 * zod's raw discriminator message. `[A] extends [B]` is tupled so a union does
 * not distribute and answer "yes, each member individually".
 */
type Exact<A, B> = [A] extends [B] ? ([B] extends [A] ? true : never) : never;
const REGISTRY_IS_TOTAL: Exact<RegistryFieldId, ChurchProfileField> = true;
void REGISTRY_IS_TOTAL;

// ----------------------------------------------------------------------------
// Inactivity thresholds (CS-009)
// ----------------------------------------------------------------------------
//
// TWO NUMBERS, ONE DECISION, and one action — the shape
// `ChurchDigestScheduleSelect` argued for and for the same reason. `warning`
// must be below `alert`, so writing them separately means a planter moving the
// pair from 7/14 to 30/60 is refused halfway through their own edit, at a
// moment when neither value is wrong and the combination is. CS-015's
// independence is per DECISION; the refusal below still names the count rather
// than the form, which is the half of CS-015 that protects the reader.

export const INACTIVITY_DAYS_MIN = 1;
/** A year. Past this the badge is measuring something nobody is tracking. */
export const INACTIVITY_DAYS_MAX = 365;

export const INACTIVITY_ORDER_MESSAGE =
  "The warning day count must be lower than the alert day count.";

export type InactivityThresholdField = "warningDays" | "alertDays";

const INACTIVITY_LABELS: Record<InactivityThresholdField, string> = {
  warningDays: "warning day count",
  alertDays: "alert day count",
};

function dayCount(field: InactivityThresholdField) {
  const label = INACTIVITY_LABELS[field];
  return z
    .number({ error: `Enter a ${label} between 1 and 365.` })
    .int(`The ${label} must be a whole number of days.`)
    .min(
      INACTIVITY_DAYS_MIN,
      `The ${label} must be at least ${INACTIVITY_DAYS_MIN} day.`
    )
    .max(
      INACTIVITY_DAYS_MAX,
      `The ${label} must be ${INACTIVITY_DAYS_MAX} days or fewer.`
    );
}

export const inactivityThresholdsSchema = z
  .object({
    warningDays: dayCount("warningDays"),
    alertDays: dayCount("alertDays"),
  })
  // `path` is what makes the refusal land ON the warning input rather than on
  // the card — CS-015: a failed save names the field, not the form.
  .refine((value) => value.warningDays < value.alertDays, {
    message: INACTIVITY_ORDER_MESSAGE,
    path: ["warningDays"],
  });

export type InactivityThresholds = z.infer<typeof inactivityThresholdsSchema>;

/**
 * What to say about a refused threshold pair, and WHICH inputs to mark.
 *
 * The two refusals are not the same shape and must not be drawn the same way.
 * A bound refusal ("900 days or fewer") is about ONE count, so marking the
 * other `aria-invalid` tells a screen-reader user a correct value is wrong. The
 * ORDER refusal is about the relationship, so both are marked: either number
 * could move to fix it, and singling one out would claim the other is settled.
 */
export function inactivityRefusal(error: z.ZodError): {
  message: string;
  invalid: readonly InactivityThresholdField[];
} {
  const issue = error.issues[0];
  const message = issue?.message ?? "We could not save that.";

  if (message === INACTIVITY_ORDER_MESSAGE) {
    return { message, invalid: ["warningDays", "alertDays"] };
  }

  const named = issue?.path[0];
  return {
    message,
    invalid:
      named === "warningDays" || named === "alertDays"
        ? [named]
        : ["warningDays", "alertDays"],
  };
}

/**
 * The FIRST message a failed parse should show, or a fallback.
 *
 * One sentence, never a list: each control has one status line under it, and a
 * planter fixing two fields reads the reason for the one they just touched.
 */
export function firstIssueMessage(error: z.ZodError): string {
  return error.issues[0]?.message ?? "We could not save that.";
}
