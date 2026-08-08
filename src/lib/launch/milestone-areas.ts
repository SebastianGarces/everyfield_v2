// ============================================================================
// The Playbook's three priority areas, as headings (LS-003).
//
// A LEAF MODULE ON PURPOSE. These strings are rendered by a client component
// (`milestone-board.tsx`), and a value imported from `milestones.ts` would drag
// that module's `@/db` import — drizzle, the Neon driver, the whole schema —
// into the browser bundle. Types are erased and may be imported from anywhere;
// values may not.
//
// `milestones.ts` re-exports these, so the seeding side has one import.
// ============================================================================

import type { LaunchMilestoneArea } from "@/db/schema/launch";

export const LAUNCH_MILESTONE_AREA_LABELS: Record<LaunchMilestoneArea, string> =
  {
    operations: "Operations — set-up & tear-down",
    launch_team: "Launch team preparation",
    promotion: "Promotion",
  };

/** The order the areas are shown in — the Playbook's own. */
export const LAUNCH_MILESTONE_AREA_ORDER: readonly LaunchMilestoneArea[] = [
  "operations",
  "launch_team",
  "promotion",
];
