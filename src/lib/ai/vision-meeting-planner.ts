import {
  PlannerModelResponseSchema,
  PlannerResponseSchema,
  type PlannerMessage,
  type VisionMeetingDraft,
} from "./vision-meeting-planner-schema";
import { ZodError } from "zod";
import {
  AiParseError,
  AiRefusalError,
  generateStructuredObject,
} from "./client";

const SYSTEM_PROMPT = `
You are an EveryField planner assistant helping schedule a single meeting type: vision_meeting.

Your job:
- Update the provided draft from the conversation.
- Ask only for still-missing required details.
- Never claim the meeting has been created.
- Never invent fields outside the schema.
- Always keep draft.type = "vision_meeting".
- If the user changes a previous detail, update the draft.
- Resolve relative dates using the provided America/Chicago anchors.
- "next Monday" means the next occurrence of Monday after today in America/Chicago.
- If date or time is ambiguous, ask a clarifying question instead of guessing.
- If the time is missing AM/PM and could reasonably mean morning or evening, ask the user to clarify.
- If a location name exists but no address exists and no locationId is set, ask for the address.
- If datetime and location are already known, say the draft is ready for review and creation.
- Do not ask for a location ID when the location name and address are already present.
- Use ISO 8601 UTC for draft.datetime when known.
- Return valid JSON only.
`.trim();

const PLANNER_TIMEZONE = "America/Chicago";
const RETRY_INSTRUCTION = `
Your previous response did not satisfy the required output contract.
Return strict JSON only, and ensure every draft field matches the schema exactly.
Do not omit required keys, and do not ask for details that are already present in the draft.
`.trim();

