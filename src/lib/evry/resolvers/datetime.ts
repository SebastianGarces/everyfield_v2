import { eq } from "drizzle-orm";
import { z } from "zod";

import { db } from "@/db";
import { churches } from "@/db/schema";
import {
  addCalendarDays,
  instantsAtZonedTime,
  isValidTimeZone,
  toCalendarDate,
  utcOffsetForZonedTime,
} from "@/lib/datetime";
import { authorizeEvryCapability } from "@/lib/evry/eligibility/capabilities";

import type { EvryDateTimeInterpretationEvidence } from "../artifacts/types";

const AUTHORITATIVE_PLANT_TIME_ZONE: unique symbol = Symbol(
  "AuthoritativeEvryPlantTimeZone"
);
const RESOLVED_EVRY_PLANT_DATE_TIME: unique symbol = Symbol(
  "ResolvedEvryPlantDateTime"
);
const resolvedPlantDateTimes = new WeakSet<object>();

type AuthoritativePlantTimeZone = Readonly<{
  id: string;
  [AUTHORITATIVE_PLANT_TIME_ZONE]: true;
}>;

/**
 * One resolver-minted plant-local wall clock and its unique UTC meaning.
 * The private brand and identity registry keep raw model/JSON values out of a
 * confirmation even when they happen to have the same visible fields.
 */
export type EvryResolvedPlantDateTime = Readonly<{
  calendarDate: string;
  localTime: string;
  timeZone: string;
  utcOffset: string;
  instantUtc: string;
  interpretation: EvryDateTimeInterpretationEvidence;
  [RESOLVED_EVRY_PLANT_DATE_TIME]: true;
}>;

/** Runtime half of the confirmation boundary; copied/serialized values fail. */
export function isResolvedEvryPlantDateTime(
  value: unknown
): value is EvryResolvedPlantDateTime {
  return (
    typeof value === "object" &&
    value !== null &&
    RESOLVED_EVRY_PLANT_DATE_TIME in value &&
    value[RESOLVED_EVRY_PLANT_DATE_TIME] === true &&
    resolvedPlantDateTimes.has(value)
  );
}

const MONTHS = [
  "january",
  "february",
  "march",
  "april",
  "may",
  "june",
  "july",
  "august",
  "september",
  "october",
  "november",
  "december",
] as const;

const MONTH_PATTERN = MONTHS.join("|");
const WEEKDAY_PATTERN =
  "monday|tuesday|wednesday|thursday|friday|saturday|sunday";
const EXPLICIT_MONTH_DATE = new RegExp(
  `^(${MONTH_PATTERN}) (\\d{1,2}),? (\\d{4}) at (.+)$`,
  "i"
);
const MISSING_YEAR_DATE = new RegExp(
  `^(${MONTH_PATTERN}) \\d{1,2}(?:st|nd|rd|th)?,? at\\b`,
  "i"
);
const AMBIGUOUS_WEEKDAY = new RegExp(
  `^(?:(?:this|next) )?(?:${WEEKDAY_PATTERN})\\b`,
  "i"
);
const EXPLICIT_ISO_DATE = /^(\d{4})-(\d{2})-(\d{2}) at (.+)$/i;
const RELATIVE_DATE = /^(today|tomorrow) at (.+)$/i;
const TWELVE_HOUR_TIME = /^(\d{1,2})(?::(\d{2}))? (am|pm)$/i;

const requestSchema = z
  .object({
    capabilityIdentity: z.string().min(1).max(500),
    sourceText: z
      .string()
      .max(500)
      .refine((value) => value.trim() !== ""),
  })
  .strict();

type ParsedWallClock = Readonly<{
  calendarDate: string;
  hour: number;
  minute: number;
  localTime: string;
  interpretation: EvryDateTimeInterpretationEvidence;
}>;

export type EvryDateTimeClarificationReason =
  | "missing-year"
  | "ambiguous-weekday"
  | "invalid-calendar-date"
  | "invalid-local-time"
  | "unsupported-phrase"
  | "nonexistent-local-time"
  | "repeated-local-time";

export type EvryDateTimeResolution =
  | Readonly<{ status: "resolved"; dateTime: EvryResolvedPlantDateTime }>
  | Readonly<{
      status: "clarification";
      reason: EvryDateTimeClarificationReason;
      sourceText: string;
      prompt: string;
    }>
  | Readonly<{
      status: "refused";
      reason:
        | "invalid-request"
        | "capability-refused"
        | "plant-unavailable"
        | "invalid-stored-plant-time-zone";
    }>;

