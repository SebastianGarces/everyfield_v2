import { z } from "zod";
import type { CapturedCall } from "./host-capture";

const completeList = z.object({
  kind: z.literal("read"),
  resultMode: z.literal("list"),
  counts: z.object({
    matched: z.number().int().nonnegative(),
    returned: z.number().int().nonnegative(),
  }),
  filters: z.array(z.object({ label: z.string(), value: z.string() })),
  items: z.array(
    z.object({
      id: z.uuid(),
      facts: z.array(z.object({ label: z.string(), value: z.string() })),
      sourceLink: z.object({ href: z.string() }).optional(),
    })
  ),
});

// Restricting by a role's name, skills or leadership flag cannot establish the
// whole team's vacancy total, even when every match in that subset was returned.
const wholeRoleCohort = z.strictObject({
  all: z
    .array(
      z.strictObject({
        vacant: z.literal(true).optional(),
        teamIds: z.array(z.uuid()).optional(),
      })
    )
    .optional(),
  any: z.array(z.never()).optional(),
  none: z.array(z.never()).optional(),
});

/** Compare these facts with independent SQL truth; filters alone never prove coverage. */
export function observedLaunchStaffing(call: CapturedCall): string[] | null {
  if (call.name !== "teams.query") return null;
  const request = z
    .object({ request: z.object({ resource: z.enum(["teams", "roles"]) }) })
    .safeParse(call.input);
  const result = completeList.safeParse(call.output);
  if (!request.success || !result.success) return null;
  if (request.data.request.resource === "roles") {
    const scope = z
      .object({ request: z.object({ where: wholeRoleCohort.optional() }) })
      .safeParse(call.input);
    if (!scope.success) return null;
  }
  const { counts, filters, items } = result.data;
  if (
    counts.matched !== items.length ||
    counts.returned !== items.length ||
    new Set(items.map((item) => item.id)).size !== items.length ||
    filters.filter((fact) => fact.label === "Next page cursor").length !== 1 ||
    !filters.some(
      (fact) =>
        fact.label === "Next page cursor" && fact.value === "End of results"
    )
  )
    return null;
  const totals = new Map<string, number>();
  for (const item of items) {
    const isTeam = request.data.request.resource === "teams";
    const values = item.facts.filter(
      (fact) => fact.label === (isTeam ? "Open role slots" : "Vacancy")
    );
    if (values.length !== 1) return null;
    const value = values[0]!.value;
    const count = isTeam
      ? /^(0|[1-9]\d*)$/.test(value)
        ? Number(value)
        : NaN
      : value === "Open"
        ? 1
        : value === "Filled"
          ? 0
          : NaN;
    if (!Number.isSafeInteger(count) || count < 0) return null;
    const team = isTeam
      ? item.id
      : item.sourceLink?.href.match(/^\/teams\/([0-9a-f-]{36})$/i)?.[1];
    if (!z.uuid().safeParse(team).success || !team) return null;
    if (count > 0) totals.set(team, (totals.get(team) ?? 0) + count);
  }
  return [...totals].map(([team, count]) => `${team}:${count}`).sort();
}
