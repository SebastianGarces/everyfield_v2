// ============================================================================
// BEYOND_METRICS / BEYOND_ACTIVITY — Trinity Grove Church's real dashboard six
// weeks after launch, frozen so the journey's last stop can render the real
// dashboard.
//
// Source: Trinity Grove Church in the dev database, read 2026-08-05T03:45:47Z
// through the app's own read layer — `getDashboardMetrics(churchId, userId)`
// and `getRecentActivity(churchId)` (src/lib/dashboard/service.ts), for
// marcus@trinitygrove.org's church and user id. Read-only; to regenerate,
// re-run those two functions for that church and paste the result back over
// the constants below.
//
// Every rendered string is verbatim: the church name, the phase, the four
// metric values, every activity description down to the attendance counts.
// Activity ids are scrubbed (React keys, never rendered) and `metadata` is
// emptied (the feed renders none of it, and the real rows carry person and
// meeting ids).
//
// This is the same plant the Beyond panel already talks about — "Trinity Grove
// launched six weeks ago; this is the other side" — and the same six Sunday
// gatherings the WeeklyTicker beside it distills. The ticker's numbers and the
// feed's now come from the same rows: 108, 101, 105, 103, 109, 112.
//
// Timestamps are re-anchored at render — see ./snapshot-clock.
// ============================================================================

import type { ActivityItem, DashboardMetrics } from "@/lib/dashboard/service";

import { snapshotClock } from "./snapshot-clock";

const since = snapshotClock("2026-08-05T03:45:47.805Z");

/** Inert: React keys only, never rendered. */
const ID = (n: number) => `beyond-activity-${n}`;

export const BEYOND_CHURCH_NAME = "Trinity Grove Church";
export const BEYOND_PHASE = 6;

export const BEYOND_METRICS = {
  coreGroupSize: 48,
  totalPeople: 55,
  overdueTasks: 0,
  visionMeetingsHeld: 7,
} satisfies DashboardMetrics;

/**
 * The three most recent Sunday gatherings. The pane this sits in is
 * height-capped (see .pshot), and a taller card only buys a smaller card: at
 * three rows the composition fits at ~0.95 scale and the app's own type stays
 * readable, at six it would be scaled to ~7px. Weeks 3 down to 1 are the same
 * sentence with a different number, and the ticker beside this shows all six
 * anyway — so the feed shows the top of the run and the ticker carries the
 * trend.
 */
export const BEYOND_ACTIVITY = [
  {
    id: ID(1),
    type: "meeting_completed",
    description: "Sunday Gathering · Week 6 completed with 112 attendees",
    timestamp: since("2026-07-31T09:00:00.000Z"),
    metadata: {},
  },
  {
    id: ID(2),
    type: "meeting_completed",
    description: "Sunday Gathering · Week 5 completed with 109 attendees",
    timestamp: since("2026-07-24T09:00:00.000Z"),
    metadata: {},
  },
  {
    id: ID(3),
    type: "meeting_completed",
    description: "Sunday Gathering · Week 4 completed with 103 attendees",
    timestamp: since("2026-07-17T09:00:00.000Z"),
    metadata: {},
  },
] satisfies ActivityItem[];

/**
 * The phone shows two: the week just finished and the one before it, which is
 * the smallest pair that still reads as a rhythm rather than an event.
 */
export const BEYOND_ACTIVITY_COMPACT = [BEYOND_ACTIVITY[0], BEYOND_ACTIVITY[1]];
