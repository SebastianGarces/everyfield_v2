import { ZodError, z } from "zod";
import { listLocations } from "@/lib/meetings/locations";
import { createMeeting, getMeeting } from "@/lib/meetings/service";
import { listTeams } from "@/lib/ministry-teams/service";
import {
  getMeetingDraftArtifactPayload,
  getMeetingDraftTitle,
  getMeetingTypeLabel,
  hasMeetingLocation,
  initialAssistantMeetingDraft,
  serializeMeetingDraftForCreate,
  type AssistantMeetingDraft,
  type MeetingDraftArtifactPayload,
  type MeetingDraftMissingField,
} from "./meeting-draft";
import {
  appendAssistantMessage,
  getAssistantThread,
  upsertActiveAssistantArtifact,
} from "./service";
import type { AssistantMessageRecord, AssistantThreadDetail } from "./types";
import {
  AiParseError,
  AiRefusalError,
  generateStructuredObject,
} from "@/lib/ai/client";

const PLANNER_TIMEZONE = "America/Chicago";
const DEFAULT_LOCATION_REFERENCE_PATTERN =
  /\b(default location|usual (?:location|place|spot)|usual venue|same place|same location|same spot|our usual (?:location|place|spot))\b/i;
const SAME_TEAM_REFERENCE_PATTERN =
  /\b(same team|our team|that team|usual team)\b/i;
const RETRY_INSTRUCTION = `
Your previous response did not satisfy the required contract.
Return strict JSON only and preserve all already-known draft fields unless the user changed them.
Do not fabricate locationId or teamId values.
`.trim();

const WEEKDAY_NAMES = [
  "Sunday",
  "Monday",
  "Tuesday",
  "Wednesday",
  "Thursday",
  "Friday",
  "Saturday",
] as const;

const PlannerSavedLocationSchema = z.object({
  id: z.string().uuid(),
  name: z.string().min(1),
  address: z.string().min(1),
});

const PlannerTeamSchema = z.object({
  id: z.string().uuid(),
  name: z.string().min(1),
});

const PlannerDraftSchema = z.object({
  type: z.enum(["vision_meeting", "orientation", "team_meeting"]).nullable(),
  title: z.string().nullable(),
  datetime: z.string().nullable(),
  locationName: z.string().nullable(),
  locationAddress: z.string().nullable(),
  estimatedAttendance: z.number().int().min(0).nullable(),
  durationMinutes: z.number().int().min(1).max(1440).nullable(),
  notes: z.string().nullable(),
  teamName: z.string().nullable(),
  meetingSubtype: z
    .enum(["regular", "training", "planning", "special", "rehearsal"])
    .nullable(),
});

type PlannerSavedLocation = z.infer<typeof PlannerSavedLocationSchema>;
type PlannerTeam = z.infer<typeof PlannerTeamSchema>;
type PlannerDraft = z.infer<typeof PlannerDraftSchema>;

type DeterministicLocationResolution = {
  draft: AssistantMeetingDraft;
  requiresSavedLocationClarification: boolean;
  suggestedSavedLocations: string[];
};

type DeterministicTeamResolution = {
  draft: AssistantMeetingDraft;
  requiresTeamClarification: boolean;
  suggestedTeams: string[];
};

type DeterministicDateTimeClarification = {
  draft: AssistantMeetingDraft;
  pendingDateLabel?: string;
  requiresTimeClarification: boolean;
};

type LocalDateParts = {
  year: number;
  month: number;
  day: number;
};

type PlanMeetingDraftOptions = {
  generatePlannerDraft?: (input: {
    draft: AssistantMeetingDraft;
    messages: AssistantMessageRecord[];
    savedLocations: PlannerSavedLocation[];
    teams: PlannerTeam[];
    now: Date;
    timezone: string;
    retryReason?: string;
  }) => Promise<PlannerDraft>;
};

type PlanMeetingDraftResult = {
  assistantMessage: string;
  artifact: MeetingDraftArtifactPayload;
};

const PLANNER_JSON_SCHEMA = {
  type: "object",
  additionalProperties: false,
  properties: {
    draft: {
      type: "object",
      additionalProperties: false,
      properties: {
        type: {
          type: ["string", "null"],
          enum: ["vision_meeting", "orientation", "team_meeting", null],
        },
        title: {
          type: ["string", "null"],
        },
        datetime: {
          type: ["string", "null"],
          format: "date-time",
        },
        locationName: {
          type: ["string", "null"],
        },
        locationAddress: {
          type: ["string", "null"],
        },
        estimatedAttendance: {
          type: ["integer", "null"],
          minimum: 0,
        },
        durationMinutes: {
          type: ["integer", "null"],
          minimum: 1,
          maximum: 1440,
        },
        notes: {
          type: ["string", "null"],
        },
        teamName: {
          type: ["string", "null"],
        },
        meetingSubtype: {
          type: ["string", "null"],
          enum: [
            "regular",
            "training",
            "planning",
            "special",
            "rehearsal",
            null,
          ],
        },
      },
      required: [
        "type",
        "title",
        "datetime",
        "locationName",
        "locationAddress",
        "estimatedAttendance",
        "durationMinutes",
        "notes",
        "teamName",
        "meetingSubtype",
      ],
    },
  },
  required: ["draft"],
} as const;

const SYSTEM_PROMPT = `
You are the EveryField AI Assistant and you are planning one meeting draft at a time.

Your job:
- Update the provided meeting draft from the conversation.
- Supported meeting types are vision_meeting, orientation, and team_meeting.
- Preserve already-known details unless the user changed them.
- Never claim the meeting has already been created.
- Never invent fields outside the schema.
- If the user clearly references a ministry team, you may set type = team_meeting and set teamName.
- If date or time is ambiguous, prefer leaving datetime null instead of guessing.
- If the user gives a date without a time, do not assume midnight.
- Prefer matching to the provided saved locations and ministry teams by name, but never fabricate IDs.
- Use ISO 8601 UTC for datetime when both the date and time are known.
- Vision meetings should keep title null.
- Team meetings may leave meetingSubtype null if the user does not specify one.
- Return strict JSON only.
`.trim();

