import { instantsAtZonedTime } from "@/lib/datetime";

const LOCAL_MINUTE = /^(\d{4}-\d{2}-\d{2})T(\d{2}):(\d{2})$/;

/** Resolve one explicit civil minute; DST gaps and folds require clarification. */
export function teamsMeetingInstant(
  value: string | undefined,
  timeZone: string | undefined
): Date | null {
  if (!value || !timeZone) return null;
  try {
    new Intl.DateTimeFormat("en-US", { timeZone });
  } catch {
    return null;
  }
  const match = LOCAL_MINUTE.exec(value);
  if (!match?.[1] || !match[2] || !match[3]) return null;
  const candidates = instantsAtZonedTime(
    match[1],
    Number(match[2]),
    Number(match[3]),
    timeZone
  );
  return candidates.length === 1 ? candidates[0]! : null;
}
