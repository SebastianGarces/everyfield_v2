import { z } from "zod";
import {
  addCalendarDays,
  formatDateTimeWithZone,
  instantsAtZonedTime,
  toCalendarDate,
  utcOffsetForZonedTime,
} from "@/lib/datetime";

/** Language interpretation belongs to the model; calendar arithmetic does not. */
export const eveCalendarInputSchema = z.strictObject({
  date: z.discriminatedUnion("kind", [
    z.strictObject({ kind: z.literal("absolute"), date: z.string().date() }),
    z.strictObject({
      kind: z.literal("relative_day"),
      daysFromToday: z.number().int().min(-3660).max(3660),
    }),
    z.strictObject({
      kind: z.literal("weekday"),
      weekday: z
        .number()
        .int()
        .min(0)
        .max(6)
        .describe("Sunday = 0, Saturday = 6"),
      occurrence: z.enum(["upcoming", "next_week", "this_week"]),
    }),
    z.strictObject({
      kind: z.literal("month_day"),
      month: z.number().int().min(1).max(12),
      day: z.number().int().min(1).max(31),
      year: z.number().int().min(1900).max(2200).optional(),
    }),
  ]),
  localTime: z
    .string()
    .regex(/^(?:[01]\d|2[0-3]):[0-5]\d$/)
    .optional(),
  durationMinutes: z.number().int().min(1).max(1440).optional(),
  repeatedTime: z.enum(["earlier", "later"]).optional(),
});

export type EveCalendarInput = z.infer<typeof eveCalendarInputSchema>;

export function resolveEveCalendar(
  input: EveCalendarInput,
  context: { now: Date; timeZone: string }
) {
  const today = toCalendarDate(context.now, context.timeZone);
  const dayIndex = new Date(`${today}T00:00:00Z`);
  let calendarDate: string;
  let interpretation: string;
  switch (input.date.kind) {
    case "absolute":
      calendarDate = input.date.date;
      interpretation = "The supplied calendar date.";
      break;
    case "relative_day":
      calendarDate = addCalendarDays(dayIndex, input.date.daysFromToday);
      interpretation = `${input.date.daysFromToday} calendar days from today in the church timezone.`;
      break;
    case "weekday": {
      const weekday = dayIndex.getUTCDay();
      const upcoming = (input.date.weekday - weekday + 7) % 7 || 7;
      const mondayOffset = -((weekday + 6) % 7);
      const offset =
        input.date.occurrence === "upcoming"
          ? upcoming
          : mondayOffset +
            ((input.date.weekday + 6) % 7) +
            (input.date.occurrence === "next_week" ? 7 : 0);
      calendarDate = addCalendarDays(dayIndex, offset);
      interpretation =
        input.date.occurrence === "upcoming"
          ? "The next occurrence strictly after today. Next Sunday means the upcoming Sunday, not an extra week later."
          : "Calendar weeks start Monday in the church timezone.";
      break;
    }
    case "month_day": {
      const year = input.date.year ?? Number(today.slice(0, 4));
      const monthDay = `${String(input.date.month).padStart(2, "0")}-${String(input.date.day).padStart(2, "0")}`;
      calendarDate = `${year}-${monthDay}`;
      if (!input.date.year && calendarDate < today)
        calendarDate = `${year + 1}-${monthDay}`;
      if (!z.string().date().safeParse(calendarDate).success) {
        return {
          status: "needs_input" as const,
          reason: "invalid_calendar_date",
          message: "That day does not exist in the selected month and year.",
        };
      }
      interpretation = input.date.year
        ? "The supplied month, day and year."
        : "The next occurrence of the supplied month and day, including today. Confirm the displayed year in the review.";
      break;
    }
  }
  const base = {
    calendarDate,
    timeZone: context.timeZone,
    referenceInstant: context.now.toISOString(),
    interpretation,
  };
  if (!input.localTime) return { status: "resolved" as const, ...base };
  const hour = Number(input.localTime.slice(0, 2));
  const minute = Number(input.localTime.slice(3, 5));
  const instants = instantsAtZonedTime(
    calendarDate,
    hour,
    minute,
    context.timeZone
  );
  const first = instants[0];
  if (!first)
    return {
      status: "needs_input" as const,
      ...base,
      reason: "daylight_saving_gap",
      message:
        "That local time does not exist because the clocks move forward. Choose another time.",
    };
  if (instants.length > 1 && !input.repeatedTime)
    return {
      status: "needs_input" as const,
      ...base,
      reason: "daylight_saving_fold",
      message:
        "That local time occurs twice. Choose the earlier or later occurrence.",
      choices: instants.map((instant) => ({
        instantUtc: instant.toISOString(),
        label: formatDateTimeWithZone(instant, context.timeZone),
      })),
    };
  const instant =
    input.repeatedTime === "later" ? (instants.at(-1) ?? first) : first;
  const end =
    input.durationMinutes === undefined
      ? undefined
      : new Date(instant.getTime() + input.durationMinutes * 60_000);
  return {
    status: "resolved" as const,
    ...base,
    localTime: input.localTime,
    instantUtc: instant.toISOString(),
    utcOffset: utcOffsetForZonedTime(calendarDate, hour, minute, instant),
    display: formatDateTimeWithZone(instant, context.timeZone),
    ...(end
      ? {
          durationMinutes: input.durationMinutes,
          endInstantUtc: end.toISOString(),
          endDisplay: formatDateTimeWithZone(end, context.timeZone),
        }
      : {}),
  };
}
