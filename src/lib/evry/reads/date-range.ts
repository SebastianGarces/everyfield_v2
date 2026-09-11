import { z } from "zod";
import { addCalendarDays, toCalendarDate } from "@/lib/datetime";

export const evryDateRangeSchema = z
  .discriminatedUnion("kind", [
    z.strictObject({
      kind: z.literal("relative"),
      period: z.enum([
        "today",
        "tomorrow",
        "yesterday",
        "overdue",
        "this_week",
        "next_week",
        "this_month",
      ]),
    }),
    z
      .strictObject({
        kind: z.literal("range"),
        from: z.string().date().nullable(),
        through: z.string().date().nullable(),
      })
      .refine(
        (range) => !range.from || !range.through || range.from <= range.through,
        "The start date must not follow the end date"
      ),
  ])
  .describe(
    "Inclusive calendar-day filter. Relative periods use the church timezone. Today excludes overdue dates. Weeks start Monday. Null means no date filter."
  );

export function resolveEvryDateRange(
  range: z.infer<typeof evryDateRangeSchema> | null | undefined,
  now: Date,
  timeZone: string
): { from?: string; through?: string } {
  if (!range) return {};
  if (range.kind === "range")
    return {
      from: range.from ?? undefined,
      through: range.through ?? undefined,
    };
  const today = toCalendarDate(now, timeZone);
  const day = (offset: number) =>
    addCalendarDays(new Date(`${today}T00:00:00Z`), offset);
  switch (range.period) {
    case "today":
      return { from: today, through: today };
    case "tomorrow":
      return { from: day(1), through: day(1) };
    case "yesterday":
      return { from: day(-1), through: day(-1) };
    case "overdue":
      return { through: day(-1) };
    case "this_week":
    case "next_week": {
      const mondayOffset = -(
        (new Date(`${today}T00:00:00Z`).getUTCDay() + 6) %
        7
      );
      const start = mondayOffset + (range.period === "next_week" ? 7 : 0);
      return { from: day(start), through: day(start + 6) };
    }
    case "this_month": {
      const from = `${today.slice(0, 7)}-01`;
      const next = new Date(`${from}T00:00:00Z`);
      next.setUTCMonth(next.getUTCMonth() + 1);
      return { from, through: addCalendarDays(next, -1) };
    }
  }
}