function normalizeText(value: string) {
  return value
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function getLatestUserMessage(messages: AssistantMessageRecord[]) {
  return [...messages].reverse().find((message) => message.role === "user")
    ?.content;
}

function clearDraftLocation(
  draft: AssistantMeetingDraft
): AssistantMeetingDraft {
  return {
    ...draft,
    locationId: null,
    locationName: null,
    locationAddress: null,
  };
}

function clearDraftTeam(draft: AssistantMeetingDraft): AssistantMeetingDraft {
  return {
    ...draft,
    teamId: null,
    teamName: null,
  };
}

function clearDraftDateTime(
  draft: AssistantMeetingDraft
): AssistantMeetingDraft {
  return {
    ...draft,
    datetime: null,
  };
}

function getSavedLocationSuggestions(savedLocations: PlannerSavedLocation[]) {
  return savedLocations.slice(0, 3).map((location) => location.name);
}

function getTeamSuggestions(teams: PlannerTeam[]) {
  return teams.slice(0, 3).map((team) => team.name);
}

function isDefaultLocationReference(value: string | null | undefined) {
  if (!value) {
    return false;
  }

  return DEFAULT_LOCATION_REFERENCE_PATTERN.test(value);
}

function isSameTeamReference(value: string | null | undefined) {
  if (!value) {
    return false;
  }

  return SAME_TEAM_REFERENCE_PATTERN.test(value);
}

function rankSavedLocationMatch(value: string, location: PlannerSavedLocation) {
  const normalizedValue = normalizeText(value);

  if (!normalizedValue) {
    return 0;
  }

  const normalizedName = normalizeText(location.name);
  const normalizedAddress = normalizeText(location.address);

  if (normalizedValue === normalizedName) {
    return 100;
  }

  if (normalizedValue === normalizedAddress) {
    return 95;
  }

  if (normalizedValue.includes(normalizedName)) {
    return 90;
  }

  if (normalizedValue.includes(normalizedAddress)) {
    return 85;
  }

  if (normalizedName.includes(normalizedValue) && normalizedValue.length >= 8) {
    return 70;
  }

  return 0;
}

function rankTeamMatch(value: string, team: PlannerTeam) {
  const normalizedValue = normalizeText(value);

  if (!normalizedValue) {
    return 0;
  }

  const normalizedTeamName = normalizeText(team.name);

  if (normalizedValue === normalizedTeamName) {
    return 100;
  }

  if (normalizedValue.includes(normalizedTeamName)) {
    return 92;
  }

  if (
    normalizedTeamName.includes(normalizedValue) &&
    normalizedValue.length >= 5
  ) {
    return 75;
  }

  return 0;
}

function findBestRankedMatch<T extends { id: string }>(
  values: Array<string | null | undefined>,
  items: T[],
  rank: (value: string, item: T) => number
) {
  const scores = new Map<string, number>();

  for (const value of values) {
    if (!value) {
      continue;
    }

    for (const item of items) {
      const score = rank(value, item);

      if (score === 0) {
        continue;
      }

      const previousScore = scores.get(item.id) ?? 0;
      scores.set(item.id, Math.max(previousScore, score));
    }
  }

  const rankedItems = items
    .map((item) => ({
      item,
      score: scores.get(item.id) ?? 0,
    }))
    .filter((entry) => entry.score > 0)
    .sort((left, right) => right.score - left.score);

  if (rankedItems.length === 0) {
    return { match: null, ambiguous: false };
  }

  if (
    rankedItems.length > 1 &&
    rankedItems[0]?.score === rankedItems[1]?.score
  ) {
    return { match: null, ambiguous: true };
  }

  return { match: rankedItems[0]?.item ?? null, ambiguous: false };
}

function getTimezoneDateParts(date: Date, timezone: string) {
  return new Intl.DateTimeFormat("en-US", {
    timeZone: timezone,
    weekday: "long",
    year: "numeric",
    month: "long",
    day: "numeric",
  }).formatToParts(date);
}

function formatWeekdayAnchor(date: Date, timezone: string) {
  const parts = getTimezoneDateParts(date, timezone);

  const weekday =
    parts.find((part) => part.type === "weekday")?.value ?? "Unknown";
  const month = parts.find((part) => part.type === "month")?.value ?? "Unknown";
  const day = parts.find((part) => part.type === "day")?.value ?? "0";
  const year = parts.find((part) => part.type === "year")?.value ?? "0000";

  return `${weekday}, ${month} ${day}, ${year}`;
}

function getLocalDateParts(date: Date, timezone: string): LocalDateParts {
  const formatter = new Intl.DateTimeFormat("en-US", {
    timeZone: timezone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  });
  const parts = formatter.formatToParts(date);

  return {
    year: Number(parts.find((part) => part.type === "year")?.value ?? "0"),
    month: Number(parts.find((part) => part.type === "month")?.value ?? "0"),
    day: Number(parts.find((part) => part.type === "day")?.value ?? "0"),
  };
}

function addDaysToLocalDate(
  date: LocalDateParts,
  days: number
): LocalDateParts {
  const shiftedDate = new Date(
    Date.UTC(date.year, date.month - 1, date.day + days)
  );

  return {
    year: shiftedDate.getUTCFullYear(),
    month: shiftedDate.getUTCMonth() + 1,
    day: shiftedDate.getUTCDate(),
  };
}

function resolveWeekdayDeltaFromToday(
  currentWeekdayIndex: number,
  targetWeekdayIndex: number,
  message: string
) {
  const normalizedMessage = message.toLowerCase();
  const baseDelta = (targetWeekdayIndex - currentWeekdayIndex + 7) % 7;

  if (/\bnext\s+/.test(normalizedMessage)) {
    return baseDelta === 0 ? 7 : baseDelta;
  }

  if (/\bthis\s+/.test(normalizedMessage)) {
    return baseDelta;
  }

  return baseDelta === 0 ? 7 : baseDelta;
}

function getZonedDateTimeParts(date: Date, timezone: string) {
  const formatter = new Intl.DateTimeFormat("en-US", {
    timeZone: timezone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  });
  const parts = formatter.formatToParts(date);

  return {
    year: Number(parts.find((part) => part.type === "year")?.value ?? "0"),
    month: Number(parts.find((part) => part.type === "month")?.value ?? "0"),
    day: Number(parts.find((part) => part.type === "day")?.value ?? "0"),
    hour: Number(parts.find((part) => part.type === "hour")?.value ?? "0"),
    minute: Number(parts.find((part) => part.type === "minute")?.value ?? "0"),
    second: Number(parts.find((part) => part.type === "second")?.value ?? "0"),
  };
}

function zonedDateTimeToUtcIso(
  localDate: LocalDateParts,
  localTime: { hour: number; minute: number },
  timezone: string
) {
  let guess = Date.UTC(
    localDate.year,
    localDate.month - 1,
    localDate.day,
    localTime.hour,
    localTime.minute,
    0
  );
  const targetUtcComparable = Date.UTC(
    localDate.year,
    localDate.month - 1,
    localDate.day,
    localTime.hour,
    localTime.minute,
    0
  );

  for (let attempt = 0; attempt < 3; attempt += 1) {
    const zonedParts = getZonedDateTimeParts(new Date(guess), timezone);
    const zonedComparable = Date.UTC(
      zonedParts.year,
      zonedParts.month - 1,
      zonedParts.day,
      zonedParts.hour,
      zonedParts.minute,
      zonedParts.second
    );
    const diff = targetUtcComparable - zonedComparable;

    if (diff === 0) {
      return new Date(guess).toISOString();
    }

    guess += diff;
  }

  return new Date(guess).toISOString();
}

function extractSchedulingDateIntent(message: string): {
  deltaDaysFromToday: number;
} | null {
  const normalizedMessage = message.toLowerCase();

  if (/\btoday\b/.test(normalizedMessage)) {
    return { deltaDaysFromToday: 0 };
  }

  if (/\btomorrow\b/.test(normalizedMessage)) {
    return { deltaDaysFromToday: 1 };
  }

  const weekdayMatch = normalizedMessage.match(
    /\b(?:next|on|this|make it)?\s*(monday|tuesday|wednesday|thursday|friday|saturday|sunday)\b/
  );

  if (!weekdayMatch) {
    return null;
  }

  const matchedWeekday = weekdayMatch[1];
  const targetWeekdayIndex = WEEKDAY_NAMES.findIndex(
    (weekday) => weekday.toLowerCase() === matchedWeekday
  );

  if (targetWeekdayIndex === -1) {
    return null;
  }

  return {
    deltaDaysFromToday: targetWeekdayIndex,
  };
}

function extractSchedulingTimeIntent(message: string) {
  const normalizedMessage = message.toLowerCase();

  if (/\bmidnight\b/.test(normalizedMessage)) {
    return { hour: 0, minute: 0 };
  }

  if (/\bnoon\b/.test(normalizedMessage)) {
    return { hour: 12, minute: 0 };
  }

  const twelveHourMatch = normalizedMessage.match(
    /\b(?:at\s*)?(\d{1,2})(?::(\d{2}))?\s*(am|pm)\b/
  );

  if (twelveHourMatch) {
    const hour = Number(twelveHourMatch[1]);
    const minute = Number(twelveHourMatch[2] ?? "0");
    const meridiem = twelveHourMatch[3];
    const normalizedHour =
      meridiem === "pm" && hour !== 12
        ? hour + 12
        : meridiem === "am" && hour === 12
          ? 0
          : hour;

    return { hour: normalizedHour, minute };
  }

  const twentyFourHourMatch = normalizedMessage.match(
    /\b(?:at\s*)?([01]?\d|2[0-3]):([0-5]\d)\b/
  );

  if (!twentyFourHourMatch) {
    return null;
  }

  return {
    hour: Number(twentyFourHourMatch[1]),
    minute: Number(twentyFourHourMatch[2]),
  };
}

function extractEstimatedAttendanceIntent(message: string) {
  const match = message.match(
    /\b(\d{1,4})\s*(?:people|ppl|persons|attendees|guests)\b/i
  );

  if (!match) {
    return null;
  }

  return Number(match[1]);
}

function extractNotesIntent(message: string) {
  const noteMatch = message.match(/\bnotes?:\s*(.+)$/i);

  if (!noteMatch) {
    return null;
  }

  const note = noteMatch[1]?.trim();
  return note ? note : null;
}

function extractDurationIntent(message: string) {
  const minuteMatch = message.match(
    /\b(\d{1,4})\s*(?:minutes|minute|mins|min)\b/i
  );

  if (minuteMatch) {
    return Number(minuteMatch[1]);
  }

  const hourMatch = message.match(/\b(\d(?:\.\d)?)\s*hours?\b/i);

  if (!hourMatch) {
    return null;
  }

  return Math.round(Number(hourMatch[1]) * 60);
}

function hasExplicitDateReference(message: string) {
  return (
    extractSchedulingDateIntent(message) !== null ||
    /\b(?:jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|jun(?:e)?|jul(?:y)?|aug(?:ust)?|sep(?:t(?:ember)?)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)\b/i.test(
      message
    ) ||
    /\b\d{1,2}[/-]\d{1,2}(?:[/-]\d{2,4})?\b/.test(message) ||
    /\b\d{4}-\d{2}-\d{2}\b/.test(message)
  );
}

function formatDateOnlyLabel(datetime: string, timezone: string) {
  return new Date(datetime).toLocaleDateString("en-US", {
    weekday: "long",
    year: "numeric",
    month: "long",
    day: "numeric",
    timeZone: timezone,
  });
}

function resolveDeterministicDateLabel(params: {
  message: string;
  now: Date;
  timezone: string;
}) {
  const dateIntent = extractSchedulingDateIntent(params.message);

  if (!dateIntent) {
    return undefined;
  }

  const currentWeekday = new Intl.DateTimeFormat("en-US", {
    timeZone: params.timezone,
    weekday: "long",
  }).format(params.now);
  const currentWeekdayIndex = WEEKDAY_NAMES.findIndex(
    (weekday) => weekday === currentWeekday
  );

  if (currentWeekdayIndex === -1) {
    return undefined;
  }

  const normalizedMessage = params.message.toLowerCase();
  const matchedWeekday = normalizedMessage.match(
    /\b(?:next|on|this|make it)?\s*(monday|tuesday|wednesday|thursday|friday|saturday|sunday)\b/
  )?.[1];

  let deltaDaysFromToday = dateIntent.deltaDaysFromToday;

  if (matchedWeekday) {
    const targetWeekdayIndex = WEEKDAY_NAMES.findIndex(
      (weekday) => weekday.toLowerCase() === matchedWeekday
    );

    if (targetWeekdayIndex !== -1) {
      deltaDaysFromToday = resolveWeekdayDeltaFromToday(
        currentWeekdayIndex,
        targetWeekdayIndex,
        params.message
      );
    }
  }

  const todayLocalDate = getLocalDateParts(params.now, params.timezone);
  const targetLocalDate = addDaysToLocalDate(
    todayLocalDate,
    deltaDaysFromToday
  );

  return new Intl.DateTimeFormat("en-US", {
    weekday: "long",
    year: "numeric",
    month: "long",
    day: "numeric",
    timeZone: params.timezone,
  }).format(
    new Date(
      Date.UTC(
        targetLocalDate.year,
        targetLocalDate.month - 1,
        targetLocalDate.day,
        12,
        0,
        0
      )
    )
  );
}

function buildRelativeDateAnchors(now: Date, timezone: string) {
  const currentWeekday = new Intl.DateTimeFormat("en-US", {
    timeZone: timezone,
    weekday: "long",
  }).format(now);
  const currentWeekdayIndex = WEEKDAY_NAMES.findIndex(
    (weekday) => weekday === currentWeekday
  );

  return WEEKDAY_NAMES.map((weekday, targetIndex) => {
    const delta =
      currentWeekdayIndex === -1
        ? targetIndex
        : (targetIndex - currentWeekdayIndex + 7) % 7 || 7;
    const targetDate = new Date(now.getTime() + delta * 24 * 60 * 60 * 1000);

    return `"next ${weekday.toLowerCase()}" => ${formatWeekdayAnchor(targetDate, timezone)}`;
  });
}

function normalizeDraft(draft: AssistantMeetingDraft): AssistantMeetingDraft {
  const normalizedType = draft.type ?? null;

  return {
    type: normalizedType,
    title:
      normalizedType === "vision_meeting" ? null : draft.title?.trim() || null,
    datetime: draft.datetime ? new Date(draft.datetime).toISOString() : null,
    locationId: draft.locationId ?? null,
    locationName: draft.locationName?.trim() || null,
    locationAddress: draft.locationAddress?.trim() || null,
    estimatedAttendance: draft.estimatedAttendance ?? null,
    durationMinutes:
      normalizedType === "vision_meeting"
        ? null
        : (draft.durationMinutes ?? null),
    notes: draft.notes?.trim() || null,
    teamId: normalizedType === "team_meeting" ? (draft.teamId ?? null) : null,
    teamName:
      normalizedType === "team_meeting" ? draft.teamName?.trim() || null : null,
    meetingSubtype:
      normalizedType === "team_meeting"
        ? (draft.meetingSubtype ?? "regular")
        : null,
  };
}

function maybeInferMeetingType(params: {
  currentDraft: AssistantMeetingDraft;
  messages: AssistantMessageRecord[];
}) {
  const latestUserMessage = getLatestUserMessage(params.messages);

  if (!latestUserMessage) {
    return params.currentDraft;
  }

  if (/\bvision meeting\b/i.test(latestUserMessage)) {
    return normalizeDraft({
      ...params.currentDraft,
      type: "vision_meeting",
    });
  }

  if (/\borientation\b/i.test(latestUserMessage)) {
    return normalizeDraft({
      ...params.currentDraft,
      type: "orientation",
    });
  }

  if (/\bteam meeting\b/i.test(latestUserMessage)) {
    return normalizeDraft({
      ...params.currentDraft,
      type: "team_meeting",
    });
  }

  return params.currentDraft;
}

function maybeApplyDeterministicSchedulingDateTime(params: {
  currentDraft: AssistantMeetingDraft;
  messages: AssistantMessageRecord[];
  now: Date;
  timezone: string;
}) {
  const latestUserMessage = getLatestUserMessage(params.messages);

  if (!latestUserMessage) {
    return params.currentDraft;
  }

  const dateIntent = extractSchedulingDateIntent(latestUserMessage);
  const timeIntent = extractSchedulingTimeIntent(latestUserMessage);

  if (!dateIntent || !timeIntent) {
    return params.currentDraft;
  }

  const currentWeekday = new Intl.DateTimeFormat("en-US", {
    timeZone: params.timezone,
    weekday: "long",
  }).format(params.now);
  const currentWeekdayIndex = WEEKDAY_NAMES.findIndex(
    (weekday) => weekday === currentWeekday
  );

  if (currentWeekdayIndex === -1) {
    return params.currentDraft;
  }

  const normalizedMessage = latestUserMessage.toLowerCase();
  const matchedWeekday = normalizedMessage.match(
    /\b(?:next|on|this|make it)?\s*(monday|tuesday|wednesday|thursday|friday|saturday|sunday)\b/
  )?.[1];

  let deltaDaysFromToday = dateIntent.deltaDaysFromToday;

  if (matchedWeekday) {
    const targetWeekdayIndex = WEEKDAY_NAMES.findIndex(
      (weekday) => weekday.toLowerCase() === matchedWeekday
    );

    if (targetWeekdayIndex !== -1) {
      deltaDaysFromToday = resolveWeekdayDeltaFromToday(
        currentWeekdayIndex,
        targetWeekdayIndex,
        latestUserMessage
      );
    }
  }

  const todayLocalDate = getLocalDateParts(params.now, params.timezone);
  const targetLocalDate = addDaysToLocalDate(
    todayLocalDate,
    deltaDaysFromToday
  );
  const deterministicDateTime = zonedDateTimeToUtcIso(
    targetLocalDate,
    timeIntent,
    params.timezone
  );

  return {
    ...params.currentDraft,
    datetime: deterministicDateTime,
  };
}

function maybePreventImplicitDateTimeAssumptions(params: {
  currentDraft: AssistantMeetingDraft;
  previousDraft: AssistantMeetingDraft;
  messages: AssistantMessageRecord[];
  now: Date;
  timezone: string;
}): DeterministicDateTimeClarification {
  const latestUserMessage = getLatestUserMessage(params.messages);

  if (!latestUserMessage) {
    return {
      draft: params.currentDraft,
      requiresTimeClarification: false,
    };
  }

  if (!params.currentDraft.datetime) {
    if (
      !extractSchedulingTimeIntent(latestUserMessage) &&
      hasExplicitDateReference(latestUserMessage)
    ) {
      return {
        draft: params.currentDraft,
        pendingDateLabel: resolveDeterministicDateLabel({
          message: latestUserMessage,
          now: params.now,
          timezone: params.timezone,
        }),
        requiresTimeClarification: true,
      };
    }

    return {
      draft: params.currentDraft,
      requiresTimeClarification: false,
    };
  }

  if (extractSchedulingTimeIntent(latestUserMessage)) {
    return {
      draft: params.currentDraft,
      requiresTimeClarification: false,
    };
  }

  if (params.currentDraft.datetime === params.previousDraft.datetime) {
    return {
      draft: params.currentDraft,
      requiresTimeClarification: false,
    };
  }

  if (!hasExplicitDateReference(latestUserMessage)) {
    return {
      draft: clearDraftDateTime(params.currentDraft),
      requiresTimeClarification: false,
    };
  }

  return {
    draft: clearDraftDateTime(params.currentDraft),
    pendingDateLabel:
      resolveDeterministicDateLabel({
        message: latestUserMessage,
        now: params.now,
        timezone: params.timezone,
      }) ?? formatDateOnlyLabel(params.currentDraft.datetime, params.timezone),
    requiresTimeClarification: true,
  };
}

function maybeApplyDeterministicLocationResolution(params: {
  currentDraft: AssistantMeetingDraft;
  messages: AssistantMessageRecord[];
  savedLocations: PlannerSavedLocation[];
}): DeterministicLocationResolution {
  const latestUserMessage = getLatestUserMessage(params.messages);
  const suggestedSavedLocations = getSavedLocationSuggestions(
    params.savedLocations
  );
  const locationCandidateTexts = [
    params.currentDraft.locationName,
    params.currentDraft.locationAddress,
    latestUserMessage,
  ];
  const referencesDefaultLocation = locationCandidateTexts.some((value) =>
    isDefaultLocationReference(value)
  );

  if (referencesDefaultLocation) {
    if (
      params.currentDraft.locationId &&
      params.currentDraft.locationName &&
      params.currentDraft.locationAddress
    ) {
      return {
        draft: params.currentDraft,
        requiresSavedLocationClarification: false,
        suggestedSavedLocations,
      };
    }

    if (params.savedLocations.length === 1) {
      const [savedLocation] = params.savedLocations;

      return {
        draft: {
          ...params.currentDraft,
          locationId: savedLocation.id,
          locationName: savedLocation.name,
          locationAddress: savedLocation.address,
        },
        requiresSavedLocationClarification: false,
        suggestedSavedLocations,
      };
    }

    return {
      draft: clearDraftLocation(params.currentDraft),
      requiresSavedLocationClarification: params.savedLocations.length > 1,
      suggestedSavedLocations,
    };
  }

  const locationMatch = findBestRankedMatch(
    locationCandidateTexts,
    params.savedLocations,
    rankSavedLocationMatch
  );

  if (locationMatch.match) {
    return {
      draft: {
        ...params.currentDraft,
        locationId: locationMatch.match.id,
        locationName: locationMatch.match.name,
        locationAddress: locationMatch.match.address,
      },
      requiresSavedLocationClarification: false,
      suggestedSavedLocations,
    };
  }

  return {
    draft: locationMatch.ambiguous
      ? clearDraftLocation(params.currentDraft)
      : params.currentDraft,
    requiresSavedLocationClarification: locationMatch.ambiguous,
    suggestedSavedLocations,
  };
}

function maybeApplyDeterministicTeamResolution(params: {
  currentDraft: AssistantMeetingDraft;
  messages: AssistantMessageRecord[];
  teams: PlannerTeam[];
}): DeterministicTeamResolution {
  const latestUserMessage = getLatestUserMessage(params.messages);
  const suggestedTeams = getTeamSuggestions(params.teams);

  if (!latestUserMessage) {
    return {
      draft: params.currentDraft,
      requiresTeamClarification: false,
      suggestedTeams,
    };
  }

  const teamCandidateTexts = [params.currentDraft.teamName, latestUserMessage];

  if (teamCandidateTexts.some((value) => isSameTeamReference(value))) {
    if (params.currentDraft.teamId && params.currentDraft.teamName) {
      return {
        draft: {
          ...params.currentDraft,
          type: params.currentDraft.type ?? "team_meeting",
        },
        requiresTeamClarification: false,
        suggestedTeams,
      };
    }
  }

  const teamMatch = findBestRankedMatch(
    teamCandidateTexts,
    params.teams,
    rankTeamMatch
  );

  if (teamMatch.match) {
    return {
      draft: normalizeDraft({
        ...params.currentDraft,
        type:
          params.currentDraft.type === "orientation"
            ? "orientation"
            : "team_meeting",
        teamId: teamMatch.match.id,
        teamName: teamMatch.match.name,
      }),
      requiresTeamClarification: false,
      suggestedTeams,
    };
  }

  return {
    draft: teamMatch.ambiguous
      ? clearDraftTeam(
          normalizeDraft({
            ...params.currentDraft,
            type:
              params.currentDraft.type === "team_meeting"
                ? "team_meeting"
                : params.currentDraft.type,
          })
        )
      : params.currentDraft,
    requiresTeamClarification: teamMatch.ambiguous,
    suggestedTeams,
  };
}

function maybeApplyDeterministicMeetingMetadata(params: {
  currentDraft: AssistantMeetingDraft;
  messages: AssistantMessageRecord[];
}) {
  const latestUserMessage = getLatestUserMessage(params.messages);

  if (!latestUserMessage) {
    return params.currentDraft;
  }

  return {
    ...params.currentDraft,
    estimatedAttendance:
      params.currentDraft.estimatedAttendance ??
      extractEstimatedAttendanceIntent(latestUserMessage),
    durationMinutes:
      params.currentDraft.durationMinutes ??
      extractDurationIntent(latestUserMessage),
    notes: params.currentDraft.notes ?? extractNotesIntent(latestUserMessage),
  };
}

function computeMeetingDraftState(draft: AssistantMeetingDraft) {
  const missingFields = [
    !draft.type ? "meetingType" : null,
    !draft.datetime ? "datetime" : null,
    !hasMeetingLocation(draft) ? "location" : null,
    draft.type === "team_meeting" && !draft.teamId ? "team" : null,
  ].filter(Boolean) as MeetingDraftMissingField[];

  return {
    missingFields,
    readyToCreate: missingFields.length === 0,
  };
}

function buildInterpretation(
  draft: AssistantMeetingDraft,
  pendingDateLabel?: string
) {
  return {
    meetingTypeLabel: draft.type ? getMeetingTypeLabel(draft.type) : undefined,
    titleLabel: draft.type ? getMeetingDraftTitle(draft) : undefined,
    dateLabel: pendingDateLabel,
    datetimeLabel: draft.datetime
      ? new Date(draft.datetime).toLocaleString("en-US", {
          weekday: "long",
          year: "numeric",
          month: "long",
          day: "numeric",
          hour: "numeric",
          minute: "2-digit",
          timeZone: PLANNER_TIMEZONE,
          timeZoneName: "short",
        })
      : undefined,
    locationLabel:
      [draft.locationName, draft.locationAddress].filter(Boolean).join(", ") ||
      undefined,
    teamLabel: draft.teamName || undefined,
  };
}

function buildMeetingAssistantMessage(params: {
  draft: AssistantMeetingDraft;
  missingFields: MeetingDraftMissingField[];
  readyToCreate: boolean;
  pendingDateLabel?: string;
  interpretation: ReturnType<typeof buildInterpretation>;
  requiresSavedLocationClarification: boolean;
  suggestedSavedLocations: string[];
  requiresTeamClarification: boolean;
  suggestedTeams: string[];
  requiresTimeClarification: boolean;
}) {
  if (!params.readyToCreate) {
    if (params.missingFields.includes("meetingType")) {
      const knownDetails = [
        params.interpretation.datetimeLabel ?? params.pendingDateLabel,
        params.interpretation.locationLabel,
      ].filter(Boolean);

      if (knownDetails.length > 0) {
        return `I have ${knownDetails.join(" and ")}. Is this a vision meeting, orientation, or team meeting?`;
      }

      return "What kind of meeting is this: vision meeting, orientation, or team meeting?";
    }

    if (params.missingFields.includes("team")) {
      if (params.requiresTeamClarification) {
        return params.suggestedTeams.length > 0
          ? `I found multiple ministry teams that could match. Which team should I use: ${params.suggestedTeams.join(", ")}?`
          : "Which ministry team is this meeting for?";
      }

      return "Which ministry team is this meeting for?";
    }

    if (params.missingFields.includes("location")) {
      if (params.requiresSavedLocationClarification) {
        return params.suggestedSavedLocations.length > 0
          ? `I found multiple saved locations. Which one should I use: ${params.suggestedSavedLocations.join(", ")}?`
          : "I couldn’t tell which saved location you meant. Please name it or give me the full address.";
      }

      if (
        params.draft.locationName &&
        !params.draft.locationId &&
        !params.draft.locationAddress
      ) {
        return `I have the location name set to ${params.draft.locationName}. What address should I use?`;
      }

      if (params.pendingDateLabel) {
        return `I have the date set for ${params.pendingDateLabel}. What location should I use?`;
      }

      return `I have the date and time set for ${params.interpretation.datetimeLabel ?? "this meeting"}. What location should I use?`;
    }

    if (params.missingFields.includes("datetime")) {
      if (params.requiresTimeClarification && params.pendingDateLabel) {
        if (params.interpretation.locationLabel) {
          return `I have the date set for ${params.pendingDateLabel} and the location set to ${params.interpretation.locationLabel}. What time should I use?`;
        }

        return `I have the date set for ${params.pendingDateLabel}. What time should I use?`;
      }

      if (params.interpretation.locationLabel) {
        return `I have the location set to ${params.interpretation.locationLabel}. What date and time should I use?`;
      }

      return "What date and time should I use?";
    }
  }

  const meetingTypeLabel =
    params.interpretation.meetingTypeLabel?.toLowerCase() ?? "meeting";

  return `I have enough to create this ${meetingTypeLabel}. Review the draft and use Create meeting when you’re ready.`;
}

async function defaultGeneratePlannerDraft(input: {
  draft: AssistantMeetingDraft;
  messages: AssistantMessageRecord[];
  savedLocations: PlannerSavedLocation[];
  teams: PlannerTeam[];
  now: Date;
  timezone: string;
  retryReason?: string;
}) {
  const response = await generateStructuredObject<{ draft: PlannerDraft }>({
    system: SYSTEM_PROMPT,
    prompt: `
Today: ${input.now.toISOString()}
Today in ${input.timezone}: ${input.now.toLocaleString("en-US", {
      weekday: "long",
      year: "numeric",
      month: "long",
      day: "numeric",
      timeZone: input.timezone,
    })}
Timezone assumption: ${input.timezone}
Relative date anchors in ${input.timezone}:
${buildRelativeDateAnchors(input.now, input.timezone)
  .map((anchor) => `- ${anchor}`)
  .join("\n")}

Saved church locations:
${
  input.savedLocations.length > 0
    ? input.savedLocations
        .map((location) => `- ${location.name} — ${location.address}`)
        .join("\n")
    : "- No saved locations available"
}

Ministry teams:
${
  input.teams.length > 0
    ? input.teams.map((team) => `- ${team.name}`).join("\n")
    : "- No teams available"
}

Current draft:
${JSON.stringify(input.draft, null, 2)}

Conversation:
${JSON.stringify(input.messages, null, 2)}

${input.retryReason ? `Retry instruction: ${input.retryReason}` : ""}
    `.trim(),
    schemaName: "assistant_meeting_planner",
    jsonSchema: PLANNER_JSON_SCHEMA,
    temperature: 0.1,
    maxOutputTokens: 800,
  });

  return PlannerDraftSchema.parse(response.draft);
}

function plannerDraftToAssistantDraft(
  draft: PlannerDraft,
  currentDraft: AssistantMeetingDraft
): AssistantMeetingDraft {
  return normalizeDraft({
    ...currentDraft,
    type: draft.type,
    title: draft.title,
    datetime: draft.datetime,
    locationId: null,
    locationName: draft.locationName,
    locationAddress: draft.locationAddress,
    estimatedAttendance: draft.estimatedAttendance,
    durationMinutes: draft.durationMinutes,
    notes: draft.notes,
    teamId: null,
    teamName: draft.teamName,
    meetingSubtype: draft.meetingSubtype,
  });
}

export function shouldRouteToMeetingPlanner(params: {
  message: string;
  teams: PlannerTeam[];
  savedLocations: PlannerSavedLocation[];
}) {
  if (
    /\b(meeting|schedule|set up|setup|orientation|vision)\b/i.test(
      params.message
    )
  ) {
    return true;
  }

  if (extractSchedulingDateIntent(params.message)) {
    return true;
  }

  if (extractSchedulingTimeIntent(params.message)) {
    return true;
  }

  if (
    findBestRankedMatch([params.message], params.teams, rankTeamMatch).match
  ) {
    return true;
  }

  if (
    findBestRankedMatch(
      [params.message],
      params.savedLocations,
      rankSavedLocationMatch
    ).match
  ) {
    return true;
  }

  return false;
}

export async function planAssistantMeetingDraft(params: {
  currentDraft?: AssistantMeetingDraft;
  messages: AssistantMessageRecord[];
  savedLocations: PlannerSavedLocation[];
  teams: PlannerTeam[];
  now?: Date;
  timezone?: string;
  options?: PlanMeetingDraftOptions;
}): Promise<PlanMeetingDraftResult> {
  const now = params.now ?? new Date();
  const timezone = params.timezone ?? PLANNER_TIMEZONE;
  const currentDraft = params.currentDraft ?? initialAssistantMeetingDraft;

  let nextDraft = currentDraft;
  let lastRecoverableError: AiParseError | AiRefusalError | ZodError | null =
    null;

  const generatePlannerDraft =
    params.options?.generatePlannerDraft ?? defaultGeneratePlannerDraft;

  for (const retryReason of [undefined, RETRY_INSTRUCTION]) {
    try {
      const modelDraft = await generatePlannerDraft({
        draft: currentDraft,
        messages: params.messages,
        savedLocations: params.savedLocations,
        teams: params.teams,
        now,
        timezone,
        retryReason,
      });

      nextDraft = plannerDraftToAssistantDraft(modelDraft, currentDraft);
      break;
    } catch (error) {
      if (
        error instanceof AiParseError ||
        error instanceof AiRefusalError ||
        error instanceof ZodError ||
        (error instanceof Error &&
          error.message.startsWith("Missing OPENROUTER_API_KEY"))
      ) {
        lastRecoverableError =
          error instanceof ZodError
            ? error
            : error instanceof AiParseError || error instanceof AiRefusalError
              ? error
              : new AiParseError(error.message);
        nextDraft = currentDraft;
        continue;
      }

      throw error;
    }
  }

  const inferredTypeDraft = maybeInferMeetingType({
    currentDraft: nextDraft,
    messages: params.messages,
  });
  const draftWithDateTime = maybeApplyDeterministicSchedulingDateTime({
    currentDraft: inferredTypeDraft,
    messages: params.messages,
    now,
    timezone,
  });
  const dateTimeClarification = maybePreventImplicitDateTimeAssumptions({
    currentDraft: draftWithDateTime,
    previousDraft: currentDraft,
    messages: params.messages,
    now,
    timezone,
  });
  const locationResolution = maybeApplyDeterministicLocationResolution({
    currentDraft: dateTimeClarification.draft,
    messages: params.messages,
    savedLocations: params.savedLocations,
  });
  const teamResolution = maybeApplyDeterministicTeamResolution({
    currentDraft: locationResolution.draft,
    messages: params.messages,
    teams: params.teams,
  });
  const draft = maybeApplyDeterministicMeetingMetadata({
    currentDraft: normalizeDraft(teamResolution.draft),
    messages: params.messages,
  });
  const state = computeMeetingDraftState(draft);
  const interpretation = buildInterpretation(
    draft,
    dateTimeClarification.pendingDateLabel
  );

  if (lastRecoverableError) {
    console.warn(
      "[ASSISTANT_MEETING_ORCHESTRATOR] Recoverable planner failure:",
      lastRecoverableError
    );
  }

  return {
    assistantMessage: buildMeetingAssistantMessage({
      draft,
      missingFields: state.missingFields,
      readyToCreate: state.readyToCreate,
      pendingDateLabel: dateTimeClarification.pendingDateLabel,
      interpretation,
      requiresSavedLocationClarification:
        locationResolution.requiresSavedLocationClarification,
      suggestedSavedLocations: locationResolution.suggestedSavedLocations,
      requiresTeamClarification: teamResolution.requiresTeamClarification,
      suggestedTeams: teamResolution.suggestedTeams,
      requiresTimeClarification:
        dateTimeClarification.requiresTimeClarification,
    }),
    artifact: {
      type: "meeting_draft",
      status: state.readyToCreate ? "ready" : "collecting",
      draft,
      missingFields: state.missingFields,
      interpretation,
      createdMeetingId: null,
      createdMeetingHref: null,
    },
  };
}

function getCreatedMeetingMessage(meetingId: string, title: string) {
  return {
    content: `${title} is created and ready to open in a new tab.`,
    metadata: {
      actions: [
        {
          label: "Open meeting",
          href: `/meetings/${meetingId}`,
          target: "_blank",
        },
      ],
    } satisfies Record<string, unknown>,
  };
}

export async function handleAssistantConversationTurn(params: {
  churchId: string;
  userId: string;
  threadId: string;
  content: string;
  options?: PlanMeetingDraftOptions;
}): Promise<AssistantThreadDetail> {
  await appendAssistantMessage({
    churchId: params.churchId,
    userId: params.userId,
    threadId: params.threadId,
    role: "user",
    content: params.content,
  });

  const detail = await getAssistantThread(
    params.churchId,
    params.userId,
    params.threadId
  );

  if (!detail) {
    throw new Error("Assistant thread not found");
  }

  const savedLocations = (await listLocations(params.churchId)).map(
    (location) =>
      PlannerSavedLocationSchema.parse({
        id: location.id,
        name: location.name,
        address: location.address,
      })
  );
  const teams = (await listTeams(params.churchId)).map((team) =>
    PlannerTeamSchema.parse({
      id: team.id,
      name: team.name,
    })
  );
  const activeMeetingArtifact = getMeetingDraftArtifactPayload(
    detail.artifacts
  );
  const shouldPlanMeeting =
    !!activeMeetingArtifact ||
    shouldRouteToMeetingPlanner({
      message: params.content,
      teams,
      savedLocations,
    });

  if (!shouldPlanMeeting) {
    await appendAssistantMessage({
      churchId: params.churchId,
      userId: params.userId,
      threadId: params.threadId,
      role: "assistant",
      content:
        "I can help schedule a vision meeting, orientation, or team meeting from here. Tell me what you want to set up, and include the date, time, or location if you know it.",
    });
  } else {
    const planningResult = await planAssistantMeetingDraft({
      currentDraft:
        activeMeetingArtifact?.status === "created"
          ? initialAssistantMeetingDraft
          : activeMeetingArtifact?.draft,
      messages: detail.messages,
      savedLocations,
      teams,
      options: params.options,
    });

    await upsertActiveAssistantArtifact({
      churchId: params.churchId,
      userId: params.userId,
      threadId: params.threadId,
      kind: "meeting_draft",
      payload: planningResult.artifact,
      status: "active",
    });

    await appendAssistantMessage({
      churchId: params.churchId,
      userId: params.userId,
      threadId: params.threadId,
      role: "assistant",
      content: planningResult.assistantMessage,
    });
  }

  const updatedThread = await getAssistantThread(
    params.churchId,
    params.userId,
    params.threadId
  );

  if (!updatedThread) {
    throw new Error("Assistant thread not found");
  }

  return updatedThread;
}

export async function createMeetingFromAssistantThread(params: {
  churchId: string;
  userId: string;
  threadId: string;
}) {
  const detail = await getAssistantThread(
    params.churchId,
    params.userId,
    params.threadId
  );

  if (!detail) {
    throw new Error("Assistant thread not found");
  }

  const activeMeetingArtifact = getMeetingDraftArtifactPayload(
    detail.artifacts
  );

  if (!activeMeetingArtifact) {
    throw new Error("No meeting draft found");
  }

  if (activeMeetingArtifact.status === "created") {
    throw new Error("Meeting has already been created");
  }

  if (activeMeetingArtifact.status !== "ready") {
    throw new Error("Meeting draft is not ready to create");
  }

  const payload = serializeMeetingDraftForCreate(activeMeetingArtifact.draft);
  const meeting = await createMeeting(params.churchId, params.userId, payload);
  const persistedMeeting = await getMeeting(params.churchId, meeting.id);
  const title =
    persistedMeeting?.title ??
    meeting.title ??
    getMeetingDraftTitle(activeMeetingArtifact.draft);
  const updatedArtifact = {
    ...activeMeetingArtifact,
    status: "created" as const,
    draft: {
      ...activeMeetingArtifact.draft,
      title:
        activeMeetingArtifact.draft.type === "vision_meeting" ? null : title,
    },
    interpretation: {
      ...activeMeetingArtifact.interpretation,
      titleLabel: title,
    },
    createdMeetingId: meeting.id,
    createdMeetingHref: `/meetings/${meeting.id}`,
  };

  await upsertActiveAssistantArtifact({
    churchId: params.churchId,
    userId: params.userId,
    threadId: params.threadId,
    kind: "meeting_draft",
    payload: updatedArtifact,
    status: "completed",
  });

  const createdMessage = getCreatedMeetingMessage(meeting.id, title);
  await appendAssistantMessage({
    churchId: params.churchId,
    userId: params.userId,
    threadId: params.threadId,
    role: "assistant",
    content: createdMessage.content,
    metadata: createdMessage.metadata,
  });

  const updatedThread = await getAssistantThread(
    params.churchId,
    params.userId,
    params.threadId
  );

  if (!updatedThread) {
    throw new Error("Assistant thread not found");
  }

  return updatedThread;
}
