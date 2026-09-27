export const coachedCollections = {
  people: {
    label: "People",
    description: "Contact details and profiles",
    empty: "This plant has not added anyone yet.",
  },
  tasks: {
    label: "Tasks",
    description: "Tasks, due dates and steps",
    empty: "This plant has no tasks yet.",
  },
  meetings: {
    label: "Meetings",
    description: "Schedules and recorded meeting information",
    empty: "This plant has no meetings yet.",
  },
  teams: {
    label: "Ministry teams",
    description: "Team roles and rosters",
    empty: "This plant has no ministry teams yet.",
  },
} as const;
export type CoachedCollection = keyof typeof coachedCollections;
export const COACHED_PAGE_SIZE = 25;
export function parseCoachedCollection(
  value: string
): CoachedCollection | null {
  switch (value) {
    case "people":
    case "tasks":
    case "meetings":
    case "teams":
      return value;
    default:
      return null;
  }
}
export function parseCoachedPage(
  value: string | string[] | undefined
): number | null {
  if (value === undefined) return 1;
  if (typeof value !== "string" || !/^[1-9]\d*$/.test(value)) return null;
  const page = Number(value);
  return Number.isSafeInteger(page) &&
    (page - 1) * COACHED_PAGE_SIZE <= 2147483647
    ? page
    : null;
}