function clarification(
  reason: EvryDateTimeClarificationReason,
  sourceText: string,
  prompt: string
): EvryDateTimeResolution {
  return Object.freeze({
    status: "clarification" as const,
    reason,
    sourceText,
    prompt,
  });
}

function normalizeSourceText(sourceText: string): string {
  return sourceText.trim().replace(/\s+/g, " ");
}

function calendarDateOf(
  year: number,
  month: number,
  day: number
): string | null {
  if (
    !Number.isInteger(year) ||
    !Number.isInteger(month) ||
    !Number.isInteger(day) ||
    year < 100 ||
    year > 9999 ||
    month < 1 ||
    month > 12 ||
    day < 1
  ) {
    return null;
  }

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
  if (day > daysInMonth[month - 1]) return null;

  return `${String(year).padStart(4, "0")}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

function parseLocalTime(value: string): {
  hour: number;
  minute: number;
  localTime: string;
} | null {
  const match = TWELVE_HOUR_TIME.exec(value);
  if (!match) return null;

  const statedHour = Number(match[1]);
  const minute = Number(match[2] ?? "0");
  const meridiem = match[3].toUpperCase();
  if (statedHour < 1 || statedHour > 12 || minute < 0 || minute > 59) {
    return null;
  }

  const hour = (statedHour % 12) + (meridiem === "PM" ? 12 : 0);
  return {
    hour,
    minute,
    localTime: `${statedHour}:${String(minute).padStart(2, "0")} ${meridiem}`,
  };
}

function explicitInterpretation(
  sourceText: string,
  calendarDate: string
): EvryDateTimeInterpretationEvidence {
  return Object.freeze({
    basis: "explicit-calendar-date" as const,
    sourceText,
    statedCalendarDate: calendarDate,
  });
}

function parseWallClock(
  sourceText: string,
  referenceInstant: Date,
  plantTimeZone: string
): ParsedWallClock | EvryDateTimeResolution {
  const normalized = normalizeSourceText(sourceText);

  if (MISSING_YEAR_DATE.test(normalized)) {
    return clarification(
      "missing-year",
      sourceText,
      "What absolute calendar date, including the year, should Evry use?"
    );
  }

  if (AMBIGUOUS_WEEKDAY.test(normalized)) {
    return clarification(
      "ambiguous-weekday",
      sourceText,
      "Which absolute calendar date should Evry use for that weekday?"
    );
  }

  const relative = RELATIVE_DATE.exec(normalized);
  if (relative) {
    const time = parseLocalTime(relative[2]);
    if (!time) {
      return clarification(
        "invalid-local-time",
        sourceText,
        "What local time should Evry use, including AM or PM?"
      );
    }

    const relativeDay =
      relative[1].toLowerCase() === "today" ? "today" : "tomorrow";
    const referenceCalendarDate = toCalendarDate(
      referenceInstant,
      plantTimeZone
    );
    const calendarDate =
      relativeDay === "today"
        ? referenceCalendarDate
        : addCalendarDays(
            new Date(`${referenceCalendarDate}T00:00:00.000Z`),
            1
          );

    return Object.freeze({
      calendarDate,
      ...time,
      interpretation: Object.freeze({
        basis: "plant-relative-day" as const,
        sourceText,
        relativeDay,
        referenceInstantUtc: referenceInstant.toISOString(),
        referenceCalendarDate,
      }),
    });
  }

  const isoDate = EXPLICIT_ISO_DATE.exec(normalized);
  if (isoDate) {
    const calendarDate = calendarDateOf(
      Number(isoDate[1]),
      Number(isoDate[2]),
      Number(isoDate[3])
    );
    if (!calendarDate) {
      return clarification(
        "invalid-calendar-date",
        sourceText,
        "What valid absolute calendar date should Evry use?"
      );
    }
    const time = parseLocalTime(isoDate[4]);
    if (!time) {
      return clarification(
        "invalid-local-time",
        sourceText,
        "What local time should Evry use, including AM or PM?"
      );
    }
    return Object.freeze({
      calendarDate,
      ...time,
      interpretation: explicitInterpretation(sourceText, calendarDate),
    });
  }

  const monthDate = EXPLICIT_MONTH_DATE.exec(normalized);
  if (monthDate) {
    const normalizedMonth = monthDate[1].toLowerCase();
    const month = MONTHS.findIndex(
      (candidate) => candidate === normalizedMonth
    );
    const calendarDate = calendarDateOf(
      Number(monthDate[3]),
      month + 1,
      Number(monthDate[2])
    );
    if (!calendarDate) {
      return clarification(
        "invalid-calendar-date",
        sourceText,
        "What valid absolute calendar date should Evry use?"
      );
    }
    const time = parseLocalTime(monthDate[4]);
    if (!time) {
      return clarification(
        "invalid-local-time",
        sourceText,
        "What local time should Evry use, including AM or PM?"
      );
    }
    return Object.freeze({
      calendarDate,
      ...time,
      interpretation: explicitInterpretation(sourceText, calendarDate),
    });
  }

  return clarification(
    "unsupported-phrase",
    sourceText,
    "Use an absolute date with a year and a local time including AM or PM."
  );
}

/**
 * Resolve a narrow natural-language wall clock at the application boundary.
 *
 * The request accepts a trusted capability identity, never a timezone or
 * reference clock. It re-mints the actor from the session, derives the plant
 * id from that actor, and reads the timezone from the plant row. A viewer/page
 * zone or address is therefore neither an input nor authority. Full-year
 * absolute dates and `today`/`tomorrow` are closed; other language asks for
 * clarification rather than entering a plan.
 */
async function resolveEvryPlantDateTimeAt(
  request: unknown,
  referenceInstant: Date
): Promise<EvryDateTimeResolution> {
  const parsed = requestSchema.safeParse(request);
  if (!parsed.success) {
    return Object.freeze({
      status: "refused" as const,
      reason: "invalid-request" as const,
    });
  }

  const authorization = await authorizeEvryCapability(
    parsed.data.capabilityIdentity
  );
  if (!authorization) {
    return Object.freeze({
      status: "refused" as const,
      reason: "capability-refused" as const,
    });
  }

  const [plant] = await db
    .select({ timeZone: churches.timeZone })
    .from(churches)
    .where(eq(churches.id, authorization.actor.plantId))
    .limit(1);
  if (!plant) {
    return Object.freeze({
      status: "refused" as const,
      reason: "plant-unavailable" as const,
    });
  }
  if (!isValidTimeZone(plant.timeZone)) {
    return Object.freeze({
      status: "refused" as const,
      reason: "invalid-stored-plant-time-zone" as const,
    });
  }
  const plantTimeZone: AuthoritativePlantTimeZone = Object.freeze({
    id: plant.timeZone,
    [AUTHORITATIVE_PLANT_TIME_ZONE]: true as const,
  });

  const wallClock = parseWallClock(
    parsed.data.sourceText,
    referenceInstant,
    plantTimeZone.id
  );
  if ("status" in wallClock) return wallClock;

  const candidates = instantsAtZonedTime(
    wallClock.calendarDate,
    wallClock.hour,
    wallClock.minute,
    plantTimeZone.id
  );
  if (candidates.length === 0) {
    return clarification(
      "nonexistent-local-time",
      parsed.data.sourceText,
      `${wallClock.calendarDate} at ${wallClock.localTime} does not exist in ${plantTimeZone.id} because the clock changes. What local time should Evry use?`
    );
  }
  if (candidates.length !== 1) {
    return clarification(
      "repeated-local-time",
      parsed.data.sourceText,
      `${wallClock.calendarDate} at ${wallClock.localTime} occurs more than once in ${plantTimeZone.id} because the clock changes. Choose a different local time that occurs only once.`
    );
  }

  const instant = candidates[0];
  const dateTime: EvryResolvedPlantDateTime = Object.freeze({
    calendarDate: wallClock.calendarDate,
    localTime: wallClock.localTime,
    timeZone: plantTimeZone.id,
    utcOffset: utcOffsetForZonedTime(
      wallClock.calendarDate,
      wallClock.hour,
      wallClock.minute,
      instant
    ),
    instantUtc: instant.toISOString(),
    interpretation: wallClock.interpretation,
    [RESOLVED_EVRY_PLANT_DATE_TIME]: true as const,
  });
  resolvedPlantDateTimes.add(dateTime);

  return Object.freeze({ status: "resolved" as const, dateTime });
}

export type EvryDateTimeClock = Readonly<{ now: () => Date }>;

/** Test seam for the server-owned reference clock; production uses real time. */
export function createEvryPlantDateTimeRequestResolver({
  now,
}: EvryDateTimeClock): (request: unknown) => Promise<EvryDateTimeResolution> {
  return async function resolveEvryPlantDateTimeRequest(request: unknown) {
    const current = now();
    if (!(current instanceof Date) || Number.isNaN(current.getTime())) {
      throw new Error("Evry datetime clock returned an invalid instant");
    }
    return resolveEvryPlantDateTimeAt(request, new Date(current.getTime()));
  };
}

/** Production request service: its relative-date clock is server-owned. */
export const resolveEvryPlantDateTimeRequest =
  createEvryPlantDateTimeRequestResolver({ now: () => new Date() });
