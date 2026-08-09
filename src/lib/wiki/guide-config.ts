// Wiki Guide Configuration
//
// Maps URL path patterns to wiki article slugs for contextual help.
// The WikiGuide component reads the current pathname and shows relevant
// articles in a floating panel.
//
// Pattern rules:
//   - Use a wildcard segment for dynamic path parts (e.g. "/people/[id]/assessments")
//   - Append query params to match on search params (e.g. "/people/[id]/assessments?tab=interviews")
//   - More specific patterns (with query params) take priority over less specific ones
//   - Patterns are matched and the first match wins after sorting by specificity

export type WikiGuideEntry = {
  /** Display label shown in the panel header */
  label: string;
  /** Wiki article slugs to render (first slug is default, others available via tabs) */
  slugs: string[];
};

/**
 * Route pattern → guide entry mapping.
 *
 * Add entries here to enable contextual wiki help on any page.
 * Slugs should match existing wiki article slugs in the database.
 */
export const wikiGuideConfig: Record<string, WikiGuideEntry> = {
  // ── People CRM: Dashboard ───────────────────────────────────────────
  "/people": {
    label: "Core Group Funnel",
    slugs: ["core-group/building-your-core-group/the-core-group-funnel"],
  },

  // ── People CRM: Assessments ──────────────────────────────────────────
  "/people/*/assessments?tab=assessments": {
    label: "Assessments Overview",
    slugs: ["frameworks/the-4-cs"],
  },
  "/people/*/assessments?tab=interviews": {
    label: "Interview Guide",
    slugs: [
      "frameworks/the-5-interview-criteria",
      "core-group/follow-up/interviewing-for-fit",
    ],
  },
  "/people/*/assessments?tab=commitments": {
    label: "Commitment Guide",
    slugs: [
      "core-group/commitment/why-formalized-commitment-matters",
      "core-group/commitment/the-three-key-documents",
      "core-group/commitment/core-group-commitments-explained",
    ],
  },
  "/people/*/assessments/new": {
    label: "4Cs Assessment Guide",
    slugs: ["frameworks/the-4-cs"],
  },
  "/people/*/assessments/interview": {
    label: "Interview Guide",
    slugs: [
      "frameworks/the-5-interview-criteria",
      "core-group/follow-up/interviewing-for-fit",
    ],
  },
  "/people/*/assessments/commitment": {
    label: "Commitment Guide",
    slugs: [
      "core-group/commitment/why-formalized-commitment-matters",
      "core-group/commitment/the-three-key-documents",
      "core-group/commitment/core-group-commitments-explained",
    ],
  },

  // ── Launch Sunday ────────────────────────────────────────────────────
  // Ordered to follow the page itself: the day it counts down to first (the
  // panel opens on `slugs[0]`), then the three readiness areas the milestone
  // board actually renders — operations, launch team, promotion
  // (`src/lib/launch/milestone-areas.ts`) — so every entry answers a question
  // the surrounding UI raises rather than being phase-4/5 in bulk.
  //
  // These slugs are fetched live and a slug that is missing or unpublished
  // renders an error inside the panel, not nothing (`wiki-guide-panel.tsx`), so
  // each one below was verified published against the wiki read layer
  // (2026-08-08). Re-verify before changing this list — `guide-config.test.ts`
  // pins it to force exactly that.
  "/launch": {
    label: "Launch Sunday Guide",
    slugs: [
      "launch-sunday/launch-day-guide",
      "launch-sunday/5-priority-details",
      "pre-launch/final-checklist-review",
      "pre-launch/operations-setup-teardown",
      "pre-launch/launch-team-spiritual-preparation",
      "pre-launch/the-promotion-plan",
    ],
  },

  // ── Meetings ─────────────────────────────────────────────────────────
  // Two entries, because the two pages ask different questions: the list is
  // "what are these meetings for", the detail page is "how do I run this one".
  //
  // The list covers each member of the `meetingTypes` enum
  // (`src/db/schema/meetings.ts` — vision_meeting, orientation, team_meeting)
  // plus the framework that spans all three, so no type on the page is
  // unrepresented in its guide.
  //
  // Slugs verified published against the wiki read layer on 2026-08-09 and
  // pinned in `guide-config.test.ts`; re-verify before changing either list.
  "/meetings": {
    label: "Meetings Guide",
    slugs: [
      "core-group/vision-meetings/what-is-a-vision-meeting",
      "frameworks/meeting-objectives",
      "core-group/building-your-core-group/core-group-meeting-format",
      "training/launch-team-meeting-objectives",
    ],
  },
  // Ordered to follow the meeting's own life: plan it, build the agenda, pack
  // the kit, invite, run it, then score it. The last slug is the evaluation
  // tab's rubric — `meeting_evaluations` stores exactly eight scores
  // (`src/db/schema/meetings.ts`), which ARE the 8 critical success factors.
  //
  // A single wildcard segment, so this also claims `/meetings/new`. That is
  // deliberate rather than tolerated: `slugs[0]` is the planning article, which
  // is what somebody scheduling a meeting wants, and a new meeting is created
  // in `planning` status onto this same page. The deeper tabs
  // (`/meetings/*/attendance`, `…/evaluation`, …) have one more segment and are
  // NOT claimed — `matchPattern` compares segment counts — so they can take
  // their own entries later without fighting this one.
  "/meetings/*": {
    label: "Meeting Guide",
    slugs: [
      "core-group/vision-meetings/planning-your-vision-meeting",
      "core-group/vision-meetings/vision-meeting-agenda-deep-dive",
      "core-group/vision-meetings/the-vision-meeting-kit",
      "core-group/vision-meetings/invitation-strategies",
      "core-group/vision-meetings/running-the-meeting",
      "core-group/vision-meetings/8-critical-success-factors-for-vision-meetings",
    ],
  },

  // ── Ministry teams ───────────────────────────────────────────────────
  // The dashboard is "which teams does a plant need, and who staffs them" —
  // it renders the team list beside a staffing summary of open roles.
  "/teams": {
    label: "Ministry Teams Guide",
    slugs: [
      "launch-team/leadership/key-leadership-roles-overview",
      "launch-team/launch-date/transitioning-to-launch-team",
      "training/training-programs-overview",
    ],
  },
  // One entry per tab of a single team (`components/ministry-teams/team-tabs.tsx`
  // — Members & Roles, Responsibilities, Training, Meetings), opening on the
  // roles overview because that is the tab the route lands on.
  //
  // The wildcard also claims the two sibling pages, `/teams/health` and
  // `/teams/org-chart`. Both ask the same question this list answers — who
  // fills which role — so they inherit it rather than showing nothing.
  "/teams/*": {
    label: "Team Guide",
    slugs: [
      "launch-team/leadership/key-leadership-roles-overview",
      "training/ministry-specific-training",
      "training/launch-team-meeting-objectives",
    ],
  },

  // ── Onboarding: the journey step (OB-014) ────────────────────────────
  // The onboarding flow has no route of its own — it renders AS the dashboard
  // for a planter who has not finished it (`app/(dashboard)/dashboard/page.tsx`
  // → `shouldShowOnboarding`), and which step is showing is client state, not a
  // URL (`components/onboarding/onboarding-flow.tsx`). So the pattern that
  // reaches the journey step is the bare dashboard path: a planter resuming at
  // step 3 is at `/dashboard`, with nothing in the URL to match on.
  //
  // Step 3 asks two things — "which stage of the journey are you in" and "your
  // target launch date, or no date yet" (`components/onboarding/upcoming-step.tsx`)
  // — and the list answers them in that order. `slugs[0]` is the phase overview,
  // the one article that lays out phases 0-6 and tells a planter to find their
  // own; the launch-date pair answers the second question honestly, by
  // readiness rather than by calendar.
  //
  // The finished dashboard therefore carries this guide too. That is the right
  // outcome, not a leak: the dashboard's own subtitle is the plant's phase, so
  // "which phase am I in" is the question that page raises whether or not the
  // planter is still onboarding. If the flow ever puts its step in the URL, add
  // a narrower `"/dashboard?step=journey"` entry — query patterns outrank bare
  // paths in `patternSpecificity`, so it would take over with no other change.
  "/dashboard": {
    label: "Your Journey Guide",
    slugs: [
      "getting-started/welcome-to-the-launch-playbook",
      "getting-started/launch-process-goals",
      "launch-team/launch-date/setting-your-launch-date",
      "launch-team/launch-date/variables-that-drive-your-launch-date",
    ],
  },

  // ── Extend: add more routes below ────────────────────────────────────
  // "/vision-meetings/*": {
  //   label: "Vision Meetings Guide",
  //   slugs: ["journey/phase-1/vision-meetings"],
  // },
};

