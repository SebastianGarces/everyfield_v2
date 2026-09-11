import {
  formatDateTime,
  formatDateTimeWithZone,
  instantsAtZonedTime,
  toCalendarDate,
} from "@/lib/datetime";

/** Meeting rows store wall-clock values, not UTC instants. Preserve the hour. */
export function meetingReadDateTime(value: Date, timeZone: string): string {
  const instants = instantsAtZonedTime(
    toCalendarDate(value, "UTC"),
    value.getUTCHours(),
    value.getUTCMinutes(),
    timeZone
  );
  return instants.length === 1
    ? formatDateTimeWithZone(instants[0], timeZone)
    : `${formatDateTime(value, "long", "UTC")} (${timeZone}; time needs review)`;
}
