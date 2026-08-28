import {
  addCalendarDays,
  instantsAtZonedTime,
  toCalendarDate,
  utcOffsetForZonedTime,
} from "@/lib/datetime";

import type {
  EvryConfirmationDateTimeDocument,
  EvryDateBearingConfirmationEvidence,
  EvryDateBearingSubject,
  EvryReadArtifact,
  EvryReadExclusion,
  EvryReadFilter,
  EvryReadItem,
  TrustedEvryApplicationSourceLink,
} from "./types";
import { evryDateBearingConfirmationEvidenceSchema } from "./types";
import {
  isResolvedEvryPlantDateTime,
  type EvryResolvedPlantDateTime,
} from "../resolvers/datetime";
export { trustedEvryApplicationSourceLink } from "./types";

function countExclusions(exclusions: readonly EvryReadExclusion[]): number {
  return exclusions.reduce((total, exclusion) => {
    if (!Number.isSafeInteger(exclusion.count) || exclusion.count < 0) {
      throw new Error("Evry exclusion counts must be non-negative integers");
    }
    return total + exclusion.count;
  }, 0);
}

function snapshotFilters(
  filters: readonly EvryReadFilter[]
): readonly EvryReadFilter[] {
  return Object.freeze(filters.map((filter) => Object.freeze({ ...filter })));
}

function snapshotExclusions(
  exclusions: readonly EvryReadExclusion[]
): readonly EvryReadExclusion[] {
  return Object.freeze(
    exclusions.map((exclusion) => Object.freeze({ ...exclusion }))
  );
}

function snapshotItems(
  items: readonly EvryReadItem[]
): readonly EvryReadItem[] {
  return Object.freeze(
    items.map((item) =>
      Object.freeze({
        ...item,
        facts: Object.freeze(
          item.facts.map((fact) => Object.freeze({ ...fact }))
        ),
      })
    )
  );
}

/** Build counts from the rows and exclusions so the three values cannot drift. */
export function buildEvryReadArtifact({
  title,
  filters,
  exclusions,
  items,
  sourceLinks,
}: {
  title: string;
  filters: readonly EvryReadFilter[];
  exclusions: readonly EvryReadExclusion[];
  items: readonly EvryReadItem[];
  sourceLinks: readonly TrustedEvryApplicationSourceLink[];
}): EvryReadArtifact {
  const stableFilters = snapshotFilters(filters);
  const stableExclusions = snapshotExclusions(exclusions);
  const stableItems = snapshotItems(items);
  const stableSourceLinks = Object.freeze([...sourceLinks]);
  const excluded = countExclusions(stableExclusions);

  return Object.freeze({
    kind: "read",
    title,
    filters: stableFilters,
    counts: Object.freeze({
      matched: stableItems.length + excluded,
      returned: stableItems.length,
      excluded,
    }),
    exclusions: stableExclusions,
    items: stableItems,
    sourceLinks: stableSourceLinks,
  });
}

/**
 * Snapshot a resolver-minted plant-local value into durable confirmation data.
 * The ephemeral value's identity authenticates this input; that authority is
 * deliberately absent from the closed JSON document returned for persistence.
 */
export function buildEvryDateBearingConfirmationEvidence({
  subject,
  dateTime,
}: {
  subject: EvryDateBearingSubject;
  dateTime: EvryResolvedPlantDateTime;
}): EvryDateBearingConfirmationEvidence {
  if (!isResolvedEvryPlantDateTime(dateTime)) {
    throw new Error(
      "Evry confirmation timing must come from the plant-local resolver"
    );
  }

  return parsePersistedEvryDateBearingConfirmationEvidence({
    kind: "confirmation-date-time",
    subject,
    dateTime: {
      calendarDate: dateTime.calendarDate,
      localTime: dateTime.localTime,
      timeZone: dateTime.timeZone,
      utcOffset: dateTime.utcOffset,
      instantUtc: dateTime.instantUtc,
      interpretation: { ...dateTime.interpretation },
    },
  });
}

function localTimeParts(localTime: string): {
  hour: number;
  minute: number;
} {
  const match = /^(\d{1,2}):(\d{2}) (AM|PM)$/.exec(localTime);
  if (!match) throw new Error("Persisted Evry confirmation timing is invalid");
  const statedHour = Number(match[1]);
  return {
    hour: (statedHour % 12) + (match[3] === "PM" ? 12 : 0),
    minute: Number(match[2]),
  };
}

function assertInterpretationConsistency(
  dateTime: EvryConfirmationDateTimeDocument
): void {
  const interpretation = dateTime.interpretation;
  if (interpretation.basis === "explicit-calendar-date") {
    if (interpretation.statedCalendarDate !== dateTime.calendarDate) {
      throw new Error("Persisted Evry confirmation timing is invalid");
    }
    return;
  }

  const referenceInstant = new Date(interpretation.referenceInstantUtc);
  const referenceCalendarDate = toCalendarDate(
    referenceInstant,
    dateTime.timeZone
  );
  const expectedCalendarDate =
    interpretation.relativeDay === "today"
      ? referenceCalendarDate
      : addCalendarDays(new Date(`${referenceCalendarDate}T00:00:00.000Z`), 1);
  if (
    interpretation.referenceCalendarDate !== referenceCalendarDate ||
    dateTime.calendarDate !== expectedCalendarDate
  ) {
    throw new Error("Persisted Evry confirmation timing is invalid");
  }
}

function assertDateTimeConsistency(
  dateTime: EvryConfirmationDateTimeDocument
): void {
  const { hour, minute } = localTimeParts(dateTime.localTime);
  const candidates = instantsAtZonedTime(
    dateTime.calendarDate,
    hour,
    minute,
    dateTime.timeZone
  );
  if (
    candidates.length !== 1 ||
    candidates[0].toISOString() !== dateTime.instantUtc ||
    utcOffsetForZonedTime(
      dateTime.calendarDate,
      hour,
      minute,
      candidates[0]
    ) !== dateTime.utcOffset
  ) {
    throw new Error("Persisted Evry confirmation timing is invalid");
  }
  assertInterpretationConsistency(dateTime);
}

/** Parse only a trusted persistence row into durable confirmation evidence. */
export function parsePersistedEvryDateBearingConfirmationEvidence(
  value: unknown
): EvryDateBearingConfirmationEvidence {
  const evidence = evryDateBearingConfirmationEvidenceSchema.parse(value);
  assertDateTimeConsistency(evidence.dateTime);
  return evidence;
}