// ════════════════════════════════════════════════════════════════════════
// Pattern matching utilities
// ════════════════════════════════════════════════════════════════════════

/**
 * Parse a pattern into its path and query param parts.
 * e.g. "/people/x/assessments?tab=interviews" -> { path: "/people/x/assessments", params: { tab: "interviews" } }
 */
function parsePattern(pattern: string): {
  path: string;
  params: Record<string, string>;
} {
  const qIndex = pattern.indexOf("?");
  if (qIndex === -1) return { path: pattern, params: {} };

  const path = pattern.slice(0, qIndex);
  const params: Record<string, string> = {};
  const searchStr = pattern.slice(qIndex + 1);

  for (const pair of searchStr.split("&")) {
    const [key, value] = pair.split("=");
    if (key && value !== undefined) {
      params[key] = value;
    }
  }

  return { path, params };
}

/**
 * Match a pathname + search params against a pattern with wildcard support.
 *
 * Pattern rules:
 *   - Path: segments separated by "/", use a wildcard for dynamic parts
 *   - Query: key=value pairs after "?" must all be present in searchParams
 *   - Trailing slashes are normalized away
 *   - Matching is case-sensitive
 */
function matchPattern(
  pattern: string,
  pathname: string,
  searchParams: Record<string, string>
): boolean {
  const { path: patternPath, params: patternParams } = parsePattern(pattern);

  // Match path segments
  const patternParts = patternPath.replace(/\/+$/, "").split("/");
  const pathParts = pathname.replace(/\/+$/, "").split("/");

  if (patternParts.length !== pathParts.length) return false;

  const pathMatches = patternParts.every(
    (part, i) => part === "*" || part === pathParts[i]
  );

  if (!pathMatches) return false;

  // Match query params (all pattern params must be present with matching values)
  for (const [key, value] of Object.entries(patternParams)) {
    if (searchParams[key] !== value) return false;
  }

  return true;
}

/**
 * Count the specificity of a pattern.
 * Query params add extra specificity so "?tab=x" patterns win over bare paths.
 */
function patternSpecificity(pattern: string): number {
  const { path, params } = parsePattern(pattern);
  const pathScore = path.split("/").filter((p) => p !== "*").length;
  const paramScore = Object.keys(params).length;
  return pathScore + paramScore;
}

/**
 * Resolve the current pathname + search params to a WikiGuideEntry, if any.
 * Returns the most specific matching entry, or null if no match.
 */
export function resolveGuideEntry(
  pathname: string,
  searchParams: Record<string, string> = {}
): WikiGuideEntry | null {
  const entries = Object.entries(wikiGuideConfig);

  // Sort by specificity descending so more specific patterns win
  const sorted = entries.sort(
    ([a], [b]) => patternSpecificity(b) - patternSpecificity(a)
  );

  for (const [pattern, entry] of sorted) {
    if (matchPattern(pattern, pathname, searchParams)) {
      return entry;
    }
  }

  return null;
}
