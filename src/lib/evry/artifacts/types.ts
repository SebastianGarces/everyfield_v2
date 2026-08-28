import { z } from "zod";

import { isValidTimeZone } from "@/lib/datetime";

const TRUSTED_EVRY_SOURCE_LINK: unique symbol = Symbol(
  "TrustedEvryApplicationSourceLink"
);
const APPLICATION_ORIGIN = "https://application.everyfield.invalid";

/** An in-application destination built by trusted product code, never a model. */
export type TrustedEvryApplicationSourceLink = Readonly<{
  label: string;
  href: string;
  [TRUSTED_EVRY_SOURCE_LINK]: true;
}>;

/**
 * Mint an application-only link at the trusted domain-adapter boundary.
 *
 * The brand prevents model output from being passed straight into an artifact.
 * The runtime check also refuses protocol-relative and external destinations.
 */
export function trustedEvryApplicationSourceLink({
  label,
  href,
}: {
  label: string;
  href: string;
}): TrustedEvryApplicationSourceLink {
  const parsed = new URL(href, APPLICATION_ORIGIN);
  if (
    label.trim().length === 0 ||
    !href.startsWith("/") ||
    href.startsWith("//") ||
    parsed.origin !== APPLICATION_ORIGIN
  ) {
    throw new Error("Evry source links must be labeled application paths");
  }

  return Object.freeze({
    label,
    href,
    [TRUSTED_EVRY_SOURCE_LINK]: true as const,
  });
}

export type EvryArtifactFact = Readonly<{
  label: string;
  value: string;
}>;

export type EvryReadFilter = Readonly<{
  label: string;
  value: string;
}>;

export type EvryReadExclusion = Readonly<{
  reason: string;
  count: number;
}>;

export type EvryReadItem = Readonly<{
  id: string;
  label: string;
  facts: readonly EvryArtifactFact[];
  sourceLink: TrustedEvryApplicationSourceLink;
}>;

export type EvryReadArtifact = Readonly<{
  kind: "read";
  title: string;
  filters: readonly EvryReadFilter[];
  counts: Readonly<{
    matched: number;
    returned: number;
    excluded: number;
  }>;
  exclusions: readonly EvryReadExclusion[];
  items: readonly EvryReadItem[];
  sourceLinks: readonly TrustedEvryApplicationSourceLink[];
}>;

export type EvryEntityChoice = Readonly<{
  entityType: string;
  id: string;
  label: string;
  distinguishingFacts: readonly EvryArtifactFact[];
  sourceLink: TrustedEvryApplicationSourceLink;
}>;

export type EvryClarificationArtifact =
  | Readonly<{
      kind: "clarification";
      mode: "missing";
      entityType: string;
      prompt: string;
    }>
  | Readonly<{
      kind: "clarification";
      mode: "choice";
      entityType: string;
      prompt: string;
      choices: readonly [
        EvryEntityChoice,
        EvryEntityChoice,
        ...EvryEntityChoice[],
      ];
      defaultChoiceId: null;
    }>;

export type EvryReadContinuationArtifact =
  | EvryReadArtifact
  | EvryClarificationArtifact;

export const EVRY_DATE_BEARING_SUBJECTS = [
  "meeting",
  "task",
  "communication",
  "launch",
] as const;

export type EvryDateBearingSubject =
  (typeof EVRY_DATE_BEARING_SUBJECTS)[number];

function isCalendarDate(value: string): boolean {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!match) return false;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  if (year < 100 || month < 1 || month > 12 || day < 1) return false;
  const leapYear = year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
  const daysInMonth = [
    31,
    leapYear ? 29 : 28,
    31,
    30,
    31,
    30,
    31,
    31,
    30,
    31,
    30,
    31,
  ];
  return day <= daysInMonth[month - 1];
}

export const evryCalendarDateSchema = z
  .string()
  .refine(isCalendarDate, "Invalid Evry calendar date");

export const evryLocalTimeSchema = z
  .string()
  .regex(/^(?:[1-9]|1[0-2]):[0-5]\d (?:AM|PM)$/);

const evryInterpretationEvidenceSchema = z.discriminatedUnion("basis", [
  z
    .object({
      basis: z.literal("explicit-calendar-date"),
      sourceText: z.string().min(1).max(500),
      statedCalendarDate: evryCalendarDateSchema,
    })
    .strict()
    .readonly(),
  z
    .object({
      basis: z.literal("plant-relative-day"),
      sourceText: z.string().min(1).max(500),
      relativeDay: z.enum(["today", "tomorrow"]),
      referenceInstantUtc: z.string().datetime(),
      referenceCalendarDate: evryCalendarDateSchema,
    })
    .strict()
    .readonly(),
]);

export type EvryDateTimeInterpretationEvidence = z.infer<
  typeof evryInterpretationEvidenceSchema
>;

/** Closed JSON document stored inside a durable confirmation artifact. */
export const evryConfirmationDateTimeDocumentSchema = z
  .object({
    calendarDate: evryCalendarDateSchema,
    localTime: evryLocalTimeSchema,
    timeZone: z.string().min(1).max(64).refine(isValidTimeZone),
    utcOffset: z.string().regex(/^[+-]\d{2}:\d{2}(?::\d{2})?$/),
    instantUtc: z.string().datetime(),
    interpretation: evryInterpretationEvidenceSchema,
  })
  .strict()
  .readonly();

export type EvryConfirmationDateTimeDocument = z.infer<
  typeof evryConfirmationDateTimeDocumentSchema
>;

/** The schema-derived durable timing fragment for date-bearing confirmations. */
export const evryDateBearingConfirmationEvidenceSchema = z
  .object({
    kind: z.literal("confirmation-date-time"),
    subject: z.enum(EVRY_DATE_BEARING_SUBJECTS),
    dateTime: evryConfirmationDateTimeDocumentSchema,
  })
  .strict()
  .readonly();

export type EvryDateBearingConfirmationEvidence = z.infer<
  typeof evryDateBearingConfirmationEvidenceSchema
>;
