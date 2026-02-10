import { db } from "@/db";
import {
  personActivities,
  personStatuses,
  persons,
  type PersonStatus,
} from "@/db/schema";
import { and, between, eq, isNull, sql } from "drizzle-orm";
import type { PipelineMetrics } from "./types";

/**
 * Check if a transition is forward (progressing through the pipeline)
 */
function isForwardTransition(from: string, to: string): boolean {
  const fromIdx = personStatuses.indexOf(from as PersonStatus);
  const toIdx = personStatuses.indexOf(to as PersonStatus);
  return fromIdx >= 0 && toIdx >= 0 && toIdx > fromIdx;
}

/**
 * Key pipeline transitions to display conversion rates for
 */
const KEY_TRANSITIONS: { from: PersonStatus; to: PersonStatus }[] = [
  { from: "prospect", to: "attendee" },
  { from: "attendee", to: "following_up" },
  { from: "following_up", to: "interviewed" },
  { from: "interviewed", to: "core_group" },
];

/**
 * Get pipeline metrics including status counts and conversion rates
 */
export async function getPipelineMetrics(
  churchId: string,
  dateRange?: { start: Date; end: Date }
): Promise<PipelineMetrics> {
  // 1. Get status counts
  const statusCountRows = await db
    .select({
      status: persons.status,
      count: sql<number>`count(*)::int`,
    })
    .from(persons)
    .where(and(eq(persons.churchId, churchId), isNull(persons.deletedAt)))
    .groupBy(persons.status);

  const statusCounts: Partial<Record<PersonStatus, number>> = {};
  for (const row of statusCountRows) {
    statusCounts[row.status] = row.count;
  }

  // 2. Get conversion rates from activity log
  // Query status_changed activities and count transitions
  const activityConditions = [
    eq(personActivities.churchId, churchId),
    eq(personActivities.activityType, "status_changed"),
  ];

  if (dateRange) {
    activityConditions.push(
      between(personActivities.createdAt, dateRange.start, dateRange.end)
    );
  }

  // Query all status_changed activities and count transitions in JS
  // This avoids complex JSON queries that may vary across DB engines
  const statusActivities = await db
    .select({
      metadata: personActivities.metadata,
    })
    .from(personActivities)
    .where(and(...activityConditions));

  // Count only forward transitions (ignore backward/demotion moves)
  const transitionCounts: Record<string, number> = {};
  for (const activity of statusActivities) {
    const meta = activity.metadata as Record<string, unknown> | null;
    if (!meta) continue;

    const oldStatus = meta.oldStatus as string;
    const newStatus = meta.newStatus as string;
    if (!oldStatus || !newStatus) continue;

    // Only count forward movement through the pipeline
    if (!isForwardTransition(oldStatus, newStatus)) continue;

    const key = `${oldStatus}->${newStatus}`;
    transitionCounts[key] = (transitionCounts[key] ?? 0) + 1;
  }

  // Calculate conversion rates for key transitions
  // Rate = people who transitioned forward / total who were ever in source status
  // Total = people currently in "from" + people who moved forward out of "from"
  const conversions = KEY_TRANSITIONS.map(({ from, to }) => {
    const key = `${from}->${to}`;
    const count = transitionCounts[key] ?? 0;

    // Total = currently in "from" + all who moved forward out of "from"
    const currentInFrom = statusCounts[from] ?? 0;
    const movedForward = Object.entries(transitionCounts)
      .filter(([k]) => k.startsWith(`${from}->`))
      .reduce((sum, [, v]) => sum + v, 0);

    const total = currentInFrom + movedForward;
    const rate = total > 0 ? count / total : 0;

    return { from, to, rate, count, total };
  });

  return { statusCounts, conversions };
}
