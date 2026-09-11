import { z } from "zod";
import { resolveEvryDateRange } from "@/lib/evry/reads/date-range";

export const operationCalendarDate = z
  .union([
    z.string().date(),
    z.strictObject({
      kind: z.literal("relative"),
      period: z.enum(["today", "tomorrow", "yesterday"]),
    }),
  ])
  .describe(
    "Use relative today/tomorrow/yesterday when the user does. The server resolves the church calendar. YYYY-MM-DD is for an explicit calendar date."
  );

export function resolveOperationDate(
  value: unknown,
  now: Date,
  timeZone: string
): string {
  const parsed = operationCalendarDate.parse(value);
  if (typeof parsed === "string") return parsed;
  const resolved = resolveEvryDateRange(parsed, now, timeZone).from;
  if (!resolved) throw new Error("A single calendar date is required");
  return resolved;
}

const localTime = z.string().regex(/^(?:[01]\d|2[0-3]):[0-5]\d$/);
export const operationLocalDatetime = z
  .union([
    z
      .string()
      .regex(/^\d{4}-\d{2}-\d{2}T(?:[01]\d|2[0-3]):[0-5]\d$/)
      .refine(
        (value) => z.string().date().safeParse(value.slice(0, 10)).success
      ),
    z.strictObject({ date: operationCalendarDate, time: localTime }),
  ])
  .describe(
    "Church-local date and time. For tomorrow at 10am use date:{kind:relative,period:tomorrow}, time:10:00. No model-supplied timezone or UTC conversion."
  );

export function resolveOperationDatetime(
  value: unknown,
  now: Date,
  timeZone: string
): string {
  const parsed = operationLocalDatetime.parse(value);
  const local =
    typeof parsed === "string"
      ? parsed
      : `${resolveOperationDate(parsed.date, now, timeZone)}T${parsed.time}`;
  return `${local}:00.000Z`;
}