const PLANNER_JSON_SCHEMA = {
  type: "object",
  additionalProperties: false,
  properties: {
    assistantMessage: { type: "string" },
    draft: {
      type: "object",
      additionalProperties: false,
      properties: {
        type: { type: "string", enum: ["vision_meeting"] },
        datetime: {
          type: ["string", "null"],
          format: "date-time",
        },
        locationId: {
          type: ["string", "null"],
          format: "uuid",
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
        notes: {
          type: ["string", "null"],
        },
      },
      required: [
        "type",
        "datetime",
        "locationId",
        "locationName",
        "locationAddress",
        "estimatedAttendance",
        "notes",
      ],
    },
  },
  required: ["assistantMessage", "draft"],
} as const;

const WEEKDAY_NAMES = [
  "Sunday",
  "Monday",
  "Tuesday",
  "Wednesday",
  "Thursday",
  "Friday",
  "Saturday",
] as const;

type LocalDateParts = {
  year: number;
  month: number;
  day: number;
};

function buildPlannerInput(params: {
  todayIso: string;
  todayLabel: string;
  relativeDateAnchors: string[];
  timezone: string;
  draft: VisionMeetingDraft;
  messages: PlannerMessage[];
  retryReason?: string;
}) {
  return `
Today: ${params.todayIso}
Today in ${params.timezone}: ${params.todayLabel}
Timezone assumption: ${params.timezone}
Relative date anchors in ${params.timezone}:
${params.relativeDateAnchors.map((anchor) => `- ${anchor}`).join("\n")}

Current draft:
${JSON.stringify(params.draft, null, 2)}

Conversation:
${JSON.stringify(params.messages, null, 2)}

${params.retryReason ? `Retry instruction: ${params.retryReason}` : ""}

Return JSON with:
{
  "assistantMessage": "string",
  "draft": {
    "type": "vision_meeting",
    "datetime": "ISO string or null",
    "locationId": "uuid or null",
    "locationName": "string or null",
    "locationAddress": "string or null",
    "estimatedAttendance": "number or null",
    "notes": "string or null"
  }
}
`.trim();
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

export function buildRelativeDateAnchors(now: Date, timezone: string) {
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

export function maybeApplyDeterministicSchedulingDateTime(params: {
  currentDraft: VisionMeetingDraft;
  messages: PlannerMessage[];
  now: Date;
  timezone: string;
}) {
  const latestUserMessage = [...params.messages]
    .reverse()
    .find((message) => message.role === "user")?.content;

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

export function buildAssistantMessage(params: {
  missingFields: Array<"datetime" | "location">;
  readyToCreate: boolean;
  interpretation: {
    datetimeLabel?: string;
    locationLabel?: string;
  };
}) {
  if (!params.readyToCreate) {
    const missingDateTime = params.missingFields.includes("datetime");
    const missingLocation = params.missingFields.includes("location");

    if (missingDateTime && missingLocation) {
      return "I still need the date, time, and location for this vision meeting.";
    }

    if (missingLocation) {
      return `I have the date and time set for ${params.interpretation.datetimeLabel ?? "this meeting"}. What location should I use?`;
    }

    if (missingDateTime) {
      return `I have the location set to ${params.interpretation.locationLabel ?? "the selected location"}. What date and time should I use?`;
    }

    return "I’ve updated the draft. Please review it and let me know what you want to change.";
  }

  const details = [
    params.interpretation.datetimeLabel,
    params.interpretation.locationLabel,
  ].filter(Boolean);

  if (details.length === 0) {
    return "I have enough to create this vision meeting. Please review the summary and confirm when you're ready.";
  }

  return `I have enough to create this vision meeting. Please review ${details.join(" at ")} and confirm when you're ready.`;
}

function normalizeDraft(draft: VisionMeetingDraft): VisionMeetingDraft {
  return {
    type: "vision_meeting",
    datetime: draft.datetime ? new Date(draft.datetime).toISOString() : null,
    locationId: draft.locationId ?? null,
    locationName: draft.locationName?.trim() || null,
    locationAddress: draft.locationAddress?.trim() || null,
    estimatedAttendance: draft.estimatedAttendance ?? null,
    notes: draft.notes?.trim() || null,
  };
}

function computePlannerState(draft: VisionMeetingDraft) {
  const hasLocation =
    !!draft.locationId || (!!draft.locationName && !!draft.locationAddress);

  const missingFields = [
    !draft.datetime ? "datetime" : null,
    !hasLocation ? "location" : null,
  ].filter(Boolean) as Array<"datetime" | "location">;

  return {
    missingFields,
    readyToCreate: missingFields.length === 0,
  };
}

export async function runVisionMeetingPlanner(input: {
  user: { id: string };
  churchId: string;
  messages: PlannerMessage[];
  draft: VisionMeetingDraft;
}) {
  const now = new Date();
  const relativeDateAnchors = buildRelativeDateAnchors(now, PLANNER_TIMEZONE);
  let lastRecoverableError: AiParseError | AiRefusalError | ZodError | null =
    null;

  for (const retryReason of [undefined, RETRY_INSTRUCTION]) {
    try {
      const parsed = await generateStructuredObject({
        system: SYSTEM_PROMPT,
        prompt: buildPlannerInput({
          todayIso: now.toISOString(),
          todayLabel: now.toLocaleString("en-US", {
            weekday: "long",
            year: "numeric",
            month: "long",
            day: "numeric",
            timeZone: PLANNER_TIMEZONE,
          }),
          relativeDateAnchors,
          timezone: PLANNER_TIMEZONE,
          draft: input.draft,
          messages: input.messages,
          retryReason,
        }),
        schemaName: "vision_meeting_planner",
        jsonSchema: PLANNER_JSON_SCHEMA,
        temperature: 0.1,
        maxOutputTokens: 600,
      });

      const modelResponse = PlannerModelResponseSchema.parse(parsed);
      const draft = maybeApplyDeterministicSchedulingDateTime({
        currentDraft: normalizeDraft(modelResponse.draft),
        messages: input.messages,
        now,
        timezone: PLANNER_TIMEZONE,
      });
      const state = computePlannerState(draft);
      const interpretation = {
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
          [draft.locationName, draft.locationAddress]
            .filter(Boolean)
            .join(", ") || undefined,
      };

      return PlannerResponseSchema.parse({
        assistantMessage: buildAssistantMessage({
          missingFields: state.missingFields,
          readyToCreate: state.readyToCreate,
          interpretation,
        }),
        draft,
        missingFields: state.missingFields,
        readyToCreate: state.readyToCreate,
        interpretation,
      });
    } catch (error) {
      if (
        error instanceof AiRefusalError ||
        error instanceof AiParseError ||
        error instanceof ZodError
      ) {
        lastRecoverableError = error;
        continue;
      }

      throw error;
    }
  }

  if (lastRecoverableError) {
    console.warn(
      "[AI_PLANNER] Recoverable planner failure:",
      lastRecoverableError
    );

    const state = computePlannerState(input.draft);
    const devErrorDetail = ` (${lastRecoverableError instanceof ZodError ? (lastRecoverableError.issues[0]?.message ?? lastRecoverableError.message) : lastRecoverableError.message})`;

    return PlannerResponseSchema.parse({
      assistantMessage: `I couldn't interpret that cleanly. Please restate the date, time, or location.${devErrorDetail}`,
      draft: input.draft,
      missingFields: state.missingFields,
      readyToCreate: state.readyToCreate,
    });
  }

  throw new Error("Planner failed without a recoverable error");
}
