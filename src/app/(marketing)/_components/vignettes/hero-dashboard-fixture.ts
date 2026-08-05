// ============================================================================
// HERO_METRICS / HERO_ACTIVITY — Redemption Hill Church's real dashboard,
// frozen so the landing page can render the real dashboard.
//
// Source: Redemption Hill Church in the dev database, read 2026-08-05T03:45:47Z
// through the app's own read layer — `getDashboardMetrics(churchId, userId)`
// and `getRecentActivity(churchId)` (src/lib/dashboard/service.ts), for
// daniel@redemptionhill.org's church and user id. Read-only; to regenerate,
// re-run those two functions for that church and paste the result back over
// the constants below.
//
// Every rendered string is verbatim: the church name, the phase, the four
// metric values, every activity description. Only two things were changed, and
// both are deliberate:
//
//   - Activity ids are scrubbed. They never reach the DOM (the feed uses them
//     as React keys and nothing else); they exist here to satisfy the type.
//   - `metadata` is empty. The feed renders none of it, and the real rows
//     carry person ids and a private pastoral note ("Came back for VN #4 —
//     bring the launch-team ask gently") that has no business in a public
//     JavaScript bundle.
//
// Two facts worth knowing before this ships:
//
//   1. OVERDUE TASKS IS NOW 6, NOT 0. The retired hero.webp showed "0 — You're
//      all caught up!"; that was true when it was captured, and has stopped
//      being true because seeded due dates have since passed. This is the live
//      value. If the hero should show zero again, the honest fix is to close
//      those tasks in the dev database and re-snapshot — not to hand-edit the
//      number here.
//   2. The core group reads 61 here and the network-health insight for the
//      same church says "60 committed members". Both are real: the insight
//      quotes the fact snapshot the assessment was judged on (2026-07-31), the
//      metric counts today. The retired captures showed the same pair.
//
// Timestamps are re-anchored at render — see ./snapshot-clock.
// ============================================================================

import type { ActivityItem, DashboardMetrics } from "@/lib/dashboard/service";

import { snapshotClock } from "./snapshot-clock";

const since = snapshotClock("2026-08-05T03:45:47.805Z");

/** Inert: React keys only, never rendered. */
const ID = (n: number) => `hero-activity-${n}`;

export const HERO_CHURCH_NAME = "Redemption Hill Church";
export const HERO_PHASE = 4;

export const HERO_METRICS = {
  coreGroupSize: 61,
  totalPeople: 142,
  overdueTasks: 6,
  visionMeetingsHeld: 4,
} satisfies DashboardMetrics;

/**
 * The six most recent items. The feed is read `limit: 20` in the app and the
 * seventh onward are fourteen identical "Task completed: Follow up with
 * <name>" rows closed in the same second — a bulk catch-up that reads as
 * filler at any size. Six is where the week's actual story ends, and it is
 * exactly the set the retired hero.webp had room to show.
 */
export const HERO_ACTIVITY = [
  {
    id: ID(1),
    type: "task_completed",
    description: "Task completed: Complete evaluation for Vision Night #3",
    timestamp: since("2026-07-31T06:27:56.518Z"),
    metadata: {},
  },
  {
    id: ID(2),
    type: "task_completed",
    description: "Task completed: Complete evaluation for Vision Night #2",
    timestamp: since("2026-07-31T06:27:52.132Z"),
    metadata: {},
  },
  {
    id: ID(3),
    type: "task_completed",
    description: "Task completed: Complete evaluation for Vision Night #1",
    timestamp: since("2026-07-31T06:27:48.301Z"),
    metadata: {},
  },
  {
    id: ID(4),
    type: "status_changed",
    description: "Grace Lin's status was updated",
    timestamp: since("2026-07-29T06:27:14.774Z"),
    metadata: {},
  },
  {
    id: ID(5),
    type: "person_created",
    description: "J. P. Holloway was added as a new contact",
    timestamp: since("2026-07-27T06:27:14.774Z"),
    metadata: {},
  },
  {
    id: ID(6),
    type: "note_added",
    description: "Note added for Dana Whitfield",
    timestamp: since("2026-07-27T06:27:14.774Z"),
    metadata: {},
  },
] satisfies ActivityItem[];

/**
 * The three the phone shows: the newest evaluation, the status move, and the
 * new contact — one of each kind of thing the feed reports, which is what
 * makes the point that the feed is cross-feature. The other three are two more
 * evaluations and a note, and repeat kinds already on screen.
 */
export const HERO_ACTIVITY_COMPACT = [
  HERO_ACTIVITY[0],
  HERO_ACTIVITY[3],
  HERO_ACTIVITY[4],
];
